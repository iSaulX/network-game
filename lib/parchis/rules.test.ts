import { describe, expect, test } from "bun:test";
import {
  HOME_COLUMN_START,
  SAFE_SQUARES,
  START_INDEX,
  absoluteTrackIndex,
  getLegalMoves,
  isSafeTrackIndex,
  roll,
  applyMove,
  pass,
  COLORS,
} from "./index";
import { errorCode, makeState, progressAt, progressOf } from "./test-helpers";

const RED_ALL_OUT = { "red-1": 30, "red-2": 40, "red-3": 50 }; // avoids mandatory-entry on 5

describe("board constants", () => {
  test("12 safe squares: starts plus start+4 and start+11", () => {
    expect(SAFE_SQUARES).toEqual([0, 4, 11, 17, 21, 28, 34, 38, 45, 51, 55, 62]);
    for (const color of COLORS) {
      const s = START_INDEX[color];
      expect(isSafeTrackIndex(s)).toBeTrue();
      expect(isSafeTrackIndex((s + 4) % 68)).toBeTrue();
      expect(isSafeTrackIndex((s + 11) % 68)).toBeTrue();
    }
    expect(isSafeTrackIndex(5)).toBeFalse();
  });

  test("absoluteTrackIndex wraps and covers 64 squares, skipping the 4 before the start", () => {
    expect(absoluteTrackIndex("red", 0)).toBe(0);
    expect(absoluteTrackIndex("red", 63)).toBe(63);
    expect(absoluteTrackIndex("blue", 0)).toBe(17);
    expect(absoluteTrackIndex("green", 20)).toBe(3);
    for (const color of COLORS) {
      const visited = new Set<number>();
      for (let p = 0; p <= 63; p++) visited.add(absoluteTrackIndex(color, p));
      expect(visited.size).toBe(64);
      for (let k = 1; k <= 4; k++) expect(visited.has((START_INDEX[color] - k + 68) % 68)).toBeFalse();
    }
  });

  test("absoluteTrackIndex rejects positions off the outer track", () => {
    expect(errorCode(() => absoluteTrackIndex("red", 64))).toBe("INVALID_POSITION");
    expect(errorCode(() => absoluteTrackIndex("red", -1))).toBe("INVALID_POSITION");
  });
});

describe("16. no capture on safe squares", () => {
  test("cannot land on an opponent on a non-start safe square", () => {
    const s = roll(makeState(["red", "yellow"], { "red-0": 1, ...RED_ALL_OUT, "yellow-0": progressAt("yellow", 4) }), 3);
    expect(getLegalMoves(s).some((m) => m.tokenId === "red-0")).toBeFalse();
  });

  test("cannot land on an opponent sitting on a start square", () => {
    const s = roll(makeState(["red", "blue"], { "red-0": 14, ...RED_ALL_OUT, "blue-0": 0 }), 3);
    expect(getLegalMoves(s).some((m) => m.tokenId === "red-0")).toBeFalse();
  });
});

describe("17. classic safe-square rule", () => {
  test("different colour cannot land, may pass over, same colour may land and form a barrier", () => {
    const yellowOn4 = { "yellow-0": progressAt("yellow", 4) };
    const land = roll(makeState(["red", "yellow"], { "red-0": 0, ...RED_ALL_OUT, ...yellowOn4 }), 4);
    expect(getLegalMoves(land).some((m) => m.tokenId === "red-0")).toBeFalse();

    const passOver = roll(makeState(["red", "yellow"], { "red-0": 1, ...RED_ALL_OUT, ...yellowOn4 }), 4);
    expect(getLegalMoves(passOver)).toContainEqual({ type: "ADVANCE", tokenId: "red-0", to: 5 });

    const own = roll(makeState(["red", "yellow"], { "red-0": 0, "red-1": 4, "red-2": 40, "red-3": 50 }), 4);
    const after = applyMove(own, { type: "ADVANCE", tokenId: "red-0", to: 4 });
    expect(progressOf(after, "red-0")).toBe(4);
    expect(progressOf(after, "red-1")).toBe(4);
  });
});

describe("18. barriers and single tokens", () => {
  test("a single opponent token does not block passage", () => {
    const s = roll(makeState(["red", "yellow"], { "red-0": 10, ...RED_ALL_OUT, "yellow-0": progressAt("yellow", 12) }), 4);
    expect(getLegalMoves(s)).toContainEqual({ type: "ADVANCE", tokenId: "red-0", to: 14 });
  });

  test("an opponent barrier blocks passing and landing", () => {
    const y = progressAt("yellow", 12);
    const base = { "red-0": 10, ...RED_ALL_OUT, "yellow-0": y, "yellow-1": y };
    expect(getLegalMoves(roll(makeState(["red", "yellow"], base), 4)).some((m) => m.tokenId === "red-0")).toBeFalse();
    expect(getLegalMoves(roll(makeState(["red", "yellow"], base), 2)).some((m) => m.tokenId === "red-0")).toBeFalse();
  });

  test("an own barrier blocks the owner's other tokens too", () => {
    const base = { "red-0": 10, "red-1": 12, "red-2": 12, "red-3": 50 };
    expect(getLegalMoves(roll(makeState(["red", "yellow"], base), 4)).some((m) => m.tokenId === "red-0")).toBeFalse();
    expect(getLegalMoves(roll(makeState(["red", "yellow"], base), 2)).some((m) => m.tokenId === "red-0")).toBeFalse();
  });
});

