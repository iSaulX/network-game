import type { BonusMove, GameEvent, GameState, Move } from "@/lib/parchis/types";
import { GameSessionError } from "../errors";
import {
  PARTY_PROTOCOL_VERSION,
  type ClientAction,
  type LanPlayerInfo,
  type LanRoster,
  type WireMessage,
} from "../protocol";
import {
  GameSession,
  SessionNotifier,
  type SessionSnapshot,
} from "../session";
import type { GameTransport, TransportKind } from "../transport";

export interface GuestSessionOptions {
  readonly transport: GameTransport;
  readonly player: LanPlayerInfo;
  /** Injected in tests; defaults to `crypto.randomUUID`. */
  readonly newRequestId?: () => string;
}

/**
 * The non-authoritative peer. It never rolls dice or holds the truth: it sends
 * intents with its last seen version and adopts host snapshots.
 */
export class WebRTCGuestSession extends GameSession {
  readonly playerId = "guest" as const;
  readonly transportKind: TransportKind;

  private readonly transport: GameTransport;
  private readonly player: LanPlayerInfo;
  private readonly newRequestId: () => string;
  private readonly notifier = new SessionNotifier();
  private readonly unsubscribe: () => void;

  private game: GameState | null = null;
  private version = 0;
  private status: SessionSnapshot["status"] = "connecting";
  private error: SessionSnapshot["error"] = null;
  private roster: LanRoster | null = null;
  private events: readonly GameEvent[] = [];
  private connected = false;
  private disposed = false;

  constructor(options: GuestSessionOptions) {
    super();
    this.transport = options.transport;
    this.player = options.player;
    this.transportKind = options.transport.kind;
    this.newRequestId =
      options.newRequestId ??
      (() => {
        if (typeof crypto.randomUUID === "function") {
          return crypto.randomUUID();
        }
        const bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      });

    this.unsubscribe = this.transport.subscribe((message) => {
      this.receive(message);
    });

    this.transport.subscribeStatus((next) => {
      if (next === "open") {
        this.connected = true;
        this.setStatus("connected");
        this.sayHello();
      } else if (next === "failed") {
        this.setStatus("failed");
      } else if (next === "closed") {
        this.setStatus(this.game ? "disconnected" : "closed");
      }
    });

    // The channel may already be open when the session is created.
    if (this.transport.status === "open") {
      this.connected = true;
      this.status = "connected";
      this.sayHello();
    }
  }

  get snapshot(): SessionSnapshot {
    return {
      state: this.game,
      version: this.version,
      status: this.status,
      events: this.events,
      error: this.error,
      peer: null,
      roster: this.roster,
    };
  }

  subscribe(listener: Parameters<GameSession["subscribe"]>[0]): () => void {
    return this.notifier.subscribe(listener);
  }

  start(): void {
    throw new GameSessionError("GUEST_CANNOT_START");
  }

  /** Starts the transport (the guest's channel is already open in practice). */
  connect(): void {
    void this.transport.connect().catch(() => {
      this.setStatus("failed");
    });
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

  private sayHello(): void {
    if (!this.connected) {
      return;
    }

    try {
      this.transport.send({
        type: "HELLO",
        protocol: PARTY_PROTOCOL_VERSION,
        role: "guest",
        player: this.player,
      });
    } catch {
      this.setStatus("failed");
    }
  }

  private act(action: ClientAction): void {
    if (!this.game || this.status !== "connected") {
      return;
    }

    try {
      this.transport.send({
        type: "ACTION",
        protocol: PARTY_PROTOCOL_VERSION,
        version: this.version,
        action,
        requestId: this.newRequestId(),
      });
    } catch {
      this.setStatus("failed");
    }
  }

  private receive(message: WireMessage): void {
    if (this.disposed) {
      return;
    }

    switch (message.type) {
      case "START":
        this.roster = message.roster;
        this.game = message.state;
        this.version = message.version;
        this.status = "connected";
        this.error = null;
        this.events = [];
        this.notifier.emit(this.snapshot);
        return;
      case "STATE":
        // Stale or duplicate snapshots are ignored; a gap is repaired by the
        // next snapshot the host broadcasts.
        if (message.version <= this.version) {
          return;
        }
        this.game = message.state;
        this.version = message.version;
        this.status = "connected";
        this.error = null;
        this.events = message.events;
        this.notifier.emit(this.snapshot);
        return;
      case "ERROR":
        this.error = { code: message.code, message: message.message };
        if (message.state && message.version > this.version) {
          this.game = message.state;
          this.version = message.version;
        }
        if (message.code === "PROTOCOL_MISMATCH") {
          this.status = "failed";
        }
        this.notifier.emit(this.snapshot);
        return;
      case "BYE":
        this.status = "disconnected";
        this.notifier.emit(this.snapshot);
        return;
      default:
        return;
    }
  }
}
