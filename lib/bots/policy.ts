import {
  CAPTURE_BONUS_DISTANCE,
  GOAL_PROGRESS,
  HOME_BONUS_DISTANCE,
  LAST_OUTER_PROGRESS,
  START_INDEX,
  TRACK_LENGTH,
  absoluteTrackIndex,
  chooseBarrier as applyBarrierChoice,
  getLegalBonusMoves,
  getLegalMoves,
  isSafeTrackIndex,
  type BonusMove,
  type GameState,
  type Move,
  type Player,
  type Token,
} from "../parchis";
import { checkAdvance, getOwnBarriers, occupantsAt } from "../parchis/rules";

/**
 * Tunable one-ply heuristic. Captures beat goals, goals beat forming a
 * barrier, and a barrier beats a safe/progress move. The small progress term
 * breaks most remaining ties; risky landings and breaking an owned barrier
 * are penalized.
 */
export const BOT_WEIGHTS = Object.freeze({
  capture: 1000,
  goal: 800,
  barrier: 300,
  safe: 150,
  risk: -200,
  breakBarrier: -150,
  progress: 1,
});

const WIN_WEIGHT = 10_000;
const BARRIER_KEEP_WEIGHT = 50;

type ScoredMove<T extends Move | BonusMove> = {
  move: T;
  score: number;
  to: number;
  tokenId: string;
};

function currentPlayer(state: GameState, playerId: string): Player | null {
  const player = state.players[state.currentPlayerIndex];
  return player?.id === playerId ? player : null;
}

function findToken(player: Player, tokenId: string): Token | undefined {
  return player.tokens.find((token) => token.id === tokenId);
}

function isBreakingOwnBarrier(
  state: GameState,
  player: Player,
  token: Token,
): boolean {
  if (token.progress === null || token.progress > LAST_OUTER_PROGRESS) {
    return false;
  }

  return getOwnBarriers(state, player).some(
    (barrier) => barrier.progress === token.progress,
  );
}

/**
 * A non-safe destination with an opponent token 1–6 squares behind is a
 * capture risk next turn. Safe squares and newly formed barriers are exempt.
 */
function isRiskyLanding(
  state: GameState,
  player: Player,
  targetTrack: number | null,
  safe: boolean,
  formsBarrier: boolean,
): boolean {
  if (targetTrack === null || safe || formsBarrier) return false;

  for (const opponent of state.players) {
    if (opponent.id === player.id) continue;

    for (const token of opponent.tokens) {
      if (
        token.zone !== "path" ||
        token.progress === null ||
        token.progress > LAST_OUTER_PROGRESS
      ) {
        continue;
      }

      const targetProgress =
        (targetTrack - START_INDEX[opponent.color] + TRACK_LENGTH) %
        TRACK_LENGTH;

      // The four squares before an opponent's start are never traversed.
      if (targetProgress > LAST_OUTER_PROGRESS) continue;

      const gap = targetProgress - token.progress;
      if (gap >= 1 && gap <= 6) return true;
    }
  }

  return false;
}

/**
 * Scores one landing. The move is assumed to come from `getLegalMoves` or
 * `getLegalBonusMoves`; an illegal check is still treated as impossible.
 */
function scoreLanding(
  state: GameState,
  player: Player,
  token: Token,
  to: number,
  distance: number,
): number | null {
  const check = checkAdvance(state, player, token, distance);
  if (!check.legal || check.to !== to) return null;

  const targetTrack =
    to <= LAST_OUTER_PROGRESS
      ? absoluteTrackIndex(player.color, to)
      : null;
  const targetOccupants =
    targetTrack === null ? [] : occupantsAt(state, targetTrack);
  const formsBarrier = targetOccupants.some(
    (occupant) => occupant.player.id === player.id,
  );
  const safe =
    targetTrack !== null && isSafeTrackIndex(targetTrack);
  const risky = isRiskyLanding(
    state,
    player,
    targetTrack,
    safe,
    formsBarrier,
  );
  const breakingBarrier = isBreakingOwnBarrier(state, player, token);
  const reachedGoal = to === GOAL_PROGRESS;

  let score = to * BOT_WEIGHTS.progress;

  if (check.capture) score += BOT_WEIGHTS.capture;
  if (reachedGoal) score += BOT_WEIGHTS.goal;
  if (formsBarrier) score += BOT_WEIGHTS.barrier;
  if (safe) score += BOT_WEIGHTS.safe;
  if (risky) score += BOT_WEIGHTS.risk;
  if (breakingBarrier && !check.capture && !reachedGoal) {
    score += BOT_WEIGHTS.breakBarrier;
  }

  return score;
}

