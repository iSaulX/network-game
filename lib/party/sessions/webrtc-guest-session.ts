import type { BonusMove, GameEvent, GameState, Move } from "@/lib/parchis/types";
import { GameSessionError } from "../errors";
import {
  PARTY_PROTOCOL_VERSION,
  type ClientAction,
  type GameMode,
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
  /** The seat the server assigned, e.g. `"guest-1"`. */
  readonly playerId: string;
  /** This client's display name and avatar. */
  readonly player: LanPlayerInfo;
  /** Injected in tests; defaults to `crypto.randomUUID`. */
  readonly newRequestId?: () => string;
}

/**
 * The non-authoritative peer. It never rolls dice or holds the truth: it sends
 * intents with its last seen version and adopts host snapshots. It stays in the
 * lobby until the host starts the match.
 */
export class WebRTCGuestSession extends GameSession {
  readonly playerId: string;
  readonly transportKind: TransportKind;

  private readonly transport: GameTransport;
  private readonly player: LanPlayerInfo;
  private readonly newRequestId: () => string;
  private readonly notifier = new SessionNotifier();
  private readonly unsubscribe: () => void;
  private readonly unsubscribeStatus: () => void;

  private game: GameState | null = null;
  private version = 0;
  private status: SessionSnapshot["status"] = "idle";
  private error: SessionSnapshot["error"] = null;
  private lobby: readonly LanPlayerInfo[] = [];
  private emptySeats: readonly string[] = [];
  private roster: LanRoster | null = null;
  private mode: GameMode = "1v1";
  private disconnected: readonly string[] = [];
  private eventsValue: readonly GameEvent[] = [];
  private connected = false;
  private disposed = false;

  constructor(options: GuestSessionOptions) {
    super();
    this.transport = options.transport;
    this.playerId = options.playerId;
    this.player = { ...options.player, id: options.playerId as LanPlayerInfo["id"] };
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

    this.unsubscribeStatus = this.transport.subscribeStatus((next) => {
      if (next === "open") {
        this.connected = true;
        this.status = "connected";
        this.sayHello();
        this.notifier.emit(this.snapshot);
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
      events: this.eventsValue,
      error: this.error,
      lobby: this.lobby,
      emptySeats: this.emptySeats,
      roster: this.roster,
      disconnected: this.disconnected,
      mode: this.mode,
    };
  }

  subscribe(listener: Parameters<GameSession["subscribe"]>[0]): () => void {
    return this.notifier.subscribe(listener);
  }

  start(): void {
    throw new GameSessionError("GUEST_CANNOT_START");
  }

  /** Guests cannot change the room's seats; the host owns the lobby. */
  setSeatEmpty(): void {
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
    this.unsubscribeStatus();
    this.notifier.clear();
    this.transport.close();
    this.status = "closed";
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
        player: this.player,
      });
    } catch {
      this.setStatus("failed");
    }
  }

  private act(action: ClientAction): void {
    if (!this.game || this.status !== "connected" || this.disposed) {
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
      case "LOBBY":
        this.mode = message.mode;
        this.lobby = message.players;
        this.emptySeats = message.emptySeats ?? [];
        this.status = "connected";
        this.notifier.emit(this.snapshot);
        return;
      case "START":
        this.mode = message.mode;
        this.roster = message.roster;
        this.game = message.state;
        this.version = message.version;
        this.lobby = message.roster.players.filter(
          (item) => !item.id.startsWith("bot-"),
        );
        this.status = "connected";
        this.error = null;
        this.eventsValue = [];
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
        this.eventsValue = message.events;
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
