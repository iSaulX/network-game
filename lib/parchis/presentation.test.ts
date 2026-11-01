import { describe, expect, test } from "bun:test";
import {
  GOAL_PROGRESS,
  getStartSquare,
  getYardSlotAnchor,
  isMarkedSafeSquare,
  progressToSquare,
  squareToCell,
  type ParchisColor,
} from "./board-geometry";
import { applyMove, createGame, roll } from "./engine";
import {
  BOARD_TO_ENGINE_COLOR,
  ENGINE_TO_BOARD_COLOR,
  describeProgress,
  getBoardAnchorPercent,
  getDestinationViews,
  getDieViews,
  getTokenViews,
} from "./presentation";
import { absoluteTrackIndex, getLegalMoves, isSafeTrackIndex } from "./rules";
import { makeRolledState, makeState, move } from "./test-helpers";
import type { GameState } from "./types";

const TWO = [
  { id: "red", color: "red" as const },
  { id: "yellow", color: "yellow" as const },
];

const TWO_COLORS: Array<"red" | "yellow"> = ["red", "yellow"];

const BOARD_COLORS: readonly ParchisColor[] = [
  "green",
  "blue",
  "red",
  "yellow",
];

describe("engine colour mapping", () => {
  test("maps every engine colour to the artwork corner with the same start offset", () => {
    expect(ENGINE_TO_BOARD_COLOR).toEqual({
      red: "green",
      blue: "blue",
      yellow: "red",
      green: "yellow",
    });

    for (const boardColor of BOARD_COLORS) {
      const engineColor = BOARD_TO_ENGINE_COLOR[boardColor];
      expect(ENGINE_TO_BOARD_COLOR[engineColor]).toBe(boardColor);
      expect(progressToSquare(boardColor, 0)).toBe(getStartSquare(boardColor));
    }
  });

  test("the painted safety marks match the engine's start + 7 / + 12 set", () => {
    for (const boardColor of BOARD_COLORS) {
      const engineColor = BOARD_TO_ENGINE_COLOR[boardColor];

      // The four starts are safe but keep their corridor colour.
      expect(isMarkedSafeSquare(getStartSquare(boardColor))).toBeFalse();

      for (const distance of [7, 12]) {
        const boardSquare = progressToSquare(boardColor, distance);
        const engineIndex = absoluteTrackIndex(engineColor, distance);

        expect(isMarkedSafeSquare(boardSquare)).toBeTrue();
        expect(isSafeTrackIndex(engineIndex)).toBeTrue();
      }
    }
  });
});

describe("token presentation", () => {
  test("starts with four tokens in distinct yard slots per colour", () => {
    const state = createGame(TWO);
    const views = getTokenViews(state);

    expect(views).toHaveLength(8);

    for (const view of views) {
      expect(view.zone).toBe("yard");
      expect(view.progress).toBeNull();
      expect(view.radius).toBeGreaterThan(1);
    }

    const firstPlayer = views.filter((view) => view.playerId === "red");
    expect(new Set(firstPlayer.map((view) => `${view.anchor.x},${view.anchor.y}`)).size).toBe(4);
    firstPlayer.forEach((view, index) => {
      expect(view.anchor).toEqual(getYardSlotAnchor("green", index));
    });
  });

  test("places an entered token on the artwork start square of its mapped colour", () => {
    let state = createGame(TWO);
    state = roll(state, [5, 2]);

    const view = getTokenViews(state).find((item) => item.id === "red-0");
    expect(view).toBeDefined();
    expect(view!.zone).toBe("path");
    expect(view!.color).toBe("green");
    expect(view!.anchor).toEqual(squareToCell(getStartSquare("green")).center);
  });

  test("fans out double-5 entries sharing the start square", () => {
    let state = createGame(TWO);
    state = roll(state, [5, 5]);

    const entered = getTokenViews(state).filter(
      (view) => view.playerId === "red" && view.zone === "path",
    );
    expect(entered).toHaveLength(2);
    expect(entered[0].anchor).not.toEqual(entered[1].anchor);
    expect(entered[0].radius).toBeLessThan(0.7);

    const start = squareToCell(getStartSquare("green")).center;
    for (const view of entered) {
      expect(Math.hypot(view.anchor.x - start.x, view.anchor.y - start.y)).toBeLessThan(0.6);
    }
  });

  test("clusters four goal tokens without overlapping their anchors", () => {
    const state = makeState(TWO_COLORS, {
      "red-0": GOAL_PROGRESS,
      "red-1": GOAL_PROGRESS,
      "red-2": GOAL_PROGRESS,
      "red-3": GOAL_PROGRESS,
    });

    const goalTokens = getTokenViews(state).filter((view) => view.playerId === "red");
    expect(goalTokens).toHaveLength(4);
    expect(new Set(goalTokens.map((view) => `${view.anchor.x},${view.anchor.y}`)).size).toBe(4);

    for (const view of goalTokens) {
      expect(view.zone).toBe("goal");
      expect(view.radius).toBeLessThan(0.5);
    }
  });
});

