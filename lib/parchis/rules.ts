import {
  CAPTURE_BONUS_DISTANCE,
  ENTRY_ROLL,
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
import type { BonusMove, Color, GameState, Move, Player, Token } from "./types";

/**
 * Pure rule helpers. Nothing in this file mutates its arguments.
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

/** True for the 12 safe squares (the four starts plus start+4 and start+11). */
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
  return token.zone === "path" && token.progress !== null && token.progress <= LAST_OUTER_PROGRESS;
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

/** True when every one of the player's tokens has left the yard. */
export function allTokensOut(player: Player): boolean {
  return player.tokens.every((t) => t.zone !== "yard");
}

/** Whether a yard token of this player may be placed on its start square now. */
export function canEnter(state: GameState, player: Player): boolean {
  const occupants = occupantsAt(state, START_INDEX[player.color]);
  if (occupants.length >= MAX_TOKENS_PER_SQUARE) return false;
  return occupants.every((o) => o.player.id === player.id);
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
  const occupants = occupantsAt(state, trackIndex).filter((o) => o.token.id !== token.id);

  if (occupants.length >= MAX_TOKENS_PER_SQUARE) return illegal;
  if (occupants.length === 0) return { legal: true, to, capture: null };

  const [other] = occupants;
  if (other.player.id === player.id) return { legal: true, to, capture: null };
  // Opponent present: illegal on a safe square (classic mode), capture otherwise.
  if (isSafeTrackIndex(trackIndex)) return illegal;
  return { legal: true, to, capture: other };
}

/** Legal moves for the current player in the `awaiting-move` phase. */
export function getLegalMoves(state: GameState): Move[] {
  if (state.phase !== "awaiting-move" || state.lastRoll === null || state.moveDistance === null) {
    return [];
  }
  const player = getCurrentPlayer(state);

  if (state.lastRoll === ENTRY_ROLL) {
    const yardTokens = player.tokens.filter((t) => t.zone === "yard");
    if (yardTokens.length > 0 && canEnter(state, player)) {
      // Entry is mandatory: only ENTER moves are offered.
      return yardTokens.map((t) => ({ type: "ENTER", tokenId: t.id }));
    }
  }

  const moves: Move[] = [];
  for (const token of player.tokens) {
    const check = checkAdvance(state, player, token, state.moveDistance);
    if (check.legal) moves.push({ type: "ADVANCE", tokenId: token.id, to: check.to });
  }
  return moves;
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
  if (state.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (state.mode !== "classic") problems.push('mode must be "classic"');
  if (!Array.isArray(state.players) || state.players.length < 2 || state.players.length > 4) {
    problems.push("players must have 2–4 entries");
    return problems;
  }
  if (
    !Number.isInteger(state.currentPlayerIndex) ||
    state.currentPlayerIndex < 0 ||
    state.currentPlayerIndex >= state.players.length
  ) {
    problems.push("currentPlayerIndex out of range");
  }

  const perSquare = new Map<number, Set<string>>();
  const countPerSquare = new Map<number, number>();
  for (const player of state.players) {
    if (player.tokens.length !== TOKENS_PER_PLAYER) {
      problems.push(`player ${player.id} must have ${TOKENS_PER_PLAYER} tokens`);
    }
    player.tokens.forEach((t, i) => {
      if (t.id !== `${player.id}-${i}`) problems.push(`token id ${t.id} is unstable`);
      if (t.playerId !== player.id) problems.push(`token ${t.id} has the wrong owner`);
      const p = t.progress;
      if (t.zone === "yard" && p !== null) problems.push(`yard token ${t.id} has progress`);
      if (t.zone === "path" && (p === null || !Number.isInteger(p) || p < 0 || p > 70)) {
        problems.push(`path token ${t.id} has invalid progress`);
      }
      if (t.zone === "goal" && p !== GOAL_PROGRESS) problems.push(`goal token ${t.id} not at 71`);
      if (isOnOuterTrack(t)) {
        const idx = absoluteTrackIndex(player.color, p as number);
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

  const finished = state.phase === "finished";
  if (finished !== (state.winnerId !== null)) problems.push("winnerId must be set exactly when finished");
  if (state.phase === "awaiting-bonus" && state.bonus === null) problems.push("awaiting-bonus without bonus");
  if (state.phase !== "awaiting-bonus" && state.bonus !== null) problems.push("bonus set outside awaiting-bonus");
  if (state.phase === "awaiting-move" && (state.lastRoll === null || state.moveDistance === null)) {
    problems.push("awaiting-move without a roll");
  }
  if (state.phase === "awaiting-bonus" && getLegalBonusMoves(state).length === 0) {
    problems.push("awaiting-bonus with no legal bonus move");
  }
  return problems;
}
