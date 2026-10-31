/**
 * Public, JSON-safe types for the classic Parchís engine. The whole state is
 * public information, so it can be broadcast as-is by a network layer.
 */

export type Color = "red" | "blue" | "yellow" | "green";
export type Zone = "yard" | "path" | "goal";
export type Phase = "awaiting-roll" | "awaiting-move" | "awaiting-bonus" | "finished";
export type BonusKind = "capture-20" | "home-10";
export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

export interface Token {
  id: string;
  playerId: string;
  zone: Zone;
  /** null in the yard, 0–70 on the path (64–70 = home column), 71 at the goal. */
  progress: number | null;
}

export interface Player {
  id: string;
  color: Color;
  seat: number;
  tokens: Token[];
}

export interface PlayerConfig {
  id: string;
  color: Color;
}

export interface ActiveBonus {
  kind: BonusKind;
  playerId: string;
}

export interface GameState {
  schemaVersion: 1;
  mode: "classic";
  players: Player[];
  currentPlayerIndex: number;
  phase: Phase;
  lastRoll: DieValue | null;
  /** Distance the current roll moves: a 6 becomes 7 when all tokens are out. */
  moveDistance: number | null;
  consecutiveSixes: number;
  lastMovedTokenId: string | null;
  bonus: ActiveBonus | null;
  winnerId: string | null;
  /** Increments every time the current player changes. */
  turn: number;
  log: GameEvent[];
}

export type Move = { type: "ENTER"; tokenId: string } | { type: "ADVANCE"; tokenId: string; to: number };

export interface BonusMove {
  kind: BonusKind;
  tokenId: string;
  to: number;
}

/**
 * Append-only event log. UI layers animate from these events. Every event
 * carries the `turn` it happened in.
 */
export type GameEvent =
  | { type: "roll"; turn: number; playerId: string; value: DieValue; moveDistance: number }
  | { type: "enter"; turn: number; playerId: string; tokenId: string }
  | { type: "advance"; turn: number; playerId: string; tokenId: string; from: number; to: number }
  | {
      type: "capture";
      turn: number;
      playerId: string;
      tokenId: string;
      capturedPlayerId: string;
      capturedTokenId: string;
      trackIndex: number;
    }
  | {
      type: "bonus-move";
      turn: number;
      playerId: string;
      kind: BonusKind;
      tokenId: string;
      from: number;
      to: number;
    }
  | { type: "bonus-forfeited"; turn: number; playerId: string; kind: BonusKind }
  | { type: "pass"; turn: number; playerId: string; value: DieValue }
  | {
      type: "three-sixes";
      turn: number;
      playerId: string;
      /** Token sent back to the yard, or null when none was eligible. */
      returnedTokenId: string | null;
    }
  | { type: "win"; turn: number; playerId: string };
