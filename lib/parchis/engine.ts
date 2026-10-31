import {
  COLORS,
  GOAL_PROGRESS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  SIXES_PENALTY_COUNT,
  SIX_DISTANCE_ALL_OUT,
  TOKENS_PER_PLAYER,
} from "./constants";
import { GameError } from "./errors";
import {
  absoluteTrackIndex,
  allTokensOut,
  checkAdvance,
  computeBonusMoves,
  getCurrentPlayer,
  getLegalBonusMoves,
  getLegalMoves,
  isOnOuterTrack,
} from "./rules";
import type {
  BonusKind,
  BonusMove,
  DieValue,
  GameEvent,
  GameState,
  Move,
  Player,
  PlayerConfig,
  Token,
} from "./types";

/*
 * Every exported action is pure: it validates first, then works on a private
 * copy of the players/tokens and returns a brand-new state. The input state
 * (which may be deep-frozen) is never touched. Events are immutable objects,
 * so the log array is copied shallowly and only ever appended to.
 */

// ---------------------------------------------------------------------------
// Setup and dice
// ---------------------------------------------------------------------------

export function createGame(players: PlayerConfig[]): GameState {
  if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new GameError("INVALID_PLAYERS", `A game needs ${MIN_PLAYERS}–${MAX_PLAYERS} players.`);
  }
  const ids = new Set<string>();
  const colors = new Set<string>();
  for (const p of players) {
    if (!p || typeof p.id !== "string" || p.id.length === 0) {
      throw new GameError("INVALID_PLAYERS", "Every player needs a non-empty string id.");
    }
    if (!COLORS.includes(p.color)) {
      throw new GameError("INVALID_PLAYERS", `Unknown colour "${String(p.color)}".`);
    }
    if (ids.has(p.id)) throw new GameError("INVALID_PLAYERS", `Duplicate player id "${p.id}".`);
    if (colors.has(p.color)) throw new GameError("INVALID_PLAYERS", `Duplicate colour "${p.color}".`);
    ids.add(p.id);
    colors.add(p.color);
  }

  return {
    schemaVersion: 1,
    mode: "classic",
    players: players.map((p, seat) => ({
      id: p.id,
      color: p.color,
      seat,
      tokens: Array.from({ length: TOKENS_PER_PLAYER }, (_, i) => ({
        id: `${p.id}-${i}`,
        playerId: p.id,
        zone: "yard" as const,
        progress: null,
      })),
    })),
    currentPlayerIndex: 0,
    phase: "awaiting-roll",
    lastRoll: null,
    moveDistance: null,
    consecutiveSixes: 0,
    lastMovedTokenId: null,
    bonus: null,
    winnerId: null,
    turn: 1,
    log: [],
  };
}

/** Rolls one d6. Pass a seeded `random` (returning [0, 1)) for determinism. */
export function rollDie(random: () => number = Math.random): DieValue {
  const r = random();
  const value = Math.min(6, Math.max(1, Math.floor(r * 6) + 1));
  return value as DieValue;
}

export function isFinished(state: GameState): boolean {
  return state.phase === "finished";
}

export function getWinnerId(state: GameState): string | null {
  return state.winnerId;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Records the die value for the current player. Handles the three-sixes penalty. */
export function roll(state: GameState, value: DieValue): GameState {
  assertPhase(state, "awaiting-roll");
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new GameError("INVALID_ROLL", `Die value must be an integer 1–6, got ${String(value)}.`);
  }

  const draft = cloneState(state);
  const player = getCurrentPlayer(draft);
  const sixes = value === 6 ? state.consecutiveSixes + 1 : 0;

  if (value === 6 && sixes >= SIXES_PENALTY_COUNT) {
    // Third 6: no move. The token most recently moved this turn goes home if on the outer track.
    let returnedTokenId: string | null = null;
    if (state.lastMovedTokenId !== null) {
      const token = findToken(player, state.lastMovedTokenId);
      if (token && isOnOuterTrack(token)) {
        token.zone = "yard";
        token.progress = null;
        returnedTokenId = token.id;
      }
    }
    draft.log.push({ type: "roll", turn: draft.turn, playerId: player.id, value, moveDistance: 0 });
    draft.log.push({ type: "three-sixes", turn: draft.turn, playerId: player.id, returnedTokenId });
    return advanceToNextPlayer(draft);
  }

  const moveDistance = value === 6 && allTokensOut(player) ? SIX_DISTANCE_ALL_OUT : value;
  draft.lastRoll = value;
  draft.moveDistance = moveDistance;
  draft.consecutiveSixes = sixes;
  draft.phase = "awaiting-move";
  draft.log.push({ type: "roll", turn: draft.turn, playerId: player.id, value, moveDistance });
  return draft;
}