function sortScored<T extends Move | BonusMove>(
  scored: Array<ScoredMove<T>>,
): Array<ScoredMove<T>> {
  return scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.to - a.to ||
      a.tokenId.localeCompare(b.tokenId),
  );
}

/** Deterministic best legal normal move for the current player. */
export function chooseMove(
  state: GameState,
  playerId: string,
): Move | null {
  const player = currentPlayer(state, playerId);
  if (!player || state.phase !== "awaiting-move" || state.dice === null) {
    return null;
  }

  const scored: Array<ScoredMove<Move>> = [];

  for (const move of getLegalMoves(state)) {
    const token = findToken(player, move.tokenId);
    if (!token) continue;

    const score = scoreLanding(
      state,
      player,
      token,
      move.to,
      move.die,
    );
    if (score === null) continue;

    scored.push({
      move,
      score,
      to: move.to,
      tokenId: move.tokenId,
    });
  }

  return sortScored(scored)[0]?.move ?? null;
}

/** Deterministic best legal bonus move; the kind fixes the 20/10 distance. */
export function chooseBonusMove(
  state: GameState,
  playerId: string,
): BonusMove | null {
  const player = currentPlayer(state, playerId);
  if (!player || state.phase !== "awaiting-bonus" || state.bonus === null) {
    return null;
  }

  const distance =
    state.bonus.kind === "capture-20"
      ? CAPTURE_BONUS_DISTANCE
      : HOME_BONUS_DISTANCE;
  const scored: Array<ScoredMove<BonusMove>> = [];

  for (const move of getLegalBonusMoves(state)) {
    const token = findToken(player, move.tokenId);
    if (!token) continue;

    const score = scoreLanding(state, player, token, move.to, distance);
    if (score === null) continue;

    scored.push({
      move,
      score,
      to: move.to,
      tokenId: move.tokenId,
    });
  }

  return sortScored(scored)[0]?.move ?? null;
}

/**
 * Chooses one of several breakable own barriers by simulating the engine's
 * deterministic break for each option and scoring the resulting position.
 */
export function chooseBarrier(
  state: GameState,
  playerId: string,
): number | null {
  if (
    state.phase !== "awaiting-barrier" ||
    state.barrierChoice === null ||
    state.barrierChoice.playerId !== playerId
  ) {
    return null;
  }

  let best: { progress: number; score: number } | null = null;
  const logLength = state.log.length;

  for (const progress of state.barrierChoice.squares) {
    try {
      const after = applyBarrierChoice(state, progress);
      const player = after.players.find((item) => item.id === playerId);
      if (!player) continue;

      let score = 0;
      for (const token of player.tokens) {
        if (token.zone === "goal") score += 200;
        else if (token.zone === "path" && token.progress !== null) {
          score += token.progress;
        }
      }

      score += getOwnBarriers(after, player).length * BARRIER_KEEP_WEIGHT;

      const newEvents = after.log.slice(logLength);
      score +=
        newEvents.filter(
          (event) => event.type === "capture" && event.playerId === playerId,
        ).length * BOT_WEIGHTS.capture;

      if (after.phase === "finished" && after.winnerId === playerId) {
        score += WIN_WEIGHT;
      }

      if (!best || score > best.score) {
        best = { progress, score };
      }
    } catch {
      // A malformed option is skipped; the caller falls back to the first
      // engine-provided choice below.
    }
  }

  return best?.progress ?? state.barrierChoice.squares[0] ?? null;
}
