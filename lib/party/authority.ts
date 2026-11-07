/**
 * Host-authoritative action application, shared by the LAN host session and its
 * tests. Pure and browser-safe: it imports only the engine and wire types.
 *
 * The caller supplies the actor, so the host session can route both its own
 * actions and validated guest intents through exactly the same checks.
 */
import {
  applyBonusMove,
  applyMove,
  chooseBarrier,
  getLegalBonusMoves,
  getLegalMoves,
  isGameError,
  roll,
} from "@/lib/parchis";
import type { DieValue, GameEvent, GameState } from "@/lib/parchis/types";
import type { ClientAction, PartyErrorCode } from "./protocol";

export type AuthoritySuccess = {
  readonly ok: true;
  readonly state: GameState;
  readonly version: number;
  readonly events: readonly GameEvent[];
};

export interface AuthorityFailure {
  readonly ok: false;
  readonly code: PartyErrorCode;
  readonly message: string;
  readonly version: number;
  readonly state: GameState;
}

export type AuthorityResult = AuthoritySuccess | AuthorityFailure;

export interface AuthorityInput {
  readonly state: GameState;
  readonly version: number;
  readonly actorId: string;
  readonly action: ClientAction;
  /** The version the actor claims to have seen; a mismatch is `STALE_VERSION`. */
  readonly expectedVersion?: number;
  /** Injected in tests; the host passes `cryptoDice()` by default. */
  readonly roll?: () => [DieValue, DieValue];
}

/** The events one action appended, in order. */
export function newEvents(previous: GameState, next: GameState): GameEvent[] {
  return next.log.slice(previous.log.length);
}

const ENGINE_CODE_MAP: Readonly<Record<string, PartyErrorCode>> = Object.freeze({
  INVALID_PLAYERS: "BAD_MESSAGE",
  INVALID_ROLL: "BAD_MESSAGE",
  INVALID_POSITION: "BAD_MESSAGE",
  INVALID_STATE: "BAD_MESSAGE",
  WRONG_PHASE: "WRONG_PHASE",
  ILLEGAL_MOVE: "ILLEGAL_MOVE",
  MUST_MOVE: "ILLEGAL_MOVE",
  INVALID_BONUS: "INVALID_BONUS",
  INVALID_BARRIER: "INVALID_BARRIER",
  GAME_OVER: "GAME_OVER",
});

function reject(
  input: AuthorityInput,
  code: PartyErrorCode,
  message: string,
): AuthorityFailure {
  return {
    ok: false,
    code,
    message,
    version: input.version,
    state: input.state,
  };
}

function apply(
  state: GameState,
  action: ClientAction,
  drawDice: () => [DieValue, DieValue],
): GameState {
  switch (action.type) {
    case "ROLL":
      return roll(state, drawDice());
    case "MOVE":
      return applyMove(state, action.move);
    case "BONUS_MOVE":
      return applyBonusMove(state, action.move);
    case "CHOOSE_BARRIER":
      return chooseBarrier(state, action.progress);
  }
}

function requiredPhase(action: ClientAction): GameState["phase"] {
  switch (action.type) {
    case "ROLL":
      return "awaiting-roll";
    case "MOVE":
      return "awaiting-move";
    case "BONUS_MOVE":
      return "awaiting-bonus";
    case "CHOOSE_BARRIER":
      return "awaiting-barrier";
  }
}

/**
 * Validates and applies one action. Nothing is mutated; every failure returns
 * the authoritative state and version unchanged so a peer can resync from it.
 */
export function applyAction(
  input: AuthorityInput,
  drawDice?: () => [DieValue, DieValue],
): AuthorityResult {
  const draw = drawDice ?? input.roll ?? cryptoDice();
  const { state, actorId, action } = input;

  if (state.phase === "finished") {
    return reject(input, "GAME_OVER", "The game is already finished.");
  }

  const actor = state.players.find((player) => player.id === actorId);

  if (!actor) {
    return reject(input, "BAD_MESSAGE", "The actor is not a player in this game.");
  }

  const current = state.players[state.currentPlayerIndex];

  if (!current || current.id !== actorId) {
    return reject(input, "NOT_YOUR_TURN", "It is not this player's turn.");
  }

  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== input.version
  ) {
    return reject(input, "STALE_VERSION", "The game state moved on.");
  }

  if (state.phase !== requiredPhase(action)) {
    return reject(input, "WRONG_PHASE", "The action does not fit the current phase.");
  }

  // A redundant pre-check keeps the reason clear for peers; the engine still
  // re-validates every move, so this is not a trust boundary on its own.
  if (action.type === "MOVE" && !getLegalMoves(state).some((move) =>
    move.tokenId === action.move.tokenId &&
    move.to === action.move.to &&
    move.die === action.move.die,
  )) {
    return reject(input, "ILLEGAL_MOVE", "That move is not legal now.");
  }

  if (
    action.type === "BONUS_MOVE" &&
    !getLegalBonusMoves(state).some((move) =>
      move.kind === action.move.kind &&
      move.tokenId === action.move.tokenId &&
      move.to === action.move.to,
    )
  ) {
    return reject(input, "INVALID_BONUS", "That bonus move is not legal now.");
  }

  let next: GameState;

  try {
    next = apply(state, action, draw);
  } catch (error) {
    if (isGameError(error)) {
      return reject(
        input,
        ENGINE_CODE_MAP[error.code] ?? "BAD_MESSAGE",
        "The engine rejected that action.",
      );
    }
    throw error;
  }

  return {
    ok: true,
    state: next,
    version: input.version + 1,
    events: newEvents(state, next),
  };
}

/**
 * Uniform dice for the host. Rejection sampling keeps 1–6 unbiased instead of
 * folding 0–255 with a modulo. `randomBytes` is injectable for tests.
 */
export function cryptoDice(
  randomBytes: (into: Uint8Array) => Uint8Array = (into) =>
    crypto.getRandomValues(into),
): () => [DieValue, DieValue] {
  return () => {
    const draw = (): DieValue => {
      const buffer = new Uint8Array(1);
      // 252 is the largest multiple of 6 below 256.
      do {
        randomBytes(buffer);
      } while (buffer[0] >= 252);
      return (buffer[0] % 6 + 1) as DieValue;
    };

    return [draw(), draw()];
  };
}

/**
 * Sliding-window limiter per key. Returns true when the call is allowed.
 * Deterministic tests inject `now`.
 */
export function createRateLimiter(
  limit = 12,
  windowMs = 1000,
  now: () => number = () => Date.now(),
): (key: string) => boolean {
  const hits = new Map<string, number[]>();

  return (key: string): boolean => {
    const current = now();
    const recent = (hits.get(key) ?? []).filter((at) => current - at < windowMs);

    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }

    recent.push(current);
    hits.set(key, recent);
    return true;
  };
}
