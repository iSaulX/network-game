import type {
  BonusMove,
  DieValue,
  GameEvent,
  GameState,
  Move,
} from "@/lib/parchis/types";
import { createGame } from "@/lib/parchis";
import {
  applyAction,
  createRateLimiter,
  cryptoDice,
  type AuthorityResult,
} from "../authority";
import {
  PARTY_PROTOCOL_VERSION,
  type ClientAction,
  type LanPlayerInfo,
  type LanRoster,
  type PartyErrorCode,
  type WireMessage,
} from "../protocol";
import {
  GameSession,
  SessionNotifier,
  type SessionSnapshot,
} from "../session";
import type { GameTransport, TransportKind } from "../transport";
import {
  LAN_GUEST_ENGINE_COLOR,
  LAN_HOST_ENGINE_COLOR,
} from "../lan-colors";

export interface HostSessionOptions {
  readonly transport: GameTransport;
  readonly roster: LanRoster;
  /** Injected in tests; defaults to uniform crypto dice. */
  readonly rollDice?: () => [DieValue, DieValue];
  readonly rateLimit?: { readonly limit: number; readonly windowMs: number };
  readonly now?: () => number;
}

/**
 * The authoritative peer. It owns the game state and version, applies both its
 * own actions and guest intents through the shared authority, and broadcasts
 * every accepted state to the guest.
 */
export class WebRTCHostSession extends GameSession {
  readonly playerId = "host" as const;
  readonly transportKind: TransportKind;

  private readonly transport: GameTransport;
  private readonly roster: LanRoster;
  private readonly drawDice: () => [DieValue, DieValue];
  private readonly allowAction: (key: string) => boolean;
  private readonly notifier = new SessionNotifier();
  private readonly unsubscribe: () => void;

  private game: GameState | null = null;
  private version = 0;
  private status: SessionSnapshot["status"] = "connecting";
  private error: SessionSnapshot["error"] = null;
  private peer: LanPlayerInfo | null = null;
  private events: readonly GameEvent[] = [];
  private armed = false;
  private disposed = false;

  constructor(options: HostSessionOptions) {
    super();
    this.transport = options.transport;
    this.roster = options.roster;
    this.transportKind = options.transport.kind;
    this.drawDice = options.rollDice ?? cryptoDice();
    this.allowAction = createRateLimiter(
      options.rateLimit?.limit ?? 12,
      options.rateLimit?.windowMs ?? 1000,
      options.now,
    );

    this.unsubscribe = this.transport.subscribe((message) => {
      this.receive(message);
    });

    this.transport.subscribeStatus((next) => {
      if (next === "open") {
        this.setStatus("connected");
      } else if (next === "failed") {
        this.setStatus("failed");
      } else if (next === "closed") {
        this.setStatus("closed");
      }
    });

    // The channel may already be open when the session is created.
    if (this.transport.status === "open") {
      this.status = "connected";
    }
  }

  get snapshot(): SessionSnapshot {
    return {
      state: this.game,
      version: this.version,
      status: this.status,
      events: this.events,
      error: this.error,
      peer: this.peer,
      roster: this.roster,
    };
  }

  subscribe(listener: Parameters<GameSession["subscribe"]>[0]): () => void {
    return this.notifier.subscribe(listener);
  }

  start(): void {
    this.armed = true;
    if (this.transport.status === "closed" || this.transport.status === "failed") {
      return;
    }
    void this.transport.connect().catch(() => {
      this.setStatus("failed");
    });
    this.notifier.emit(this.snapshot);
  }

  roll(): void {
    this.act({ type: "ROLL" });
  }

  move(move: Move): void {
    this.act({ type: "MOVE", move });
  }

  bonusMove(move: BonusMove): void {
    this.act({ type: "BONUS_MOVE", move });
  }

  chooseBarrier(progress: number): void {
    this.act({ type: "CHOOSE_BARRIER", progress });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    if (this.status === "connected") {
      // Tell the guest the match is over before the channel disappears.
      try {
        this.transport.send({
          type: "BYE",
          protocol: PARTY_PROTOCOL_VERSION,
          reason: "host-closed",
        });
      } catch {
        // The channel may already be gone; closing below is enough.
      }
    }

    this.unsubscribe();
    this.notifier.clear();
    this.transport.close();
    this.setStatus("closed");
  }

  private setStatus(next: SessionSnapshot["status"]): void {
    if (this.status === next) {
      return;
    }
    this.status = next;
    this.notifier.emit(this.snapshot);
  }

  private act(action: ClientAction): void {
    if (!this.game || this.status !== "connected") {
      return;
    }

    this.applyAndBroadcast(action, this.playerId);
  }

  private applyAndBroadcast(action: ClientAction, actorId: string): boolean {
    if (!this.game) {
      return false;
    }

    const result = applyAction(
      {
        state: this.game,
        version: this.version,
        actorId,
        action,
      },
      this.drawDice,
    );

    if (!result.ok) {
      return false;
    }

    this.commit(result);
    this.send({
      type: "STATE",
      protocol: PARTY_PROTOCOL_VERSION,
      version: this.version,
      state: result.state,
      events: result.events,
    });

    return true;
  }

  private commit(result: Extract<AuthorityResult, { ok: true }>): void {
    this.game = result.state;
    this.version = result.version;
    this.events = result.events;
    this.error = null;
    this.notifier.emit(this.snapshot);
  }

  private receive(message: WireMessage): void {
    if (this.disposed) {
      return;
    }

    if (message.type === "HELLO") {
      this.handleHello(message.player);
      return;
    }

    if (message.type !== "ACTION") {
      return;
    }

    if (!this.game) {
      this.sendError("NOT_READY", "The game has not started yet.");
      return;
    }

    if (!this.allowAction("guest")) {
      this.sendError("RATE_LIMITED", "Too many actions.");
      return;
    }

    if (message.version !== this.version) {
      this.sendError(
        "STALE_VERSION",
        "The game state moved on.",
      );
      return;
    }

    const result = applyAction(      {
        state: this.game,
        version: this.version,
        actorId: "guest",
        action: message.action,
        expectedVersion: message.version,
      },
      this.drawDice,
    );

    if (!result.ok) {
      this.sendError(result.code, result.message);
      return;
    }

    this.commit(result);
    this.send({
      type: "STATE",
      protocol: PARTY_PROTOCOL_VERSION,
      version: this.version,
      state: result.state,
      events: result.events,
    });
  }

  private handleHello(player: LanPlayerInfo): void {
    this.peer = player;

    if (!this.armed || this.game) {
      this.notifier.emit(this.snapshot);
      return;
    }

    this.game = createGame([
      { id: "host", color: LAN_HOST_ENGINE_COLOR },
      { id: "guest", color: LAN_GUEST_ENGINE_COLOR },
    ]);
    this.version = 0;
    this.status = "connected";
    this.error = null;
    this.events = [];

    this.send({
      type: "START",
      protocol: PARTY_PROTOCOL_VERSION,
      version: this.version,
      roster: this.roster,
      state: this.game,
    });

    this.notifier.emit(this.snapshot);
  }

  private sendError(code: PartyErrorCode, message: string): void {
    if (!this.game) {
      this.send({
        type: "ERROR",
        protocol: PARTY_PROTOCOL_VERSION,
        version: this.version,
        code,
        message,
      });
      return;
    }

    this.send({
      type: "ERROR",
      protocol: PARTY_PROTOCOL_VERSION,
      version: this.version,
      code,
      message,
      state: this.game,
    });
  }

  private send(message: WireMessage): void {
    try {
      this.transport.send(message);
    } catch {
      this.setStatus("failed");
    }
  }
}