/** Applies one of `getLegalMoves(state)`. Resolves captures, bonuses, win and turn flow. */
export function applyMove(state: GameState, move: Move): GameState {
  assertPhase(state, "awaiting-move");
  const legal = getLegalMoves(state);
  if (!legal.some((m) => sameMove(m, move))) {
    throw new GameError("ILLEGAL_MOVE", `Move ${JSON.stringify(move)} is not legal now.`);
  }

  const draft = cloneState(state);
  const player = getCurrentPlayer(draft);
  const token = findToken(player, move.tokenId) as Token;

  if (move.type === "ENTER") {
    token.zone = "path";
    token.progress = 0;
    draft.lastMovedTokenId = token.id;
    draft.log.push({ type: "enter", turn: draft.turn, playerId: player.id, tokenId: token.id });
    return finishAction(draft);
  }

  const { captured, reachedGoal } = advanceToken(draft, player, token, move.to, (from, to) => ({
    type: "advance",
    turn: draft.turn,
    playerId: player.id,
    tokenId: token.id,
    from,
    to,
  }));

  if (reachedGoal && hasWon(player)) return declareWinner(draft, player);
  if (captured) return startBonus(draft, "capture-20");
  if (reachedGoal) return startBonus(draft, "home-10");
  return finishAction(draft);
}

/** Applies one of `getLegalBonusMoves(state)`. A bonus never chains another bonus. */
export function applyBonusMove(state: GameState, move: BonusMove): GameState {
  assertPhase(state, "awaiting-bonus");
  const bonus = state.bonus;
  const legal = getLegalBonusMoves(state);
  if (
    !bonus ||
    !move ||
    move.kind !== bonus.kind ||
    !legal.some((m) => m.kind === move.kind && m.tokenId === move.tokenId && m.to === move.to)
  ) {
    throw new GameError("INVALID_BONUS", `Bonus move ${JSON.stringify(move)} is not legal now.`);
  }

  const draft = cloneState(state);
  const player = getCurrentPlayer(draft);
  const token = findToken(player, move.tokenId) as Token;

  const { reachedGoal } = advanceToken(draft, player, token, move.to, (from, to) => ({
    type: "bonus-move",
    turn: draft.turn,
    playerId: player.id,
    kind: bonus.kind,
    tokenId: token.id,
    from,
    to,
  }));

  draft.bonus = null;
  if (reachedGoal && hasWon(player)) return declareWinner(draft, player);
  return finishAction(draft);
}

/** Ends the roll when no legal move exists. A passed 6 still grants another roll. */
export function pass(state: GameState): GameState {
  assertPhase(state, "awaiting-move");
  if (getLegalMoves(state).length > 0) {
    throw new GameError("MUST_MOVE", "A legal move exists; the player must move.");
  }
  const draft = cloneState(state);
  const player = getCurrentPlayer(draft);
  draft.log.push({
    type: "pass",
    turn: draft.turn,
    playerId: player.id,
    value: state.lastRoll as DieValue,
  });
  return finishAction(draft);
}

// ---------------------------------------------------------------------------
// Internal helpers (operate on a private draft)
// ---------------------------------------------------------------------------

