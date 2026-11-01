export type GameErrorCode =
  | "INVALID_PLAYERS"
  | "INVALID_ROLL"
  | "INVALID_POSITION"
  | "WRONG_PHASE"
  | "ILLEGAL_MOVE"
  | "MUST_MOVE"
  | "INVALID_BONUS"
  | "INVALID_BARRIER"
  | "GAME_OVER"
  | "INVALID_STATE";

/** Thrown for every invalid action. The input state is never modified. */
export class GameError extends Error {
  readonly code: GameErrorCode;

  constructor(code: GameErrorCode, message: string) {
    super(message);
    this.name = "GameError";
    this.code = code;
  }
}

export function isGameError(value: unknown): value is GameError {
  return value instanceof GameError;
}
