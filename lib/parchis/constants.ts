import type { Color } from "./types";

/**
 * Board geometry for classic Parchís. These values are part of the public
 * contract: the PixiJS board must render exactly this layout.
 */

/** Number of squares on the shared outer track, indexed 0…67. */
export const TRACK_LENGTH = 68;

/** Last progress value on the shared outer track (the home entrance). */
export const LAST_OUTER_PROGRESS = 63;

/** First and last progress values of the private home column (7 squares). */
export const HOME_COLUMN_START = 64;
export const HOME_COLUMN_END = 70;

/** Progress value of the goal. */
export const GOAL_PROGRESS = 71;

/** Tokens per player. */
export const TOKENS_PER_PLAYER = 4;

/** Player count limits. */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** Maximum tokens on one outer square (two same-colour tokens form a barrier). */
export const MAX_TOKENS_PER_SQUARE = 2;

/** The die value that releases a token from the yard. */
export const ENTRY_ROLL = 5;

/** Number of consecutive doubles that triggers the penalty. */
export const DOUBLES_PENALTY_COUNT = 3;

/** Bonus distances. */
export const CAPTURE_BONUS_DISTANCE = 20;
export const HOME_BONUS_DISTANCE = 10;

/** Valid colours, in board order. */
export const COLORS: readonly Color[] = ["red", "blue", "yellow", "green"];

/** Absolute outer-track index of each colour's start square. */
export const START_INDEX: Readonly<Record<Color, number>> = {
  red: 0,
  blue: 17,
  yellow: 34,
  green: 51,
};

/** The four start squares (all safe). */
export const START_SQUARES: readonly number[] = [0, 17, 34, 51];

/**
 * The eight non-start safe squares: start + 7 and start + 12 for each colour.
 * These map to the brown/dark squares painted around the artwork's board.
 */
export const EXTRA_SAFE_SQUARES: readonly number[] = [7, 12, 24, 29, 41, 46, 58, 63];

/** All 12 safe squares on the outer track, sorted. */
export const SAFE_SQUARES: readonly number[] = [...START_SQUARES, ...EXTRA_SAFE_SQUARES].sort(
  (a, b) => a - b,
);