function assertPhase(state: GameState, expected: GameState["phase"]): void {
  if (!state || state.schemaVersion !== 1 || state.mode !== "classic" || !Array.isArray(state.players)) {
    throw new GameError("INVALID_STATE", "Not a valid classic Parchís state.");
  }
  if (state.phase === "finished") throw new GameError("GAME_OVER", "The game is already finished.");
  if (state.phase !== expected) {
    throw new GameError("WRONG_PHASE", `Expected phase "${expected}", but the game is in "${state.phase}".`);
  }
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, tokens: p.tokens.map((t) => ({ ...t })) })),
    bonus: state.bonus ? { ...state.bonus } : null,
    log: state.log.slice(),
  };
}

function findToken(player: Player, tokenId: string): Token | undefined {
  return player.tokens.find((t) => t.id === tokenId);
}

function sameMove(a: Move, b: Move): boolean {
  if (!b || a.type !== b.type || a.tokenId !== b.tokenId) return false;
  return a.type === "ENTER" || (b.type === "ADVANCE" && a.to === b.to);
}

function hasWon(player: Player): boolean {
  return player.tokens.every((t) => t.zone === "goal");
}

/**
 * Moves an already-validated token to `to`, logging the move and any capture.
 * The capture is resolved against the draft before the token lands.
 */
function advanceToken(
  draft: GameState,
  player: Player,
  token: Token,
  to: number,
  makeEvent: (from: number, to: number) => GameEvent,
): { captured: boolean; reachedGoal: boolean } {
  const from = token.progress as number;
  const check = checkAdvance(draft, player, token, to - from);
  if (!check.legal || check.to !== to) {
    throw new GameError("INVALID_STATE", "Validated move became illegal while resolving.");
  }

  token.progress = to;
  token.zone = to === GOAL_PROGRESS ? "goal" : "path";
  draft.lastMovedTokenId = token.id;
  draft.log.push(makeEvent(from, to));

  let captured = false;
  if (check.capture) {
    const victim = check.capture.token;
    const victimToken = findToken(
      draft.players.find((p) => p.id === check.capture!.player.id) as Player,
      victim.id,
    ) as Token;
    victimToken.zone = "yard";
    victimToken.progress = null;
    captured = true;
    draft.log.push({
      type: "capture",
      turn: draft.turn,
      playerId: player.id,
      tokenId: token.id,
      capturedPlayerId: check.capture.player.id,
      capturedTokenId: victim.id,
      trackIndex: absoluteTrackIndex(player.color, to),
    });
  }
  return { captured, reachedGoal: to === GOAL_PROGRESS };
}

/** Enters the bonus phase, or forfeits (and logs) the bonus when no legal move exists. */
function startBonus(draft: GameState, kind: BonusKind): GameState {
  const player = getCurrentPlayer(draft);
  if (computeBonusMoves(draft, kind).length === 0) {
    draft.log.push({ type: "bonus-forfeited", turn: draft.turn, playerId: player.id, kind });
    return finishAction(draft);
  }
  draft.phase = "awaiting-bonus";
  draft.moveDistance = null;
  draft.bonus = { kind, playerId: player.id };
  return draft;
}

function declareWinner(draft: GameState, player: Player): GameState {
  draft.phase = "finished";
  draft.winnerId = player.id;
  draft.bonus = null;
  draft.moveDistance = null;
  draft.log.push({ type: "win", turn: draft.turn, playerId: player.id });
  return draft;
}

/** After a fully resolved roll: extra roll on a 6, otherwise the next seat plays. */
function finishAction(draft: GameState): GameState {
  draft.bonus = null;
  if (draft.lastRoll === 6) {
    draft.phase = "awaiting-roll";
    draft.moveDistance = null;
    return draft;
  }
  return advanceToNextPlayer(draft);
}

function advanceToNextPlayer(draft: GameState): GameState {
  draft.currentPlayerIndex = (draft.currentPlayerIndex + 1) % draft.players.length;
  draft.turn += 1;
  draft.phase = "awaiting-roll";
  draft.lastRoll = null;
  draft.moveDistance = null;
  draft.consecutiveSixes = 0;
  draft.lastMovedTokenId = null;
  draft.bonus = null;
  return draft;
}