describe("move destinations and dice", () => {
  test("builds one destination per legal die move", () => {
    const state = makeRolledState(TWO_COLORS, { "red-0": 10 }, [4, 5]);
    const moves = getLegalMoves(state);
    const destinations = getDestinationViews(state, moves);

    expect(destinations).toHaveLength(2);
    expect(destinations.every((destination) => destination.color === "green")).toBeTrue();
    expect(destinations.map((destination) => destination.progress).sort((a, b) => a - b)).toEqual([14, 15]);
  });

  test("collapses identical destinations", () => {
    const state = makeRolledState(TWO_COLORS, { "red-0": 10 }, [4, 5]);
    const destinations = getDestinationViews(state, [
      move(4, "red-0", 14),
      move(4, "red-0", 14),
    ]);

    expect(destinations).toHaveLength(1);
  });

  test("shows both dice only for the active seat and tracks spent dice", () => {
    let state = makeState(TWO_COLORS, { "red-0": 10 });
    state = roll(state, [4, 6]);

    let dice = getDieViews(state);
    expect(dice[0]).toMatchObject({
      values: [4, 6],
      used: [false, false],
      active: true,
    });
    expect(dice[1].values).toEqual([null, null]);
    expect(dice[1].active).toBeFalse();

    state = applyMove(state, move(4, "red-0", 14));
    dice = getDieViews(state);
    expect(dice[0]).toMatchObject({
      values: [4, 6],
      used: [true, false],
      active: true,
    });
  });

  test("keeps a pending double visible for the extra roll", () => {
    let state = makeState(TWO_COLORS, { "red-0": 10 });
    state = roll(state, [4, 4]);
    state = applyMove(state, move(4, "red-0", 14));
    state = applyMove(state, move(4, "red-0", 18));

    expect(state.phase).toBe("awaiting-roll");
    expect(state.consecutiveDoubles).toBe(1);

    const dice = getDieViews(state);
    expect(dice[0]).toMatchObject({
      values: [4, 4],
      used: [false, false],
      active: true,
    });
  });

  test("marks no die active once the game is finished", () => {
    const base = createGame(TWO);
    const finished: GameState = { ...base, phase: "finished", winnerId: "red" };

    expect(getDieViews(finished).some((die) => die.active)).toBeFalse();
  });

  test("converts board-unit anchors to canvas percentages", () => {
    const center = getBoardAnchorPercent({ x: 10.5, y: 10.5 });
    expect(center.left).toBeCloseTo(50, 6);
    expect(center.top).toBeCloseTo(50, 6);

    const corner = getBoardAnchorPercent({ x: 0, y: 0 });
    expect(corner.left).toBeCloseTo(11, 6);
    expect(corner.top).toBeCloseTo(11, 6);
  });

  test("describes tracks, corridors, and the goal in Spanish", () => {
    expect(describeProgress("green", 0)).toBe("la casilla 5");
    expect(describeProgress("green", 63)).toBe("la casilla 68");
    expect(describeProgress("green", 64)).toBe("el pasillo 1/7");
    expect(describeProgress("green", 70)).toBe("el pasillo 7/7");
    expect(describeProgress("green", GOAL_PROGRESS)).toBe("la meta");
  });

  test("prints the board's player-relative numbers when a view is supplied", () => {
    expect(describeProgress("blue", 0)).toBe("la casilla 22");
    expect(describeProgress("blue", 0, "blue")).toBe("la casilla 1");
    expect(describeProgress("blue", 2, "blue")).toBe("la casilla 3");
    expect(describeProgress("green", 0, "blue")).toBe("la casilla 52");
  });
});
