import {
  CAPTURE_BONUS_DISTANCE,
  GOAL_PROGRESS,
  HOME_BONUS_DISTANCE,
  LAST_OUTER_PROGRESS,
  MAX_TOKENS_PER_SQUARE,
  SAFE_SQUARES,
  START_INDEX,
  TOKENS_PER_PLAYER,
  TRACK_LENGTH,
} from "./constants";
import { GameError } from "./errors";
import type {
  BonusMove,
  Color,
  DieValue,
  GameState,
  Move,
  Player,
  Token,
} from "./types";

/**
 * Pure rule helpers for the two-dice classic variant. Nothing in this file
 * mutates its arguments.
 */

const SAFE_SET = new Set<number>(SAFE_SQUARES);

/** Absolute outer-track index (0…67) for a colour's route progress 0…63. */
export function absoluteTrackIndex(color: Color, progress: number): number {
  if (!Number.isInteger(progress) || progress < 0 || progress > LAST_OUTER_PROGRESS) {
    throw new GameError(
      "INVALID_POSITION",
      `Progress ${progress} is not on the outer track (0–${LAST_OUTER_PROGRESS}).`,
    );
  }
  return (START_INDEX[color] + progress) % TRACK_LENGTH;
}

/** True for the 12 safe squares (the four starts plus start+7 and start+12). */
export function isSafeTrackIndex(index: number): boolean {
  return SAFE_SET.has(index);
}

export function getCurrentPlayer(state: GameState): Player {
  const player = state.players[state.currentPlayerIndex];
  if (!player) {
    throw new GameError("INVALID_STATE", `No player at index ${state.currentPlayerIndex}.`);
  }
  return player;
}

export function isOnOuterTrack(token: Token): boolean {
  return (
    token.zone === "path" &&
    token.progress !== null &&
    Number.isInteger(token.progress) &&
    token.progress >= 0 &&
    token.progress <= LAST_OUTER_PROGRESS
  );
}

/** A token that sits on the outer track, with its owner and absolute square. */
export interface TrackOccupant {
  token: Token;
  player: Player;
  trackIndex: number;
}

/** Tokens currently on the given absolute outer-track square. */
export function occupantsAt(state: GameState, trackIndex: number): TrackOccupant[] {
  const result: TrackOccupant[] = [];
  for (const player of state.players) {
    for (const token of player.tokens) {
      if (isOnOuterTrack(token)) {
        const idx = absoluteTrackIndex(player.color, token.progress as number);
        if (idx === trackIndex) result.push({ token, player, trackIndex: idx });
      }
    }
  }
  return result;
}

/** A barrier is two tokens on one outer square (always the same colour in classic mode). */
export function isBarrierAt(state: GameState, trackIndex: number): boolean {
  return occupantsAt(state, trackIndex).length >= MAX_TOKENS_PER_SQUARE;
}

/** Whether a yard token of this player may be placed on its start square now. */
export function canEnter(state: GameState, player: Player): boolean {
  const occupants = occupantsAt(state, START_INDEX[player.color]);
  if (occupants.length >= MAX_TOKENS_PER_SQUARE) return false;
  return occupants.every((occupant) => occupant.player.id === player.id);
}

/** Result of evaluating a single forward move for one token. */
export interface MoveCheck {
  legal: boolean;
  to: number;
  /** Opponent token that would be captured by landing, if any. */
  capture: TrackOccupant | null;
}

/**
 * Evaluates moving `token` (on the path) forward by exactly `distance` squares.
 * Applies: exact goal, barriers on every square strictly between, 2-token limit,
 * classic safe-square rule (no mixed colours), and capture on non-safe squares.
 */
export function checkAdvance(
  state: GameState,
  player: Player,
  token: Token,
  distance: number,
): MoveCheck {
  const illegal: MoveCheck = { legal: false, to: -1, capture: null };
  if (token.zone !== "path" || token.progress === null) return illegal;

  const from = token.progress;
  const to = from + distance;
  if (distance <= 0 || to > GOAL_PROGRESS) return illegal;

  // Barriers block passage on the outer track only.
  for (let p = from + 1; p < to; p++) {
    if (p > LAST_OUTER_PROGRESS) break;
    if (isBarrierAt(state, absoluteTrackIndex(player.color, p))) return illegal;
  }

  // Home column and goal are private: no limits, no captures.
  if (to > LAST_OUTER_PROGRESS) return { legal: true, to, capture: null };

  const trackIndex = absoluteTrackIndex(player.color, to);
  const occupants = occupantsAt(state, trackIndex).filter(
    (occupant) => occupant.token.id !== token.id,
  );

  if (occupants.length >= MAX_TOKENS_PER_SQUARE) return illegal;
  if (occupants.length === 0) return { legal: true, to, capture: null };

  const [other] = occupants;
  if (other.player.id === player.id) return { legal: true, to, capture: null };
  // Opponent present: illegal on a safe square (classic mode), capture otherwise.
  if (isSafeTrackIndex(trackIndex)) return illegal;
  return { legal: true, to, capture: other };
}

