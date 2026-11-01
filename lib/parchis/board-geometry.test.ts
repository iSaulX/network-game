import { describe, expect, test } from "bun:test";
import {
  BOARD_UNITS,
  COLORS,
  COLOR_LAYOUT,
  GOAL_PROGRESS,
  HOME_COLUMN_LENGTH,
  TRACK_CELLS,
  TRACK_SQUARE_COUNT,
  getBoardFrameLayout,
  getBoardPositions,
  getBoardPositionsForCanvas,
  getBoardView,
  getViewBoardPositionsForCanvas,
  getViewCorner,
  getViewSquareNumber,
  getViewSquarePosition,
  getCorridorCells,
  getGoalTriangle,
  getHomeEntranceSquare,
  getMarkedSafeSquares,
  getProgressAnchor,
  getStartColor,
  getStartSquare,
  getSquareInfo,
  getSquarePosition,
  getYardCenter,
  getYardRect,
  getYardSlotAnchor,
  isHomeEntranceSquare,
  isMarkedSafeSquare,
  isStartSquare,
  progressToSquare,
  rotateUnitPoint,
  squareToCell,
  squareToPoint,
  unitPointToPixel,
  unitToPixel,
  wrapSquare,
  type BoardPoint,
} from "./board-geometry";

const expectPoint = (
  actual: BoardPoint,
  x: number,
  y: number,
  digits = 6,
) => {
  expect(actual.x).toBeCloseTo(x, digits);
  expect(actual.y).toBeCloseTo(y, digits);
};

const edgeList = (points: readonly BoardPoint[]) =>
  points.map((point, index) => [
    point,
    points[(index + 1) % points.length],
  ] as const);

/** Length of the collinear overlap between two polygon edges. */
function segmentOverlap(
  a1: BoardPoint,
  a2: BoardPoint,
  b1: BoardPoint,
  b2: BoardPoint,
): number {
  const tolerance = 1e-6;
  const cross = (u: BoardPoint, v: BoardPoint) => u.x * v.y - u.y * v.x;
  const a = { x: a2.x - a1.x, y: a2.y - a1.y };
  const b = { x: b2.x - b1.x, y: b2.y - b1.y };
  const lengthA = Math.hypot(a.x, a.y);
  const lengthB = Math.hypot(b.x, b.y);

  if (lengthA < tolerance || lengthB < tolerance) return 0;

  const aUnit = { x: a.x / lengthA, y: a.y / lengthA };

  if (Math.abs(cross(a, b)) > tolerance * lengthA * lengthB) return 0;
  if (Math.abs(cross({ x: b1.x - a1.x, y: b1.y - a1.y }, a)) > tolerance * lengthA)
    return 0;

  const projection = (point: BoardPoint) =>
    (point.x - a1.x) * aUnit.x + (point.y - a1.y) * aUnit.y;

  const aMin = 0;
  const aMax = lengthA;
  const bMin = Math.min(projection(b1), projection(b2));
  const bMax = Math.max(projection(b1), projection(b2));

  return Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin));
}

function sharedBoundaryLength(
  first: readonly BoardPoint[],
  second: readonly BoardPoint[],
): number {
  let total = 0;

  for (const [a1, a2] of edgeList(first)) {
    for (const [b1, b2] of edgeList(second)) {
      total = Math.max(total, segmentOverlap(a1, a2, b1, b2));
    }
  }

  return total;
}

