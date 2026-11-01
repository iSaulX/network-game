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
  isOnOuterTrack,
  canEnter,
  getCurrentPlayer,
  getRemainingDice,
  getLegalMoves,
  getLegalBonusMoves,
  getOwnBarriers,
  getEligibleOwnBarriers,
  getBarrierBreakMoves,
  pickAutoBarrierBreak,
  computeBonusMoves,
  validateState,
} from "./rules";
export type { OwnBarrier, AutoBarrierBreak } from "./rules";
export {
  createGame,
  rollDie,
  rollDice,
  roll,
  chooseBarrier,
  applyMove,
  applyBonusMove,
  isFinished,
  getWinnerId,
} from "./engine";
export {
  ENGINE_TO_BOARD_COLOR,
  BOARD_TO_ENGINE_COLOR,
  getBoardColor,
  getEngineColor,
  getPlayerBoardColor,
  getTokenViews,
  getDestinationViews,
  getDieViews,
  getBoardAnchorPercent,
  describeProgress,
} from "./presentation";
export type {
  PresentedToken,
  PresentedDestination,
  PresentedDie,
  BoardPercentAnchor,
} from "./presentation";