describe("19. barrier tokens can move out", () => {
  test("moving one token out opens the barrier", () => {
    const s = roll(makeState(["red", "yellow"], { "red-0": 12, "red-1": 12, "red-2": 10, "red-3": 50 }), 3);
    expect(getLegalMoves(s)).toContainEqual({ type: "ADVANCE", tokenId: "red-0", to: 15 });
    expect(getLegalMoves(s).some((m) => m.tokenId === "red-2")).toBeFalse(); // 10→13 passes the barrier
    const opened = applyMove(s, { type: "ADVANCE", tokenId: "red-0", to: 15 });
    // Next red roll: red-2 can now pass square 12 (only one token left there).
    const again = roll({ ...opened, currentPlayerIndex: 0, phase: "awaiting-roll" }, 4);
    expect(getLegalMoves(again)).toContainEqual({ type: "ADVANCE", tokenId: "red-2", to: 14 });
  });
});

describe("20. at most two tokens per outer square", () => {
  test("a third token of any colour cannot land", () => {
    const y = progressAt("yellow", 14);
    const s = roll(makeState(["red", "yellow"], { "red-0": 10, ...RED_ALL_OUT, "yellow-0": y, "yellow-1": y }), 4);
    expect(getLegalMoves(s).some((m) => m.tokenId === "red-0")).toBeFalse();
    const own = roll(makeState(["red", "yellow"], { "red-0": 10, "red-1": 14, "red-2": 14, "red-3": 50 }), 4);
    expect(getLegalMoves(own).some((m) => m.tokenId === "red-0")).toBeFalse();
  });
});

describe("21. home column and goal are private", () => {
  test("no occupancy limit and no barriers in the home column", () => {
    const s = roll(makeState(["red", "yellow"], { "red-0": 60, "red-1": 66, "red-2": 66, "red-3": 63 }), 6);
    // 6 counts 7 (all out): red-0 60→67 passes the two tokens on 66; red-3 63→70.
    expect(s.moveDistance).toBe(7);
    expect(getLegalMoves(s)).toContainEqual({ type: "ADVANCE", tokenId: "red-0", to: 67 });
    expect(getLegalMoves(s)).toContainEqual({ type: "ADVANCE", tokenId: "red-3", to: 70 });
    const stack = roll(makeState(["red", "yellow"], { "red-0": 63, "red-1": 66, "red-2": 66, "red-3": 40 }), 3);
    expect(getLegalMoves(stack)).toContainEqual({ type: "ADVANCE", tokenId: "red-0", to: 66 });
  });

  test("home columns of different colours never interact", () => {
    const s = roll(makeState(["red", "blue"], { "red-0": 61, ...RED_ALL_OUT, "blue-0": 64, "blue-1": 64 }), 3);
    expect(getLegalMoves(s)).toContainEqual({ type: "ADVANCE", tokenId: "red-0", to: HOME_COLUMN_START });
  });
});

describe("22. home entrance (progress 63)", () => {
  test("no colour's home entrance is a safe square", () => {
    for (const color of COLORS) expect(isSafeTrackIndex(absoluteTrackIndex(color, 63))).toBeFalse();
  });

  test("an opponent on the entrance can be captured and a barrier there blocks", () => {
    const y = progressAt("yellow", 63);
    const cap = roll(makeState(["red", "yellow"], { "red-0": 60, "red-1": 20, "red-2": 40, "red-3": 50, "yellow-0": y }), 3);
    const after = applyMove(cap, { type: "ADVANCE", tokenId: "red-0", to: 63 });
    expect(progressOf(after, "yellow-0")).toBeNull();

    const block = roll(
      makeState(["red", "yellow"], { "red-0": 60, ...RED_ALL_OUT, "yellow-0": y, "yellow-1": y }),
      6,
    );
    expect(getLegalMoves(block).some((m) => m.tokenId === "red-0")).toBeFalse();
  });
});

describe("23. no legal moves when everything is blocked", () => {
  test("barrier, occupancy and overshoot leave no moves; pass is then allowed", () => {
    const y = progressAt("yellow", 12);
    const s = roll(makeState(["red", "yellow"], { "red-0": 10, "red-1": 69, "yellow-0": y, "yellow-1": y }), 4);
    expect(getLegalMoves(s)).toEqual([]);
    const passed = pass(s);
    expect(passed.currentPlayerIndex).toBe(1);
  });
});
