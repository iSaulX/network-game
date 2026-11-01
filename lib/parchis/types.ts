/**
 * Public, JSON-safe types for the two-dice classic Parchís engine. The whole
 * state is public information, so it can be broadcast as-is by a network layer.
 */

export type Color = "red" | "blue" | "yellow" | "green";
export type Zone = "yard" | "path" | "goal";
export type Phase =
  | "awaiting-roll"
  | "awaiting-move"
  | "awaiting-barrier"
  | "awaiting-bonus"
  | "finished";
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

/** One die of the current roll. A used die is spent for this turn. */
export interface DieState {
  value: DieValue;
  used: boolean;
}

export interface ActiveBonus {
  kind: BonusKind;
  playerId: string;
}

/**
 * Set while the current player must choose which own barrier two even dice
 * will break. `squares` are the player's outer-track progress values.
 */
export interface BarrierChoice {
  playerId: string;
  squares: number[];
}

export interface GameState {
  schemaVersion: 2;
  mode: "classic";
  players: Player[];
  currentPlayerIndex: number;
  phase: Phase;
  /** The current two-dice roll, or null between turns. */
  dice: [DieState, DieState] | null;
  /** Consecutive doubles in the current turn (extra rolls included). */
  consecutiveDoubles: number;
  lastMovedTokenId: string | null;
  bonus: ActiveBonus | null;
  barrierChoice: BarrierChoice | null;
  winnerId: string | null;
  /** Increments every time the current player changes. */
  turn: number;
  log: GameEvent[];
}

/**
 * A player move spends exactly one remaining die. The two dice are never
 * summed; applying both to the same token is two consecutive moves.
 */
export type Move = {
  type: "ADVANCE";
  tokenId: string;
  to: number;
  die: DieValue;
};

export interface BonusMove {
  kind: BonusKind;
  tokenId: string;
  to: number;
}

/**
 * Append-only event log. UI layers animate and narrate from these events.
 * Every event carries the `turn` it happened in.
 */
export type GameEvent =
  | {
      type: "roll";
      turn: number;
      playerId: string;
      dice: [DieValue, DieValue];
    }
  | {
      type: "enter";
      turn: number;
      playerId: string;
      tokenId: string;
      /** The 5 that opened the yard, or null for a sum-of-five entry. */
      die: DieValue | null;
    }
  | {
      type: "advance";
      turn: number;
      playerId: string;
      tokenId: string;
      from: number;
      to: number;
      die: DieValue;
    }
  | {
      type: "barrier-break";
      turn: number;
      playerId: string;
      tokenId: string;
      from: number;
      to: number;
      die: DieValue;
      /** The player's progress value of the barrier square. */
      square: number;
      /** True when the engine picked the barrier automatically. */
      automatic: boolean;
    }
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
  | {
      type: "pass";
      turn: number;
      playerId: string;
      dice: [DieValue, DieValue] | null;
    }
  | {
      type: "three-doubles";
      turn: number;
      playerId: string;
      /** Token sent back to the yard, or null when none was eligible. */
      returnedTokenId: string | null;
    }
  | { type: "win"; turn: number; playerId: string };
