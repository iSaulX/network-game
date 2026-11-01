import {
  DOUBLES_PENALTY_COUNT,
  GOAL_PROGRESS,
  MAX_PLAYERS,
  MIN_PLAYERS,
} from "./constants";
import { GameError } from "./errors";
import {
  absoluteTrackIndex,
  canEnter,
  checkAdvance,
  computeBonusMoves,
  getCurrentPlayer,
  getEligibleOwnBarriers,
  getLegalBonusMoves,
  getLegalMoves,
  getOwnBarriers,
  getRemainingDice,
  isOnOuterTrack,
  pickAutoBarrierBreak,
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

  for (const player of players) {
    if (!player || typeof player.id !== "string" || player.id.length === 0) {
      throw new GameError("INVALID_PLAYERS", "Every player needs a non-empty string id.");
    }
    if (!["red", "blue", "yellow", "green"].includes(player.color)) {
      throw new GameError("INVALID_PLAYERS", `Unknown colour "${String(player.color)}".`);
    }
    if (ids.has(player.id)) throw new GameError("INVALID_PLAYERS", `Duplicate player id "${player.id}".`);
    if (colors.has(player.color)) throw new GameError("INVALID_PLAYERS", `Duplicate colour "${player.color}".`);
    ids.add(player.id);
    colors.add(player.color);
  }

  return {
    schemaVersion: 2,
    mode: "classic",
    players: players.map((player, seat) => ({
      id: player.id,
      color: player.color,
      seat,
      tokens: Array.from({ length: 4 }, (_, index) => ({
        id: `${player.id}-${index}`,
        playerId: player.id,
        zone: "yard" as const,
        progress: null,
      })),
    })),
    currentPlayerIndex: 0,
    phase: "awaiting-roll",
    dice: null,
    consecutiveDoubles: 0,
    lastMovedTokenId: null,
    bonus: null,
    barrierChoice: null,
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

/** Rolls the two dice of a turn. */
export function rollDice(random: () => number = Math.random): [DieValue, DieValue] {
  return [rollDie(random), rollDie(random)];
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

/** Records the two dice for the current player and resolves all auto effects. */
export function roll(state: GameState, dice: [DieValue, DieValue]): GameState {
  assertPhase(state, "awaiting-roll");
  assertDice(dice);

  const draft = cloneState(state);
  const player = getCurrentPlayer(draft);
  const [first, second] = dice;
  const isDouble = first === second;
  const doubles = isDouble ? state.consecutiveDoubles + 1 : 0;

  if (isDouble && doubles >= DOUBLES_PENALTY_COUNT) {
    // Third consecutive double: no entry, no barrier, no movement. The last
    // token moved this turn returns to the yard when it is on the outer track.
    draft.log.push({
      type: "roll",
      turn: draft.turn,
      playerId: player.id,
      dice: [first, second],
    });

    let returnedTokenId: string | null = null;
    if (state.lastMovedTokenId !== null) {
      const token = findToken(player, state.lastMovedTokenId);
      if (token && isOnOuterTrack(token)) {
        token.zone = "yard";
        token.progress = null;
        returnedTokenId = token.id;
      }
    }

    draft.log.push({
      type: "three-doubles",
      turn: draft.turn,
      playerId: player.id,
      returnedTokenId,
    });
    return advanceToNextPlayer(draft);
  }

  draft.dice = [
    { value: first, used: false },
    { value: second, used: false },
  ];
  draft.consecutiveDoubles = doubles;
  draft.phase = "awaiting-move";
  draft.bonus = null;
  draft.barrierChoice = null;
  draft.log.push({
    type: "roll",
    turn: draft.turn,
    playerId: player.id,
    dice: [first, second],
  });

  autoEntries(draft);

  if (getRemainingDice(draft).length === 0) return autoEndTurn(draft);

  const bothEven = first % 2 === 0 && second % 2 === 0;
  if (bothEven) return resolveOwnBarrierRule(draft);

  return autoEndTurn(draft);
}

/** Picks one of the eligible own barriers during `awaiting-barrier`. */
export function chooseBarrier(state: GameState, progress: number): GameState {
  assertPhase(state, "awaiting-barrier");
  if (!state.barrierChoice || !state.barrierChoice.squares.includes(progress)) {
    throw new GameError("INVALID_BARRIER", `Barrier ${progress} is not an eligible choice.`);
  }

  const draft = cloneState(state);
  const player = getCurrentPlayer(draft);
  draft.barrierChoice = null;
  return executeAutoBarrierBreak(draft, player, progress, false);
}

/** Applies one legal die move. The die is spent; the other die may remain. */
export function applyMove(state: GameState, move: Move): GameState {
  assertPhase(state, "awaiting-move");
  const legal = getLegalMoves(state);
  if (
    !move ||
    move.type !== "ADVANCE" ||
    !legal.some(
      (item) =>
        item.tokenId === move.tokenId &&
        item.to === move.to &&
        item.die === move.die,
    )
  ) {
    throw new GameError("ILLEGAL_MOVE", `Move ${JSON.stringify(move)} is not legal now.`);
  }

  const draft = cloneState(state);
  const player = getCurrentPlayer(draft);
  consumeDie(draft, move.die);
  const token = findToken(player, move.tokenId) as Token;
  const { captured, reachedGoal } = advanceToken(
    draft,
    player,
    token,
    move.to,
    (from, to) => ({
      type: "advance",
      turn: draft.turn,
      playerId: player.id,
      tokenId: token.id,
      from,
      to,
      die: move.die,
    }),
  );

  if (reachedGoal && hasWon(player)) return declareWinner(draft, player);
  if (captured) return startBonus(draft, "capture-20");
  if (reachedGoal) return startBonus(draft, "home-10");
  return autoEndTurn(draft);
}

/** Applies a mandatory bonus move; the dice are not spent by a bonus. */
export function applyBonusMove(state: GameState, move: BonusMove): GameState {
  assertPhase(state, "awaiting-bonus");
  const bonus = state.bonus;
  const legal = getLegalBonusMoves(state);

  if (
    !bonus ||
    !move ||
    move.kind !== bonus.kind ||
    !legal.some((item) => item.kind === move.kind && item.tokenId === move.tokenId && item.to === move.to)
  ) {
    throw new GameError("INVALID_BONUS", `Bonus move ${JSON.stringify(move)} is not legal now.`);
  }

  const draft = cloneState(state);
  const player = getCurrentPlayer(draft);
  const token = findToken(player, move.tokenId) as Token;
  const { reachedGoal } = advanceToken(
    draft,
    player,
    token,
    move.to,
    (from, to) => ({
      type: "bonus-move",
      turn: draft.turn,
      playerId: player.id,
      kind: bonus.kind,
      tokenId: token.id,
      from,
      to,
    }),
  );

  draft.bonus = null;
  draft.phase = "awaiting-move";
  if (reachedGoal && hasWon(player)) return declareWinner(draft, player);
  return autoEndTurn(draft);
}

// ---------------------------------------------------------------------------
// Automatic roll effects
// ---------------------------------------------------------------------------

/**
 * Mandatory yard entries. A 5 die brings one token out and is spent; a 5+5
 * brings two out when the start allows it; a total of 5 (1+4, 2+3) brings one
 * token out and spends both dice. If the start is blocked, the 5 remains a
 * normal movement die.
 */
function autoEntries(draft: GameState): void {
  const player = getCurrentPlayer(draft);
  const pair = draft.dice;
  if (!pair) return;

  const yardTokens = player.tokens.filter((token) => token.zone === "yard");
  if (yardTokens.length === 0 || !canEnter(draft, player)) return;

  const sum = pair[0].value + pair[1].value;

  if (sum === 5) {
    const token = player.tokens.find((item) => item.zone === "yard") as Token;
    enterToken(draft, player, token, null);
    pair[0].used = true;
    pair[1].used = true;
    return;
  }

  for (const die of pair) {
    if (die.used || die.value !== 5) continue;
    const token = player.tokens.find((item) => item.zone === "yard");
    if (!token || !canEnter(draft, player)) continue;
    enterToken(draft, player, token, 5);
    die.used = true;
  }
}

function enterToken(
  draft: GameState,
  player: Player,
  token: Token,
  die: DieValue | null,
): void {
  token.zone = "path";
  token.progress = 0;
  draft.lastMovedTokenId = token.id;
  draft.log.push({
    type: "enter",
    turn: draft.turn,
    playerId: player.id,
    tokenId: token.id,
    die,
  });
}

/**
 * Both dice even: one own barrier must be broken with one die. One eligible
 * barrier is broken automatically; two or more wait for the player's choice.
 * If an own barrier exists but neither die can break one, the turn is skipped.
 */
function resolveOwnBarrierRule(draft: GameState): GameState {
  const player = getCurrentPlayer(draft);
  const own = getOwnBarriers(draft, player);
  if (own.length === 0) return autoEndTurn(draft);

  const eligible = getEligibleOwnBarriers(draft, player);
  if (eligible.length === 0) {
    draft.log.push({
      type: "pass",
      turn: draft.turn,
      playerId: player.id,
      dice: dicePair(draft),
    });
    return advanceToNextPlayer(draft);
  }

  if (eligible.length === 1) {
    return executeAutoBarrierBreak(draft, player, eligible[0].progress, true);
  }

  draft.phase = "awaiting-barrier";
  draft.barrierChoice = {
    playerId: player.id,
    squares: eligible.map((barrier) => barrier.progress),
  };
  return draft;
}

function executeAutoBarrierBreak(
  draft: GameState,
  player: Player,
  progress: number,
  automatic: boolean,
): GameState {
  const picked = pickAutoBarrierBreak(draft, player, progress);
  if (!picked || draft.dice === null) {
    throw new GameError("INVALID_STATE", "No legal automatic barrier break.");
  }

  draft.dice[picked.dieIndex].used = true;
  draft.barrierChoice = null;
  const token = findToken(player, picked.tokenId) as Token;

  const { captured, reachedGoal } = advanceToken(
    draft,
    player,
    token,
    picked.to,
    (from, to) => ({
      type: "barrier-break",
      turn: draft.turn,
      playerId: player.id,
      tokenId: token.id,
      from,
      to,
      die: picked.move.die,
      square: progress,
      automatic,
    }),
  );

  draft.phase = "awaiting-move";
  if (reachedGoal && hasWon(player)) return declareWinner(draft, player);
  if (captured) return startBonus(draft, "capture-20");
  if (reachedGoal) return startBonus(draft, "home-10");
  return autoEndTurn(draft);
}

// ---------------------------------------------------------------------------
// Internal helpers (operate on a private draft)
// ---------------------------------------------------------------------------

function assertPhase(state: GameState, expected: GameState["phase"]): void {
  if (!state || state.schemaVersion !== 2 || state.mode !== "classic" || !Array.isArray(state.players)) {
    throw new GameError("INVALID_STATE", "Not a valid classic Parchís state.");
  }
  if (state.phase === "finished") throw new GameError("GAME_OVER", "The game is already finished.");
  if (state.phase !== expected) {
    throw new GameError("WRONG_PHASE", `Expected phase "${expected}", but the game is in "${state.phase}".`);
  }
}

function assertDice(dice: [DieValue, DieValue]): void {
  if (
    !Array.isArray(dice) ||
    dice.length !== 2 ||
    dice.some((value) => !Number.isInteger(value) || value < 1 || value > 6)
  ) {
    throw new GameError("INVALID_ROLL", `Two die values 1–6 are required, got ${JSON.stringify(dice)}.`);
  }
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      tokens: player.tokens.map((token) => ({ ...token })),
    })),
    dice: state.dice
      ? [{ ...state.dice[0] }, { ...state.dice[1] }]
      : null,
    bonus: state.bonus ? { ...state.bonus } : null,
    barrierChoice: state.barrierChoice
      ? {
          ...state.barrierChoice,
          squares: [...state.barrierChoice.squares],
        }
      : null,
    log: state.log.slice(),
  };
}

