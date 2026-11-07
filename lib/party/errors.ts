import type { PartyErrorCode } from "./protocol";

/** An expected, recoverable session failure with a stable code. */
export class PartyError extends Error {
  readonly code: PartyErrorCode;

  constructor(code: PartyErrorCode, message: string) {
    super(message);
    this.name = "PartyError";
    this.code = code;
  }
}

export function isPartyError(value: unknown): value is PartyError {
  return value instanceof PartyError;
}

export type SessionErrorReason =
  | "GUEST_CANNOT_START"
  | "NOT_CONNECTED"
  | "NO_STATE";

/** A misuse of the session API, as opposed to a peer or engine rejection. */
export class GameSessionError extends Error {
  readonly reason: SessionErrorReason;

  constructor(reason: SessionErrorReason) {
    super(reason);
    this.name = "GameSessionError";
    this.reason = reason;
  }
}
