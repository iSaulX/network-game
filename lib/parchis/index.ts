/**
 * Classic Parchís engine. Pure, deterministic and framework-free:
 * no React, PixiJS, Next.js, DOM or network imports anywhere in this module.
 */
export * from "./constants";
export * from "./types";
export { GameError, isGameError } from "./errors";
export type { GameErrorCode } from "./errors";
export {
  absoluteTrackIndex,
  isSafeTrackIndex,
  getCurrentPlayer,
  getLegalMoves,
  getLegalBonusMoves,
  validateState,
} from "./rules";
export {
  createGame,
  rollDie,
  roll,
  applyMove,
  applyBonusMove,
  pass,
  isFinished,
  getWinnerId,
} from "./engine";