/** Unspent dice values for the current roll, with duplicates preserved. */
export function getRemainingDice(state: GameState): DieValue[] {
  if (!state.dice) return [];
  return state.dice.filter((die) => !die.used).map((die) => die.value);
}

/** Distinct unspent die values, in roll order. */
function uniqueRemainingDice(state: GameState): DieValue[] {
  const values: DieValue[] = [];
  for (const value of getRemainingDice(state)) {
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

/** Legal moves for the current player in the `awaiting-move` phase, one per die. */
export function getLegalMoves(state: GameState): Move[] {
  if (state.phase !== "awaiting-move" || state.dice === null) return [];
  const player = getCurrentPlayer(state);
  const moves: Move[] = [];

  for (const die of uniqueRemainingDice(state)) {
    for (const token of player.tokens) {
      const check = checkAdvance(state, player, token, die);
      if (check.legal) {
        moves.push({ type: "ADVANCE", tokenId: token.id, to: check.to, die });
      }
    }
  }

  return moves;
}

/** A pair of own tokens sitting together on the outer track. */
export interface OwnBarrier {
  /** The player's progress value of the shared square. */
  progress: number;
  tokens: Token[];
}

/** The current player's own barriers, ordered by route progress. */
export function getOwnBarriers(state: GameState, player: Player): OwnBarrier[] {
  const byProgress = new Map<number, Token[]>();

  for (const token of player.tokens) {
    if (!isOnOuterTrack(token)) continue;
    const progress = token.progress as number;
    const bucket = byProgress.get(progress);
    if (bucket) bucket.push(token);
    else byProgress.set(progress, [token]);
  }

  return [...byProgress.entries()]
    .filter(([, tokens]) => tokens.length >= MAX_TOKENS_PER_SQUARE)
    .sort(([a], [b]) => a - b)
    .map(([progress, tokens]) => ({ progress, tokens }));
}

/** Legal moves that would leave one token on a chosen own barrier square. */
export function getBarrierBreakMoves(
  state: GameState,
  player: Player,
  progress: number,
): Move[] {
  const barrier = getOwnBarriers(state, player).find(
    (item) => item.progress === progress,
  );
  if (!barrier) return [];

  const moves: Move[] = [];
  for (const die of uniqueRemainingDice(state)) {
    for (const token of barrier.tokens) {
      const check = checkAdvance(state, player, token, die);
      if (check.legal) {
        moves.push({ type: "ADVANCE", tokenId: token.id, to: check.to, die });
      }
    }
  }
  return moves;
}

/** Own barriers that at least one remaining die can break. */
export function getEligibleOwnBarriers(
  state: GameState,
  player: Player,
): OwnBarrier[] {
  return getOwnBarriers(state, player).filter(
    (barrier) => getBarrierBreakMoves(state, player, barrier.progress).length > 0,
  );
}

/** Deterministic auto-break chosen by the engine when a barrier is automatic. */
export interface AutoBarrierBreak {
  move: Move;
  dieIndex: number;
  progress: number;
  tokenId: string;
  to: number;
}

export function pickAutoBarrierBreak(
  state: GameState,
  player: Player,
  progress: number,
): AutoBarrierBreak | null {
  const barrier = getOwnBarriers(state, player).find(
    (item) => item.progress === progress,
  );
  if (!barrier || state.dice === null) return null;

  // First legal move in token order, then dice order. The engine documents this
  // stable choice because the player does not choose the automatic break.
  for (const token of barrier.tokens) {
    for (let dieIndex = 0; dieIndex < state.dice.length; dieIndex += 1) {
      const die = state.dice[dieIndex];
      if (die.used) continue;
      const check = checkAdvance(state, player, token, die.value);
      if (check.legal) {
        return {
          move: {
            type: "ADVANCE",
            tokenId: token.id,
            to: check.to,
            die: die.value,
          },
          dieIndex,
          progress,
          tokenId: token.id,
          to: check.to,
        };
      }
    }
  }

  return null;
}

/** Legal bonus moves for the current player in the `awaiting-bonus` phase. */
export function getLegalBonusMoves(state: GameState): BonusMove[] {
  if (state.phase !== "awaiting-bonus" || state.bonus === null) return [];
  return computeBonusMoves(state, state.bonus.kind);
}

/** Bonus moves of the given kind for the current player, regardless of phase. */
export function computeBonusMoves(state: GameState, kind: BonusMove["kind"]): BonusMove[] {
  const player = getCurrentPlayer(state);
  const distance = kind === "capture-20" ? CAPTURE_BONUS_DISTANCE : HOME_BONUS_DISTANCE;
  const moves: BonusMove[] = [];

  for (const token of player.tokens) {
    const check = checkAdvance(state, player, token, distance);
    if (check.legal) moves.push({ kind, tokenId: token.id, to: check.to });
  }
  return moves;
}

/**
 * Checks the structural invariants of a state. Returns a list of problems
 * (empty when valid). Used by tests and as a guard for untrusted input.
 */
export function validateState(state: GameState): string[] {
  const problems: string[] = [];
  if (state.schemaVersion !== 2) problems.push("schemaVersion must be 2");
  if (state.mode !== "classic") problems.push('mode must be "classic"');
  if (!Array.isArray(state.players) || state.players.length < 2 || state.players.length > 4) {
    problems.push("players must have 2–4 entries");
    return problems;
  }

  const currentPlayerValid =
    Number.isInteger(state.currentPlayerIndex) &&
    state.currentPlayerIndex >= 0 &&
    state.currentPlayerIndex < state.players.length;

  if (!currentPlayerValid) problems.push("currentPlayerIndex out of range");

  if (state.dice !== null) {
    if (!Array.isArray(state.dice) || state.dice.length !== 2) {
      problems.push("dice must be null or a pair");
    } else {
      for (const die of state.dice) {
        if (!Number.isInteger(die.value) || die.value < 1 || die.value > 6) {
          problems.push(`die value ${String(die.value)} is invalid`);
        }
        if (typeof die.used !== "boolean") problems.push("die.used must be boolean");
      }
    }
  }

  if (!Number.isInteger(state.consecutiveDoubles) || state.consecutiveDoubles < 0) {
    problems.push("consecutiveDoubles must be a non-negative integer");
  }

  const perSquare = new Map<number, Set<string>>();
  const countPerSquare = new Map<number, number>();

  for (const player of state.players) {
    if (player.tokens.length !== TOKENS_PER_PLAYER) {
      problems.push(`player ${player.id} must have ${TOKENS_PER_PLAYER} tokens`);
    }

    player.tokens.forEach((token, index) => {
      if (token.id !== `${player.id}-${index}`) problems.push(`token id ${token.id} is unstable`);
      if (token.playerId !== player.id) problems.push(`token ${token.id} has the wrong owner`);

      const progress = token.progress;

      if (token.zone === "yard" && progress !== null) {
        problems.push(`yard token ${token.id} has progress`);
      }
      if (token.zone === "path" && (progress === null || !Number.isInteger(progress) || progress < 0 || progress > 70)) {
        problems.push(`path token ${token.id} has invalid progress`);
      }
      if (token.zone === "goal" && progress !== GOAL_PROGRESS) {
        problems.push(`goal token ${token.id} not at 71`);
      }

      if (isOnOuterTrack(token)) {
        const idx = absoluteTrackIndex(player.color, progress as number);
        countPerSquare.set(idx, (countPerSquare.get(idx) ?? 0) + 1);
        const colors = perSquare.get(idx) ?? new Set<string>();
        colors.add(player.color);
        perSquare.set(idx, colors);
      }
    });
  }

  for (const [idx, count] of countPerSquare) {
    if (count > MAX_TOKENS_PER_SQUARE) problems.push(`square ${idx} has ${count} tokens`);
  }
  for (const [idx, colors] of perSquare) {
    if (colors.size > 1) problems.push(`square ${idx} has mixed colours`);
  }

  if ((state.phase === "finished") !== (state.winnerId !== null)) {
    problems.push("winnerId must be set exactly when finished");
  }

  if (state.phase === "awaiting-bonus" && state.bonus === null) {
    problems.push("awaiting-bonus without bonus");
  }
  if (state.phase !== "awaiting-bonus" && state.bonus !== null) {
    problems.push("bonus set outside awaiting-bonus");
  }

  if (state.phase === "awaiting-barrier" && state.barrierChoice === null) {
    problems.push("awaiting-barrier without barrierChoice");
  }
  if (state.phase !== "awaiting-barrier" && state.barrierChoice !== null) {
    problems.push("barrierChoice set outside awaiting-barrier");
  }

  if (state.phase === "awaiting-move" && state.dice === null) {
    problems.push("awaiting-move without dice");
  }
  if (state.phase === "awaiting-barrier" && state.dice === null) {
    problems.push("awaiting-barrier without dice");
  }

  if (state.phase === "awaiting-move" && state.dice !== null) {
    if (getRemainingDice(state).length === 0) {
      problems.push("awaiting-move without remaining dice");
    } else if (currentPlayerValid && getLegalMoves(state).length === 0) {
      problems.push("awaiting-move with no legal moves");
    }
  }

  if (state.phase === "awaiting-barrier" && state.barrierChoice !== null && currentPlayerValid) {
    const player = state.players[state.currentPlayerIndex];
    const eligible = new Set(
      getEligibleOwnBarriers(state, player).map((barrier) => barrier.progress),
    );

    if (state.barrierChoice.playerId !== player.id) {
      problems.push("barrierChoice player does not match the current player");
    }
    if (state.barrierChoice.squares.length === 0) {
      problems.push("barrierChoice has no squares");
    }
    for (const square of state.barrierChoice.squares) {
      if (!eligible.has(square)) problems.push(`barrier square ${square} is not breakable`);
    }
  }

  if (state.phase === "awaiting-bonus" && currentPlayerValid && getLegalBonusMoves(state).length === 0) {
    problems.push("awaiting-bonus with no legal bonus move");
  }

  return problems;
}
