import type { BonusMove, GameEvent, GameState, Move } from "@/lib/parchis/types";
import type {
  LanPlayerInfo,
  LanRoster,
  PartyErrorCode,
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
  readonly peer: LanPlayerInfo | null;
  readonly roster: LanRoster | null;
}

export type SessionListener = (snapshot: SessionSnapshot) => void;

/**
 * The only game API the UI may use. A WebSocket-backed implementation can be
 * added later without changing any caller.
 */
export abstract class GameSession {
  abstract readonly playerId: "host" | "guest";
  abstract readonly transportKind: TransportKind;
  abstract get snapshot(): SessionSnapshot;

  /** Begins the match. Hosts arm the roster; guests cannot start. */
  abstract start(): void;
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