describe("track layout", () => {
  test("has all 68 numbered cells inside the 21×21 play surface", () => {
    expect(TRACK_CELLS).toHaveLength(TRACK_SQUARE_COUNT);
    expect(new Set(TRACK_CELLS.map((cell) => cell.square)).size).toBe(
      TRACK_SQUARE_COUNT,
    );

    for (const cell of TRACK_CELLS) {
      expect(cell.points.length).toBeGreaterThanOrEqual(4);
      expect(cell.center.x).toBeGreaterThan(0);
      expect(cell.center.x).toBeLessThan(BOARD_UNITS);
      expect(cell.center.y).toBeGreaterThan(0);
      expect(cell.center.y).toBeLessThan(BOARD_UNITS);

      for (const point of cell.points) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(BOARD_UNITS);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(BOARD_UNITS);
      }
    }
  });

  test("the numbered loop is continuous and closes back to 1", () => {
    for (let index = 0; index < TRACK_CELLS.length; index += 1) {
      const current = TRACK_CELLS[index];
      const next = TRACK_CELLS[(index + 1) % TRACK_CELLS.length];

      expect(sharedBoundaryLength(current.points, next.points)).toBeGreaterThan(
        0.9,
      );
    }
  });

  test("chamfers all eight inner-corner cells with the goal X", () => {
    for (const square of [8, 9, 25, 26, 42, 43, 59, 60]) {
      expect(squareToCell(square).points).toHaveLength(4);
    }

    const eight = squareToCell(8);
    const nine = squareToCell(9);
    const fiftyNine = squareToCell(59);
    const sixty = squareToCell(60);

    expectPoint(nine.center, 7 + 5 / 11, 8 + 13 / 33);
    expectPoint(fiftyNine.center, 13 + 6 / 11, 8 + 13 / 33);
    expect(eight.points).toContainEqual({ x: 8, y: 8 });
    expect(sixty.points).toContainEqual({ x: 13, y: 8 });
  });

  test("maps the corner squares to the reference positions", () => {
    expectPoint(squareToCell(1).center, 7 + 7 / 6, 0.5);
    expectPoint(squareToCell(5).center, 7 + 7 / 6, 4.5);
    expectPoint(squareToCell(17).center, 0.5, 10.5);
    expectPoint(squareToCell(34).center, 10.5, 20.5);
    expectPoint(squareToCell(51).center, 20.5, 10.5);
    expectPoint(squareToCell(68).center, 10.5, 0.5);
    expectPoint(squareToCell(9).center, 7 + 5 / 11, 8 + 13 / 33);
    expectPoint(squareToCell(59).center, 13 + 6 / 11, 8 + 13 / 33);
  });

  test("turns the numbers toward the player on each side", () => {
    expect(squareToCell(1).label.rotation).toBeCloseTo(Math.PI, 6);
    expect(squareToCell(68).label.rotation).toBeCloseTo(Math.PI, 6);
    expect(squareToCell(16).label.rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(squareToCell(17).label.rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(squareToCell(26).label.rotation).toBe(0);
    expect(squareToCell(34).label.rotation).toBe(0);
    expect(squareToCell(52).label.rotation).toBeCloseTo(-Math.PI / 2, 6);
    expect(squareToCell(51).label.rotation).toBeCloseTo(-Math.PI / 2, 6);
  });

  test("rejects out-of-range square numbers", () => {
    expect(() => squareToCell(0)).toThrow(RangeError);
    expect(() => squareToCell(69)).toThrow(RangeError);
    expect(() => squareToCell(1.5)).toThrow(RangeError);
    expect(wrapSquare(69)).toBe(1);
    expect(wrapSquare(0)).toBe(68);
  });
});

describe("markings", () => {
  test("starts and home entrances match the artwork", () => {
    expect(getStartSquare("green")).toBe(5);
    expect(getStartSquare("blue")).toBe(22);
    expect(getStartSquare("red")).toBe(39);
    expect(getStartSquare("yellow")).toBe(56);

    expect(getHomeEntranceSquare("green")).toBe(68);
    expect(getHomeEntranceSquare("blue")).toBe(17);
    expect(getHomeEntranceSquare("red")).toBe(34);
    expect(getHomeEntranceSquare("yellow")).toBe(51);

    for (const color of COLORS) {
      expect(getStartColor(getStartSquare(color))).toBe(color);
      expect(isStartSquare(getStartSquare(color))).toBe(true);
      expect(isHomeEntranceSquare(getHomeEntranceSquare(color))).toBe(true);
      expect(wrapSquare(getHomeEntranceSquare(color) + 5)).toBe(
        getStartSquare(color),
      );
    }
  });

  test("the eight brown safety squares mirror the engine's safe set", () => {
    expect(getMarkedSafeSquares()).toEqual([12, 17, 29, 34, 46, 51, 63, 68]);

    for (const square of getMarkedSafeSquares()) {
      expect(isMarkedSafeSquare(square)).toBe(true);
      expect(["safe", "home-entrance"]).toContain(getSquareInfo(square).kind);
    }

    expect(getSquareInfo(5).kind).toBe("start");
    expect(getSquareInfo(5).color).toBe("green");
    expect(getSquareInfo(68).kind).toBe("home-entrance");
    expect(getSquareInfo(68).color).toBe("green");
    expect(getSquareInfo(1).kind).toBe("track");
    expect(getSquareInfo(1).color).toBeNull();
  });
});

describe("corridors, yards, and progress", () => {
  test("each colour has seven corridor cells in progress order", () => {
    for (const color of COLORS) {
      const corridor = getCorridorCells(color);
      expect(corridor).toHaveLength(HOME_COLUMN_LENGTH);
      expect(corridor.map((cell) => cell.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);

      for (let index = 1; index < corridor.length; index += 1) {
        expect(
          sharedBoundaryLength(corridor[index - 1].points, corridor[index].points),
        ).toBeGreaterThan(0.9);
      }

      const entrance = squareToCell(getHomeEntranceSquare(color));
      expect(
        sharedBoundaryLength(corridor[0].points, entrance.points),
      ).toBeGreaterThan(0.9);
    }
  });

  test("the last corridor cell touches its goal triangle", () => {
    for (const color of COLORS) {
      const corridor = getCorridorCells(color);
      const goal = getGoalTriangle(color);
      expect(
        sharedBoundaryLength(corridor[6].points, goal.points),
      ).toBeGreaterThan(0.9);
    }
  });

  test("yards are 7×7 corner blocks with four distinct slots", () => {
    expect(getYardRect("green")).toEqual({ x: 0, y: 0, width: 7, height: 7 });
    expect(getYardRect("yellow")).toEqual({ x: 14, y: 0, width: 7, height: 7 });
    expect(getYardRect("red")).toEqual({ x: 14, y: 14, width: 7, height: 7 });
    expect(getYardRect("blue")).toEqual({ x: 0, y: 14, width: 7, height: 7 });

    expectPoint(getYardCenter("green"), 3.5, 3.5);
    expectPoint(getYardCenter("yellow"), 17.5, 3.5);
    expectPoint(getYardCenter("red"), 17.5, 17.5);
    expectPoint(getYardCenter("blue"), 3.5, 17.5);

    for (const color of COLORS) {
      const rect = getYardRect(color);
      const slots = [0, 1, 2, 3].map((slot) =>
        getYardSlotAnchor(color, slot),
      );

      expect(new Set(slots.map((slot) => `${slot.x},${slot.y}`)).size).toBe(4);

      for (const slot of slots) {
        expect(slot.x).toBeGreaterThan(rect.x);
        expect(slot.x).toBeLessThan(rect.x + rect.width);
        expect(slot.y).toBeGreaterThan(rect.y);
        expect(slot.y).toBeLessThan(rect.y + rect.height);
      }
    }

    expect(() => getYardSlotAnchor("green", 4)).toThrow(RangeError);
  });

  test("maps engine progress to start, entrance, corridor, and goal", () => {
    for (const color of COLORS) {
      expectPoint(
        getProgressAnchor(color, 0),
        squareToCell(getStartSquare(color)).center.x,
        squareToCell(getStartSquare(color)).center.y,
      );
      expectPoint(
        getProgressAnchor(color, 63),
        squareToCell(getHomeEntranceSquare(color)).center.x,
        squareToCell(getHomeEntranceSquare(color)).center.y,
      );
      expectPoint(
        getProgressAnchor(color, 64),
        getCorridorCells(color)[0].center.x,
        getCorridorCells(color)[0].center.y,
      );
      expectPoint(
        getProgressAnchor(color, 70),
        getCorridorCells(color)[6].center.x,
        getCorridorCells(color)[6].center.y,
      );
      expectPoint(
        getProgressAnchor(color, GOAL_PROGRESS),
        getGoalTriangle(color).center.x,
        getGoalTriangle(color).center.y,
      );
    }

    expect(progressToSquare("green", 0)).toBe(5);
    expect(progressToSquare("green", 63)).toBe(68);
    expect(progressToSquare("yellow", 63)).toBe(51);
    expect(progressToSquare("red", 63)).toBe(34);
    expect(progressToSquare("blue", 63)).toBe(17);

    expect(() => getProgressAnchor("green", 72)).toThrow(RangeError);
    expect(() => getProgressAnchor("green", -1)).toThrow(RangeError);
    expect(() => progressToSquare("green", 64)).toThrow(RangeError);
  });
});

describe("pixel positions", () => {
  test("converts units with the rendered play size and origin", () => {
    expect(unitToPixel(0, 210, 100)).toBe(100);
    expect(unitToPixel(21, 210, 100)).toBe(310);
    expectPoint(unitPointToPixel({ x: 10.5, y: 10.5 }, 210, 100, 50), 205, 155);

    const center = squareToPoint(1, 210, 100, 100);
    expectPoint(center, 100 + (7 + 7 / 6) * 10, 105);
  });

  test("returns every board position for a given size", () => {
    const layout = getBoardPositions(420, 30, 40);

    expect(layout.unit).toBeCloseTo(20, 6);
    expect(layout.squares).toHaveLength(TRACK_SQUARE_COUNT);
    expect(layout.squares[0].square).toBe(1);
    expect(layout.squares[67].square).toBe(68);

    expect(layout.squares[0].polygon).toHaveLength(4);
    expect(layout.squares[24].polygon).toHaveLength(4); // square 25
    expect(layout.squares[0].label.rotation).toBeCloseTo(Math.PI, 6);

    for (const color of COLORS) {
      expect(layout.corridors[color]).toHaveLength(HOME_COLUMN_LENGTH);
      expect(layout.yards[color].slots).toHaveLength(4);
      expect(layout.goals[color].polygon).toHaveLength(3);
    }

    expectPoint(layout.center, 30 + 10.5 * 20, 40 + 10.5 * 20);
  });

  test("exposes a single square position with its polygon and label", () => {
    const position = getSquarePosition(68, 210, 0, 0);
    expect(position.square).toBe(68);
    expect(position.kind).toBe("home-entrance");
    expect(position.color).toBe("green");
    expect(position.polygon).toHaveLength(4);
    expect(position.label.rotation).toBeCloseTo(Math.PI, 6);
    expect(position.x).toBeCloseTo(10.5 * 10, 6);
    expect(position.y).toBeCloseTo(0.5 * 10, 6);
  });

  test("shares the canvas/frame composition with token layers", () => {
    const frame = getBoardFrameLayout(1000);

    expect(frame.canvasSize).toBe(1000);
    expect(frame.tableMargin).toBeCloseTo(65, 6);
    expect(frame.frameWidth).toBeCloseTo(45, 6);
    expect(frame.boardSize).toBeCloseTo(870, 6);
    expect(frame.playSize).toBeCloseTo(780, 6);
    expect(frame.playX).toBeCloseTo(110, 6);
    expect(frame.playY).toBeCloseTo(110, 6);
    expect(frame.unit).toBeCloseTo(780 / 21, 6);

    const layout = getBoardPositionsForCanvas(1000);
    expect(layout.squares).toHaveLength(TRACK_SQUARE_COUNT);
    expect(layout.squares[0].x).toBeCloseTo(
      110 + (780 / 21) * (7 + 7 / 6),
      6,
    );
    expect(layout.squares[0].y).toBeCloseTo(110 + (780 / 21) * 0.5, 6);
  });

  test("rejects invalid render sizes", () => {
    expect(() => unitToPixel(1, 0)).toThrow(RangeError);
    expect(() => unitToPixel(1, Number.NaN)).toThrow(RangeError);
    expect(() => getBoardPositions(-1)).toThrow(RangeError);
    expect(() => getBoardPositionsForCanvas(0)).toThrow(RangeError);
    expect(() => getBoardFrameLayout(Number.NaN)).toThrow(RangeError);
  });
});

describe("player view", () => {
  test("rotates each colour's home to the bottom-left", () => {
    const bottomLeft = { x: 3.5, y: 17.5 };

    expect(getBoardView("blue").rotation).toBe(0);
    expect(getBoardView("green").rotation).toBeCloseTo(-Math.PI / 2, 6);
    expect(getBoardView("yellow").rotation).toBeCloseTo(Math.PI, 6);
    expect(getBoardView("red").rotation).toBeCloseTo(Math.PI / 2, 6);

    for (const color of COLORS) {
      const view = getBoardView(color);
      expect(view.startSquare).toBe(getStartSquare(color));
      expectPoint(
        rotateUnitPoint(getYardCenter(color), view.rotation),
        bottomLeft.x,
        bottomLeft.y,
      );
    }
  });

  test("moves every colour's home to its view-relative corner", () => {
    expect(
      COLORS.map((color) => [color, getViewCorner(color, "blue")]),
    ).toEqual([
      ["red", "bottom-right"],
      ["blue", "bottom-left"],
      ["yellow", "top-right"],
      ["green", "top-left"],
    ]);

    expect(
      COLORS.map((color) => [color, getViewCorner(color, "green")]),
    ).toEqual([
      ["red", "top-right"],
      ["blue", "bottom-right"],
      ["yellow", "top-left"],
      ["green", "bottom-left"],
    ]);

    expect(
      COLORS.map((color) => [color, getViewCorner(color, "yellow")]),
    ).toEqual([
      ["red", "top-left"],
      ["blue", "top-right"],
      ["yellow", "bottom-left"],
      ["green", "bottom-right"],
    ]);

    expect(
      COLORS.map((color) => [color, getViewCorner(color, "red")]),
    ).toEqual([
      ["red", "bottom-left"],
      ["blue", "top-left"],
      ["yellow", "bottom-right"],
      ["green", "top-right"],
    ]);

    for (const viewColor of COLORS) {
      expect(getViewCorner(viewColor, viewColor)).toBe("bottom-left");
    }
  });

  test("numbers the player's start as 1 and the entrance as 64", () => {
    for (const color of COLORS) {
      const start = getStartSquare(color);
      const entrance = getHomeEntranceSquare(color);

      expect(getViewSquareNumber(color, start)).toBe(1);
      expect(getViewSquareNumber(color, entrance)).toBe(64);
      expect(getViewSquareNumber(color, wrapSquare(start - 1))).toBe(68);
    }

    expect(getViewSquareNumber("green", 5)).toBe(1);
    expect(getViewSquareNumber("green", 6)).toBe(2);
    expect(getViewSquareNumber("green", 4)).toBe(68);
  });

  test("returns rotated pixels and relative labels for the player", () => {
    const position = getViewSquarePosition("green", 5, 210);

    expect(position.square).toBe(5);
    expect(position.viewSquare).toBe(1);
    expect(position.x).toBeLessThan(105);
    expect(position.y).toBeGreaterThan(105);
    expect(position.label.rotation).toBeCloseTo(Math.PI / 2, 6);

    const positions = getViewBoardPositionsForCanvas(1000, "green");
    expect(positions).toHaveLength(TRACK_SQUARE_COUNT);
    expect(positions.find((entry) => entry.square === 5)?.viewSquare).toBe(1);
    expect(positions.find((entry) => entry.square === 68)?.viewSquare).toBe(64);
  });
});

describe("colour layout", () => {
  test("assigns each colour to its corner, goal, and corridor", () => {
    expect(COLOR_LAYOUT.green.corner).toBe("top-left");
    expect(COLOR_LAYOUT.yellow.corner).toBe("top-right");
    expect(COLOR_LAYOUT.red.corner).toBe("bottom-right");
    expect(COLOR_LAYOUT.blue.corner).toBe("bottom-left");

    expectPoint(COLOR_LAYOUT.green.goal.center, 10.5, 8 + 5 / 6);
    expectPoint(COLOR_LAYOUT.blue.goal.center, 8 + 5 / 6, 10.5);
    expectPoint(COLOR_LAYOUT.yellow.goal.center, 12 + 1 / 6, 10.5);
    expectPoint(COLOR_LAYOUT.red.goal.center, 10.5, 12 + 1 / 6);
  });
});
