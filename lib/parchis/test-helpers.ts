/**
 * Test-only helpers for building arbitrary board positions. Not exported from
 * the public `lib/parchis` entry point.
 */
import { GOAL_PROGRESS, LAST_OUTER_PROGRESS, START_INDEX, TRACK_LENGTH } from "./constants";
import { createGame } from "./engine";
import type { Color, DieValue, GameState } from "./types";

/** Recursively freezes a value so any mutation throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Route progress (0…63) that puts a token of `color` on absolute square `trackIndex`. */
export function progressAt(color: Color, trackIndex: number): number {
  const progress = (trackIndex - START_INDEX[color] + TRACK_LENGTH) % TRACK_LENGTH;
  if (progress > LAST_OUTER_PROGRESS) {
    throw new Error(`${color} never visits square ${trackIndex} (skipped before its start).`);
  }
  return progress;
}

/**
 * Builds a deep-frozen state. Player ids equal their colour, so token ids are
 * "red-0", "blue-2", etc. `positions` maps token id → progress (null = yard,
 * 71 = goal); unlisted tokens stay in the yard.
 */
export function makeState(
  colors: Color[],
  positions: Record<string, number | null> = {},
  overrides: Partial<GameState> = {},
): GameState {
  const base = createGame(colors.map((color) => ({ id: color, color })));
  const state: GameState = {
    ...base,
    ...overrides,
    players: base.players.map((player) => ({
      ...player,
      tokens: player.tokens.map((token) => {
        const progress = token.id in positions ? positions[token.id] : null;
        if (progress === null) return { ...token, zone: "yard" as const, progress: null };
        if (progress === GOAL_PROGRESS) return { ...token, zone: "goal" as const, progress };
        return { ...token, zone: "path" as const, progress };
      }),
    })),
  };
  return deepFreeze(state);
}

/** A deeper-frozen state already in `awaiting-move` with both dice unspent. */
export function makeRolledState(
  colors: Color[],
  positions: Record<string, number | null>,
  dice: [DieValue, DieValue],
  overrides: Partial<GameState> = {},
): GameState {
  return makeState(colors, positions, {
    phase: "awaiting-move",
    dice: [
      { value: dice[0], used: false },
      { value: dice[1], used: false },
    ],
    bonus: null,
    barrierChoice: null,
    ...overrides,
  });
}

/** A move object for the current roll. */
export function move(die: DieValue, tokenId: string, to: number) {
  return { type: "ADVANCE" as const, tokenId, to, die };
}

/** Seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Progress of a token by id. */
export function progressOf(state: GameState, tokenId: string): number | null {
  for (const player of state.players) {
    const token = player.tokens.find((item) => item.id === tokenId);
    if (token) return token.progress;
  }
  throw new Error(`No token ${tokenId}`);
}

/** Runs `fn` and returns the thrown error's code (or "NO_THROW"). */
export function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code ?? "UNKNOWN";
  }
  return "NO_THROW";
}
