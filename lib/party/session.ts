import type { BonusMove, GameEvent, GameState, Move } from "@/lib/parchis/types";
import type {
  GameMode,
  LanPlayerInfo,
  LanRoster,
  PartyErrorCode,
  SeatConnection,
} from "./protocol";
import type { TransportKind } from "./transport";

export type SessionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

export interface SessionError {
  readonly code: PartyErrorCode;
  readonly message: string;
}

export interface SessionSnapshot {
  readonly state: GameState | null;
  readonly version: number;
  readonly status: SessionStatus;
  /** Events appended by the update that produced this snapshot. */
  readonly events: readonly GameEvent[];
  readonly error: SessionError | null;
  /** Seats in the lobby before the match: host first, connected guests next. */
  readonly lobby: readonly LanPlayerInfo[];
  /** Seats the host left unoccupied; they are not filled by bots. */
  readonly emptySeats: readonly string[];
  /** Full roster once the match starts, bots included; null before that. */
  readonly roster: LanRoster | null;
  /** Seats whose connection dropped mid-match (their turn is played by a bot). */
  readonly disconnected: readonly string[];
  readonly mode: GameMode;
  /**
   * How each human seat is connected (direct, STUN or TURN relay). The host
   * knows every guest; a guest also receives the host's map over the wire.
   */
  readonly connections: Readonly<Record<string, SeatConnection>>;
}

export type SessionListener = (snapshot: SessionSnapshot) => void;

/**
 * The only game API the UI may use. A WebSocket-backed implementation can be
 * added later without changing any caller.
 */
export abstract class GameSession {
  abstract readonly playerId: string;
  abstract readonly transportKind: TransportKind;
  abstract get snapshot(): SessionSnapshot;

  /** Begins the match. Only the host implements it; guests throw. */
  abstract start(): void;
  /** Host only: leaves a seat unoccupied (no bot) or fills it again. */
  abstract setSeatEmpty(seatId: string, empty: boolean): void;
  /** Records how a seat is connected so every screen can show it. */
  abstract setSeatConnection(seatId: string, connection: SeatConnection): void;
  abstract roll(): void;
  abstract move(move: Move): void;
  abstract bonusMove(move: BonusMove): void;
  abstract chooseBarrier(progress: number): void;
  abstract subscribe(listener: SessionListener): () => void;
  abstract dispose(): void;
}

/** Shared notifier for subclass sessions. */
export class SessionNotifier {
  private readonly listeners = new Set<SessionListener>();

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(snapshot: SessionSnapshot): void {
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
