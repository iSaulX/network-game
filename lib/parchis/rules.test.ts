import { describe, expect, test } from "bun:test";
import {
  COLORS,
  SAFE_SQUARES,
  START_INDEX,
  absoluteTrackIndex,
  getBarrierBreakMoves,
  getLegalMoves,
  getOwnBarriers,
  isSafeTrackIndex,
} from "./index";
import { errorCode, makeRolledState, move, progressAt } from "./test-helpers";

describe("board constants", () => {
  test("12 safe squares: starts plus start+7 and start+12", () => {
    expect(SAFE_SQUARES).toEqual([0, 7, 12, 17, 24, 29, 34, 41, 46, 51, 58, 63]);
    for (const color of COLORS) {
      const start = START_INDEX[color];
      expect(isSafeTrackIndex(start)).toBeTrue();
      expect(isSafeTrackIndex((start + 7) % 68)).toBeTrue();
      expect(isSafeTrackIndex((start + 12) % 68)).toBeTrue();
    }
    expect(isSafeTrackIndex(5)).toBeFalse();
  });

  test("absoluteTrackIndex wraps and rejects non-outer progress", () => {
    expect(absoluteTrackIndex("red", 0)).toBe(0);
    expect(absoluteTrackIndex("blue", 0)).toBe(17);
    expect(absoluteTrackIndex("green", 20)).toBe(3);
    expect(errorCode(() => absoluteTrackIndex("red", 64))).toBe("INVALID_POSITION");
    expect(errorCode(() => absoluteTrackIndex("red", -1))).toBe("INVALID_POSITION");
  });
});

describe("legal moves and occupancy", () => {
  test("a two-token barrier blocks passage and landing", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 10, "red-1": 12, "red-2": 12 },
      [4, 1],
    );
    const moves = getLegalMoves(state);

    expect(moves).not.toContainEqual(move(4, "red-0", 14));
    expect(moves).toContainEqual(move(1, "red-0", 11));
  });

  test("a single token does not block passage", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 10, "red-1": 12 },
      [4, 2],
    );

    expect(getLegalMoves(state)).toContainEqual(move(4, "red-0", 14));
  });

  test("a token that is part of a barrier can move out", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 12, "red-1": 12 },
      [1, 2],
    );
    const moves = getLegalMoves(state);

    expect(moves).toContainEqual(move(1, "red-0", 13));
    expect(moves).toContainEqual(move(1, "red-1", 13));
  });

  test("landing on two tokens is illegal", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 10, "red-1": 14, "red-2": 14 },
      [4, 2],
    );

    expect(getLegalMoves(state)).not.toContainEqual(move(4, "red-0", 14));
  });

  test("same-colour tokens may share a safe square and form a barrier", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 3, "red-1": 4 },
      [1, 2],
    );

    expect(getLegalMoves(state)).toContainEqual(move(1, "red-0", 4));
  });

  test("classic mode forbids landing on an occupied safe square", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      {
        "red-0": 11,
        "yellow-0": progressAt("yellow", 12),
      },
      [1, 2],
    );

    expect(getLegalMoves(state)).not.toContainEqual(move(1, "red-0", 12));
  });

  test("passing over a safe square is allowed", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      {
        "red-0": 9,
        "yellow-0": progressAt("yellow", 12),
      },
      [4, 2],
    );

    expect(getLegalMoves(state)).toContainEqual(move(4, "red-0", 13));
  });

  test("landing on a single opponent on a non-safe square captures", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      {
        "red-0": 10,
        "yellow-0": progressAt("yellow", 14),
      },
      [4, 2],
    );

    expect(getLegalMoves(state)).toContainEqual(move(4, "red-0", 14));
  });

  test("the goal needs an exact roll and goal tokens never move", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 70, "red-1": 71 },
      [2, 1],
    );
    const moves = getLegalMoves(state);

    expect(moves).toContainEqual(move(1, "red-0", 71));
    expect(moves).not.toContainEqual(move(2, "red-0", 72));
    expect(moves.some((item) => item.tokenId === "red-1")).toBeFalse();
  });

  test("home-column moves are private and unlimited", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 64, "red-1": 64 },
      [6, 1],
    );
    const moves = getLegalMoves(state);

    expect(moves).toContainEqual(move(6, "red-0", 70));
    expect(moves).toContainEqual(move(6, "red-1", 70));
  });
});

describe("own barriers", () => {
  test("detects a pair of own tokens on one outer square", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 10, "red-1": 10, "red-2": 30 },
      [2, 4],
    );
    const barriers = getOwnBarriers(state, state.players[0]);

    expect(barriers).toHaveLength(1);
    expect(barriers[0].progress).toBe(10);
    expect(barriers[0].tokens.map((token) => token.id)).toEqual([
      "red-0",
      "red-1",
    ]);
  });

  test("barrier break moves leave one token behind", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 10, "red-1": 10 },
      [2, 4],
    );
    const moves = getBarrierBreakMoves(state, state.players[0], 10);

    expect(moves).toContainEqual(move(2, "red-0", 12));
    expect(moves).toContainEqual(move(4, "red-0", 14));
    expect(moves).toContainEqual(move(2, "red-1", 12));
    expect(moves).toContainEqual(move(4, "red-1", 14));
  });

  test("a blocked barrier has no break moves", () => {
    const state = makeRolledState(
      ["red", "blue"],
      {
        "red-0": 10,
        "red-1": 10,
        "blue-0": 63,
        "blue-1": 63,
      },
      [2, 4],
    );

    expect(getBarrierBreakMoves(state, state.players[0], 10)).toEqual([]);
  });
});