function findToken(player: Player, tokenId: string): Token | undefined {
  return player.tokens.find((token) => token.id === tokenId);
}

function hasWon(player: Player): boolean {
  return player.tokens.every((token) => token.zone === "goal");
}

function dicePair(state: GameState): [DieValue, DieValue] | null {
  return state.dice
    ? [state.dice[0].value, state.dice[1].value]
    : null;
}

function consumeDie(draft: GameState, value: DieValue): void {
  const die = draft.dice?.find((item) => !item.used && item.value === value);
  if (!die) {
    throw new GameError("INVALID_STATE", `Die ${value} is not available.`);
  }
  die.used = true;
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
      draft.players.find((item) => item.id === check.capture!.player.id) as Player,
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

/** Enters the bonus phase, or forfeits it and continues with the remaining dice. */
function startBonus(draft: GameState, kind: BonusKind): GameState {
  const player = getCurrentPlayer(draft);
  if (computeBonusMoves(draft, kind).length === 0) {
    draft.log.push({
      type: "bonus-forfeited",
      turn: draft.turn,
      playerId: player.id,
      kind,
    });
    draft.bonus = null;
    draft.phase = "awaiting-move";
    return autoEndTurn(draft);
  }

  draft.phase = "awaiting-bonus";
  draft.bonus = { kind, playerId: player.id };
  draft.barrierChoice = null;
  return draft;
}

function declareWinner(draft: GameState, player: Player): GameState {
  draft.phase = "finished";
  draft.winnerId = player.id;
  draft.bonus = null;
  draft.barrierChoice = null;
  draft.log.push({ type: "win", turn: draft.turn, playerId: player.id });
  return draft;
}

/**
 * Continues the turn while a remaining die has a legal move. When the dice are
 * exhausted, or no remaining die can move, the turn ends automatically.
 */
function autoEndTurn(draft: GameState): GameState {
  if (
    draft.phase === "finished" ||
    draft.phase === "awaiting-bonus" ||
    draft.phase === "awaiting-barrier"
  ) {
    return draft;
  }

  const remaining = getRemainingDice(draft);
  if (remaining.length > 0) {
    draft.phase = "awaiting-move";
    if (getLegalMoves(draft).length > 0) return draft;

    draft.log.push({
      type: "pass",
      turn: draft.turn,
      playerId: getCurrentPlayer(draft).id,
      dice: dicePair(draft),
    });
  }

  return finishTurn(draft);
}

/** Extra roll after a double, otherwise the next seat. */
function finishTurn(draft: GameState): GameState {
  const pair = draft.dice;
  const isDouble = pair !== null && pair[0].value === pair[1].value;

  if (
    isDouble &&
    draft.consecutiveDoubles > 0 &&
    draft.consecutiveDoubles < DOUBLES_PENALTY_COUNT
  ) {
    draft.phase = "awaiting-roll";
    draft.dice = null;
    draft.bonus = null;
    draft.barrierChoice = null;
    return draft;
  }

  return advanceToNextPlayer(draft);
}

function advanceToNextPlayer(draft: GameState): GameState {
  draft.currentPlayerIndex = (draft.currentPlayerIndex + 1) % draft.players.length;
  draft.turn += 1;
  draft.phase = "awaiting-roll";
  draft.dice = null;
  draft.consecutiveDoubles = 0;
  draft.lastMovedTokenId = null;
  draft.bonus = null;
  draft.barrierChoice = null;
  return draft;
}
