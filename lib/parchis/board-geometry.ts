/**
 * Geometry for the square Parchís board shown on `/play`.
 *
 * The board is modelled on a 21×21 unit square (the play surface, without the
 * frame). The four homes are 7×7 corner blocks; the track is a closed loop of
 * 68 numbered cells around a 5×5 central goal, with one private seven-cell
 * corridor per colour. Units are independent of pixels: multiply by
 * `playSize / BOARD_UNITS` to render.
 *
 * This module is pure data and maths. It must stay free of React, PixiJS,
 * Next.js, and browser APIs so the renderer, tests, and future game logic can
 * all share it.
 *
 * Numbering matches the reference artwork:
 *
 *   top arm      1–8 (left lane), 68 (tip), 60–67 (right lane)
 *   left strip   9–16 (upper row), 17 (tip), 18–25 (lower row)
 *   bottom arm   26–33 (left lane), 34 (tip), 35–42 (right lane)
 *   right strip  43–50 (lower row), 51 (tip), 52–59 (upper row)
 */

export type ParchisColor = "red" | "blue" | "yellow" | "green";

export type BoardSide = "top" | "right" | "bottom" | "left";

export type BoardCorner =
  | "top-left"
  | "top-right"
  | "bottom-right"
  | "bottom-left";

export type SquareKind = "start" | "safe" | "home-entrance" | "track";

export interface BoardPoint {
  readonly x: number;
  readonly y: number;
}

/** A rectangle in board units. */
export interface UnitRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A closed polygon in board units. */
export interface UnitPolygon {
  readonly points: readonly BoardPoint[];
  /** Area centroid, in board units. */
  readonly center: BoardPoint;
}

/** Where a number is painted, and how it is rotated, in board units. */
export interface CellLabel {
  readonly x: number;
  readonly y: number;
  /** Radians; 0, ±π/2, or π depending on which side of the board it faces. */
  readonly rotation: number;
}

export interface TrackCell extends UnitPolygon {
  readonly square: number;
  readonly side: BoardSide;
  readonly kind: SquareKind;
  readonly color: ParchisColor | null;
  readonly label: CellLabel;
}

export interface CorridorCell extends UnitPolygon {
  readonly color: ParchisColor;
  /** 0 is the cell next to the home entrance; 6 is next to the goal. */
  readonly index: number;
}

export interface GoalTriangle extends UnitPolygon {
  readonly color: ParchisColor;
}

export interface ColorLayout {
  readonly corner: BoardCorner;
  /** Display square on which tokens of this colour enter the track. */
  readonly startSquare: number;
  /** Display square at the arm tip where the private corridor begins. */
  readonly homeEntranceSquare: number;
  /** 7×7 home block. */
  readonly yard: UnitRect;
  /** Seven private cells, in progress order (outermost → goal). */
  readonly corridor: readonly CorridorCell[];
  readonly goal: GoalTriangle;
}

/** A track square converted to pixels for one rendered board size. */
export interface SquarePosition {
  readonly square: number;
  readonly x: number;
  readonly y: number;
  readonly kind: SquareKind;
  readonly color: ParchisColor | null;
  readonly polygon: readonly BoardPoint[];
  readonly label: CellLabel;
}

/** A square position transformed into a player's rotated view. */
export interface ViewSquarePosition extends SquarePosition {
  /** The number painted on this square for the selected colour. */
  readonly viewSquare: number;
  /** The rotation applied to the play area. */
  readonly viewRotation: number;
}

export interface CorridorPosition extends UnitPolygon {
  readonly color: ParchisColor;
  readonly index: number;
  readonly polygon: readonly BoardPoint[];
  readonly x: number;
  readonly y: number;
}

export interface YardPosition {
  readonly color: ParchisColor;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly center: BoardPoint;
  readonly slots: readonly BoardPoint[];
}

export interface GoalPosition {
  readonly color: ParchisColor;
  readonly x: number;
  readonly y: number;
  readonly polygon: readonly BoardPoint[];
}

/**
 * Everything needed to place pieces for one board size: centres and outlines
 * for all 68 track squares, both corridors, yards, and goal triangles.
 *
 * This is the "current positions" lookup used by future token/game layers.
 */
export interface BoardPositions {
  readonly playSize: number;
  readonly origin: BoardPoint;
  /** Pixel size of one board unit. */
  readonly unit: number;
  readonly squares: readonly SquarePosition[];
  readonly corridors: Readonly<Record<ParchisColor, readonly CorridorPosition[]>>;
  readonly yards: Readonly<Record<ParchisColor, YardPosition>>;
  readonly goals: Readonly<Record<ParchisColor, GoalPosition>>;
  readonly center: BoardPoint;
}

export const BOARD_UNITS = 21;
export const TRACK_SQUARE_COUNT = 68;
export const HOME_COLUMN_LENGTH = 7;
export const GOAL_PROGRESS = 71;

/** Width of one lane of an arm, and height of one row of a side strip. */
export const ARM_LANE = 7 / 3;

/** The central 5×5 goal square. */
export const GOAL_MIN = 8;
export const GOAL_MAX = 13;

export const COLORS: readonly ParchisColor[] = Object.freeze([
  "red",
  "blue",
  "yellow",
  "green",
]);

export const COLOR_NAMES: Readonly<Record<ParchisColor, string>> = Object.freeze({
  red: "rojo",
  blue: "azul",
  yellow: "amarillo",
  green: "verde",
});

const L = 7;
const A = L + ARM_LANE;
const B = L + ARM_LANE * 2;
const R = 14;
const T7 = 7;
const T9 = T7 + ARM_LANE;
const T11 = T7 + ARM_LANE * 2;
const T14 = 14;

const point = (x: number, y: number): BoardPoint => Object.freeze({ x, y });

/** Area centroid of a simple polygon. */
function polygonCentroid(points: readonly BoardPoint[]): BoardPoint {
  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    area += cross;
    cx += (current.x + next.x) * cross;
    cy += (current.y + next.y) * cross;
  }

  area *= 0.5;
  if (Math.abs(area) < 1e-9) {
    // Degenerate polygon: fall back to the vertex average.
    return point(
      points.reduce((sum, vertex) => sum + vertex.x, 0) / points.length,
      points.reduce((sum, vertex) => sum + vertex.y, 0) / points.length,
    );
  }

  return point(cx / (6 * area), cy / (6 * area));
}

function polygon(points: readonly BoardPoint[]): UnitPolygon {
  return Object.freeze({
    points: Object.freeze([...points]),
    center: polygonCentroid(points),
  });
}

function rectPolygon(x: number, y: number, width: number, height: number): UnitPolygon {
  return polygon([
    point(x, y),
    point(x + width, y),
    point(x + width, y + height),
    point(x, y + height),
  ]);
}

function rect(x: number, y: number, width: number, height: number): UnitRect {
  return Object.freeze({ x, y, width, height });
}

const START_COLOR: Readonly<Record<number, ParchisColor>> = Object.freeze({
  5: "green",
  22: "blue",
  39: "red",
  56: "yellow",
});

const ENTRANCE_COLOR: Readonly<Record<number, ParchisColor>> = Object.freeze({
  17: "blue",
  34: "red",
  51: "yellow",
  68: "green",
});

/**
 * The eight brown/dark safe squares painted around the map. Mirrors the
 * engine rule (start + 7 and start + 12 for every colour) so the artwork never
 * tells players that a square is safe when the engine disagrees. Four of these
 * cells are also corridor tips, classified as `home-entrance` below.
 */
const MARKED_SAFE_SQUARES: readonly number[] = Object.freeze([
  12, 17, 29, 34, 46, 51, 63, 68,
]);
const MARKED_SAFE_SET = new Set(MARKED_SAFE_SQUARES);

const ROTATION: Readonly<Record<BoardSide, number>> = Object.freeze({
  top: Math.PI,
  right: -Math.PI / 2,
  bottom: 0,
  left: Math.PI / 2,
});

function classifySquare(square: number): {
  kind: SquareKind;
  color: ParchisColor | null;
} {
  const startColor = START_COLOR[square];
  if (startColor) return { kind: "start", color: startColor };

  const entranceColor = ENTRANCE_COLOR[square];
  if (entranceColor) return { kind: "home-entrance", color: entranceColor };

  if (MARKED_SAFE_SET.has(square)) return { kind: "safe", color: null };

  return { kind: "track", color: null };
}

function label(
  side: BoardSide,
  x: number,
  y: number,
): CellLabel {
  return Object.freeze({ x, y, rotation: ROTATION[side] });
}

interface TrackCellDraft {
  square: number;
  side: BoardSide;
  shape: UnitPolygon;
  label: CellLabel;
}

function buildTrackCells(): readonly TrackCell[] {
  const draft: TrackCellDraft[] = [];
  const add = (
    square: number,
    side: BoardSide,
    shape: UnitPolygon,
    anchor: CellLabel,
  ) => {
    draft.push({ square, side, shape, label: anchor });
  };

  // Top arm, left lane: 1–8. Square 8 is chamfered by the goal X.
  for (let row = 0; row < 8; row += 1) {
    add(
      row + 1,
      "top",
      row === 7
        ? polygon([
            point(L, 7),
            point(A, 7),
            point(A, 8),
            point(GOAL_MIN, GOAL_MIN),
          ])
        : rectPolygon(L, row, ARM_LANE, 1),
      label("top", L + ARM_LANE - 0.33, row + 0.78),
    );
  }

  // Top arm, tip: 68.
  add(
    68,
    "top",
    rectPolygon(A, 0, ARM_LANE, 1),
    label("top", B - 0.33, 0.78),
  );

  // Top arm, right lane: 67 → 60. Square 60 is chamfered by the goal X.
  for (let row = 0; row < 8; row += 1) {
    add(
      67 - row,
      "top",
      row === 7
        ? polygon([
            point(B, 7),
            point(R, 7),
            point(GOAL_MAX, GOAL_MIN),
            point(B, GOAL_MIN),
          ])
        : rectPolygon(B, row, ARM_LANE, 1),
      label("top", B + 0.4, row + 0.78),
    );
  }

  // Left strip, upper row: 16 → 10.
  for (let column = 0; column < 7; column += 1) {
    add(
      16 - column,
      "left",
      rectPolygon(column, T7, 1, ARM_LANE),
      label("left", column + 0.78, T9 - 0.35),
    );
  }

  // Left strip, corner cell: 9. Its top edge is the goal X chamfer.
  add(
    9,
    "left",
    polygon([
      point(L, 7),
      point(GOAL_MIN, GOAL_MIN),
      point(GOAL_MIN, T9),
      point(L, T9),
    ]),
    label("left", L + 0.78, T9 - 0.35),
  );

  // Left strip, tip: 17.
  add(
    17,
    "left",
    rectPolygon(0, T9, 1, ARM_LANE),
    label("left", 0.75, T9 + 0.3),
  );

  // Left strip, lower row: 18 → 25.
  for (let column = 0; column < 8; column += 1) {
    const square = 18 + column;
    const shape =
      square === 25
        ? polygon([
            point(L, T11),
            point(8, T11),
            point(8, GOAL_MAX),
            point(L, T14),
          ])
        : rectPolygon(column, T11, 1, ARM_LANE);

    add(
      square,
      "left",
      shape,
      label("left", column + 0.78, T11 + 0.35),
    );
  }

  // Bottom arm, left lane: 26 → 33.
  for (let row = 0; row < 8; row += 1) {
    const square = 26 + row;
    const top = 13 + row;
    const shape =
      row === 0
        ? polygon([
            point(8, GOAL_MAX),
            point(A, GOAL_MAX),
            point(A, T14),
            point(L, T14),
          ])
        : rectPolygon(L, top, ARM_LANE, 1);

    add(
      square,
      "bottom",
      shape,
      label("bottom", A - 0.33, top + 0.25),
    );
  }

  // Bottom arm, tip: 34.
  add(
    34,
    "bottom",
    rectPolygon(A, 20, ARM_LANE, 1),
    label("bottom", A + 0.3, 20.25),
  );

  // Bottom arm, right lane: 35 → 42.
  for (let row = 0; row < 8; row += 1) {
    const square = 35 + row;
    const top = 20 - row;
    const shape =
      square === 42
        ? polygon([
            point(B, GOAL_MAX),
            point(GOAL_MAX, GOAL_MAX),
            point(R, T14),
            point(B, T14),
          ])
        : rectPolygon(B, top, ARM_LANE, 1);

    add(
      square,
      "bottom",
      shape,
      label("bottom", B + 0.35, top + 0.25),
    );
  }

  // Right strip, lower row: 43 → 50.
  for (let column = 0; column < 8; column += 1) {
    const square = 43 + column;
    const left = 13 + column;
    const shape =
      square === 43
        ? polygon([
            point(GOAL_MAX, T11),
            point(R, T11),
            point(R, T14),
            point(GOAL_MAX, GOAL_MAX),
          ])
        : rectPolygon(left, T11, 1, ARM_LANE);

    add(
      square,
      "right",
      shape,
      label("right", left + 0.27, T11 + 0.35),
    );
  }

  // Right strip, tip: 51.
  add(
    51,
    "right",
    rectPolygon(20, T9, 1, ARM_LANE),
    label("right", 20.27, T11 - 0.45),
  );

  // Right strip, upper row: 59 → 52.
  for (let column = 0; column < 8; column += 1) {
    const square = 59 - column;
    const left = 13 + column;
    const shape =
      square === 59
        ? polygon([
            point(GOAL_MAX, GOAL_MIN),
            point(R, T7),
            point(R, T9),
            point(GOAL_MAX, T9),
          ])
        : rectPolygon(left, T7, 1, ARM_LANE);

    add(
      square,
      "right",
      shape,
      label("right", left + 0.27, T9 - 0.35),
    );
  }

  if (draft.length !== TRACK_SQUARE_COUNT) {
    throw new Error(
      `Expected ${TRACK_SQUARE_COUNT} track cells, built ${draft.length}.`,
    );
  }

  const bySquare = new Map(draft.map((cell) => [cell.square, cell]));

  if (bySquare.size !== draft.length) {
    throw new Error("Track geometry contains duplicate square numbers.");
  }
  const cells: TrackCell[] = [];

  for (let square = 1; square <= TRACK_SQUARE_COUNT; square += 1) {
    const cell = bySquare.get(square);
    if (!cell) {
      throw new Error(`Missing geometry for track square ${square}.`);
    }

    const classification = classifySquare(square);
    cells.push(
      Object.freeze({
        square: cell.square,
        side: cell.side,
        kind: classification.kind,
        color: classification.color,
        points: cell.shape.points,
        center: cell.shape.center,
        label: cell.label,
      }),
    );
  }

  return Object.freeze(cells);
}

export const TRACK_CELLS: readonly TrackCell[] = buildTrackCells();

const TRACK_BY_SQUARE: ReadonlyMap<number, TrackCell> = new Map(
  TRACK_CELLS.map((cell) => [cell.square, cell]),
);

function buildCorridor(color: ParchisColor): readonly CorridorCell[] {
  const cells: CorridorCell[] = [];

  for (let index = 0; index < HOME_COLUMN_LENGTH; index += 1) {
    let shape: UnitPolygon;

    switch (color) {
      case "green":
        // Top arm, middle lane: outermost at y=1, innermost at y=7.
        shape = rectPolygon(A, index + 1, ARM_LANE, 1);
        break;
      case "blue":
        // Left strip, middle row: outermost at x=1, innermost at x=7.
        shape = rectPolygon(index + 1, T9, 1, ARM_LANE);
        break;
      case "yellow":
        // Right strip, middle row: outermost at x=19, innermost at x=13.
        shape = rectPolygon(19 - index, T9, 1, ARM_LANE);
        break;
      case "red":
        // Bottom arm, middle lane: outermost at y=19, innermost at y=13.
        shape = rectPolygon(A, 19 - index, ARM_LANE, 1);
        break;
    }

    cells.push(
      Object.freeze({
        color,
        index,
        points: shape.points,
        center: shape.center,
      }),
    );
  }

  return Object.freeze(cells);
}

function goalTriangle(color: ParchisColor): GoalTriangle {
  const center = point(10.5, 10.5);
  let points: BoardPoint[];

  switch (color) {
    case "green":
      points = [point(GOAL_MIN, GOAL_MIN), point(GOAL_MAX, GOAL_MIN), center];
      break;
    case "yellow":
      points = [point(GOAL_MAX, GOAL_MIN), point(GOAL_MAX, GOAL_MAX), center];
      break;
    case "red":
      points = [point(GOAL_MAX, GOAL_MAX), point(GOAL_MIN, GOAL_MAX), center];
      break;
    case "blue":
      points = [point(GOAL_MIN, GOAL_MAX), point(GOAL_MIN, GOAL_MIN), center];
      break;
  }

  return Object.freeze({
    color,
    points: Object.freeze(points),
    center: polygonCentroid(points),
  });
}

export const COLOR_LAYOUT: Readonly<Record<ParchisColor, ColorLayout>> =
  Object.freeze({
    green: Object.freeze({
      corner: "top-left",
      startSquare: 5,
      homeEntranceSquare: 68,
      yard: rect(0, 0, 7, 7),
      corridor: buildCorridor("green"),
      goal: goalTriangle("green"),
    }),
    yellow: Object.freeze({
      corner: "top-right",
      startSquare: 56,
      homeEntranceSquare: 51,
      yard: rect(14, 0, 7, 7),
      corridor: buildCorridor("yellow"),
      goal: goalTriangle("yellow"),
    }),
    red: Object.freeze({
      corner: "bottom-right",
      startSquare: 39,
      homeEntranceSquare: 34,
      yard: rect(14, 14, 7, 7),
      corridor: buildCorridor("red"),
      goal: goalTriangle("red"),
    }),
    blue: Object.freeze({
      corner: "bottom-left",
      startSquare: 22,
      homeEntranceSquare: 17,
      yard: rect(0, 14, 7, 7),
      corridor: buildCorridor("blue"),
      goal: goalTriangle("blue"),
    }),
  });

/**
 * A player-relative rendering view. The play area is rotated so the chosen
 * colour's home is in the bottom-left corner, and the track is numbered from
 * that colour's start square.
 */
export interface BoardView {
  readonly color: ParchisColor;
  /** Visual rotation around the play centre; positive is clockwise in Pixi. */
  readonly rotation: number;
  /** Physical square that becomes number 1 in this view. */
  readonly startSquare: number;
}

const VIEW_ROTATION: Readonly<Record<ParchisColor, number>> = Object.freeze({
  blue: 0,
  green: -Math.PI / 2,
  yellow: Math.PI,
  red: Math.PI / 2,
});

/**
 * Rotation needed to move each colour's home to the bottom-left:
 * green TL → BL (counter-clockwise), yellow TR → BL (180°),
 * red BR → BL (clockwise), blue BL → BL (none).
 */
export function getBoardView(color: ParchisColor): BoardView {
  return Object.freeze({
    color,
    rotation: VIEW_ROTATION[color],
    startSquare: COLOR_LAYOUT[color].startSquare,
  });
}

/**
 * Physical square → player-relative number. The chosen colour's start square
 * is always 1, and numbers continue around the track in play order. The home
 * entrance is therefore number 64 and the square before the start is 68.
 */
export function getViewSquareNumber(
  color: ParchisColor,
  squareNumber: number,
): number {
  assertSquareNumber(squareNumber);

  const start = COLOR_LAYOUT[color].startSquare;
  return (
    ((squareNumber - start + TRACK_SQUARE_COUNT) % TRACK_SQUARE_COUNT) + 1
  );
}

const CORNER_POINTS: Readonly<Record<BoardCorner, BoardPoint>> = Object.freeze({
  "top-left": Object.freeze({ x: 0, y: 0 }),
  "top-right": Object.freeze({ x: 1, y: 0 }),
  "bottom-right": Object.freeze({ x: 1, y: 1 }),
  "bottom-left": Object.freeze({ x: 0, y: 1 }),
});

/**
 * Where a colour's home appears in another colour's player-relative view. The
 * viewer's own home is always bottom-left; the rest follow the board rotation.
 */
export function getViewCorner(
  color: ParchisColor,
  viewColor: ParchisColor,
): BoardCorner {
  const point = rotateAround(
    CORNER_POINTS[COLOR_LAYOUT[color].corner],
    getBoardView(viewColor).rotation,
    0.5,
    0.5,
  );

  if (point.x < 0.5) {
    return point.y < 0.5 ? "top-left" : "bottom-left";
  }

  return point.y < 0.5 ? "top-right" : "bottom-right";
}

/** Rotate a board-unit point around the play centre. */
export function rotateUnitPoint(
  anchor: BoardPoint,
  rotation: number,
  centerX = 10.5,
  centerY = 10.5,
): BoardPoint {
  return rotateAround(anchor, rotation, centerX, centerY);
}

function rotateAround(
  anchor: BoardPoint,
  rotation: number,
  centerX: number,
  centerY: number,
): BoardPoint {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const dx = anchor.x - centerX;
  const dy = anchor.y - centerY;

  return Object.freeze({
    x: centerX + dx * cosine - dy * sine,
    y: centerY + dx * sine + dy * cosine,
  });
}

export function getStartColor(square: number): ParchisColor | null {
  return START_COLOR[square] ?? null;
}

export function getHomeEntranceColor(square: number): ParchisColor | null {
  return ENTRANCE_COLOR[square] ?? null;
}

export function isStartSquare(square: number): boolean {
  return START_COLOR[square] !== undefined;
}

export function isHomeEntranceSquare(square: number): boolean {
  return ENTRANCE_COLOR[square] !== undefined;
}

/**
 * The brown/dark squares painted as safety marks around the reference artwork
 * (start + 7 and start + 12). The four starts are also safe but keep their
 * corridor colour.
 */
export function getMarkedSafeSquares(): readonly number[] {
  return MARKED_SAFE_SQUARES;
}

export function isMarkedSafeSquare(square: number): boolean {
  return MARKED_SAFE_SET.has(square);
}

export function getStartSquare(color: ParchisColor): number {
  return COLOR_LAYOUT[color].startSquare;
}

export function getHomeEntranceSquare(color: ParchisColor): number {
  return COLOR_LAYOUT[color].homeEntranceSquare;
}

export function getCorridorCells(color: ParchisColor): readonly CorridorCell[] {
  return COLOR_LAYOUT[color].corridor;
}

export function getGoalTriangle(color: ParchisColor): GoalTriangle {
  return COLOR_LAYOUT[color].goal;
}

export function getYardRect(color: ParchisColor): UnitRect {
  return COLOR_LAYOUT[color].yard;
}

export function getYardCenter(color: ParchisColor): BoardPoint {
  const yard = COLOR_LAYOUT[color].yard;
  return point(yard.x + yard.width / 2, yard.y + yard.height / 2);
}

/** Where one of the four tokens rests inside a yard. */
export function getYardSlotAnchor(color: ParchisColor, slot: number): BoardPoint {
  if (!Number.isInteger(slot) || slot < 0 || slot > 3) {
    throw new RangeError("Yard slot must be an integer from 0 to 3.");
  }

  const center = getYardCenter(color);
  const offset = 1.6;

  return point(
    center.x + (slot % 2 === 0 ? -offset : offset),
    center.y + (slot < 2 ? -offset : offset),
  );
}

export function wrapSquare(squareNumber: number): number {
  return (
    ((((squareNumber - 1) % TRACK_SQUARE_COUNT) + TRACK_SQUARE_COUNT) %
      TRACK_SQUARE_COUNT) +
    1
  );
}

/** Engine-relative progress → visual square number for a colour. */
export function progressToSquare(color: ParchisColor, progress: number): number {
  assertProgress(progress);

  if (progress > 63) {
    throw new RangeError("Outer-track progress must be an integer from 0 to 63.");
  }

  const startIndex = COLOR_LAYOUT[color].startSquare - 1;
  return ((startIndex + progress) % TRACK_SQUARE_COUNT) + 1;
}

function assertSquareNumber(squareNumber: number): void {
  if (
    !Number.isInteger(squareNumber) ||
    squareNumber < 1 ||
    squareNumber > TRACK_SQUARE_COUNT
  ) {
    throw new RangeError(
      `Square number must be an integer from 1 to ${TRACK_SQUARE_COUNT}.`,
    );
  }
}

function assertProgress(progress: number): void {
  if (!Number.isInteger(progress) || progress < 0 || progress > GOAL_PROGRESS) {
    throw new RangeError("Progress must be an integer from 0 to 71.");
  }
}

function assertPlaySize(playSize: number): void {
  if (!Number.isFinite(playSize) || playSize <= 0) {
    throw new RangeError("Play size must be a positive finite number.");
  }
}

export function squareToCell(squareNumber: number): TrackCell {
  assertSquareNumber(squareNumber);
  const cell = TRACK_BY_SQUARE.get(squareNumber);
  if (!cell) {
    throw new RangeError(`Square ${squareNumber} has no geometry.`);
  }
  return cell;
}

export interface SquareInfo {
  readonly square: number;
  readonly kind: SquareKind;
  readonly color: ParchisColor | null;
  readonly center: BoardPoint;
  readonly side: BoardSide;
}

export function getSquareInfo(squareNumber: number): SquareInfo {
  const cell = squareToCell(squareNumber);

  return Object.freeze({
    square: cell.square,
    kind: cell.kind,
    color: cell.color,
    center: cell.center,
    side: cell.side,
  });
}

/** Progress anchor in board units (track, corridor, or goal). */
export function getProgressAnchor(
  color: ParchisColor,
  progress: number,
): BoardPoint {
  assertProgress(progress);

  if (progress <= 63) {
    return squareToCell(progressToSquare(color, progress)).center;
  }

  if (progress <= 70) {
    return getCorridorCells(color)[progress - 64].center;
  }

  return getGoalTriangle(color).center;
}

/** Share of the square canvas occupied by the table margin on each side. */
export const TABLE_MARGIN_RATIO = 0.065;

/** Share of the square canvas occupied by the wooden frame on each side. */
export const FRAME_RATIO = 0.045;

export interface BoardFrameLayout {
  readonly canvasSize: number;
  readonly tableMargin: number;
  readonly frameWidth: number;
  readonly boardSize: number;
  readonly playSize: number;
  /** Play-surface top-left inside a square canvas. */
  readonly playX: number;
  readonly playY: number;
  readonly unit: number;
}

/**
 * Composition of the square canvas: walnut table margin → oak frame → play
 * surface. The renderer and any token layer share these exact proportions.
 */
export function getBoardFrameLayout(canvasSize: number): BoardFrameLayout {
  assertPlaySize(canvasSize);

  const tableMargin = canvasSize * TABLE_MARGIN_RATIO;
  const frameWidth = canvasSize * FRAME_RATIO;
  const boardSize = canvasSize - tableMargin * 2;
  const playSize = boardSize - frameWidth * 2;

  return Object.freeze({
    canvasSize,
    tableMargin,
    frameWidth,
    boardSize,
    playSize,
    playX: tableMargin + frameWidth,
    playY: tableMargin + frameWidth,
    unit: playSize / BOARD_UNITS,
  });
}

/** Convert one board-unit coordinate to pixels. */
export function unitToPixel(
  unit: number,
  playSize: number,
  origin = 0,
): number {
  assertPlaySize(playSize);
  return origin + (unit / BOARD_UNITS) * playSize;
}

export function unitPointToPixel(
  anchor: BoardPoint,
  playSize: number,
  originX = 0,
  originY = 0,
): BoardPoint {
  return point(
    unitToPixel(anchor.x, playSize, originX),
    unitToPixel(anchor.y, playSize, originY),
  );
}

function pixelPolygon(
  shape: UnitPolygon,
  playSize: number,
  originX: number,
  originY: number,
): readonly BoardPoint[] {
  return Object.freeze(
    shape.points.map((vertex) =>
      unitPointToPixel(vertex, playSize, originX, originY),
    ),
  );
}

function pixelCellLabel(
  cellLabel: CellLabel,
  playSize: number,
  originX: number,
  originY: number,
): CellLabel {
  const anchor = unitPointToPixel(cellLabel, playSize, originX, originY);
  return Object.freeze({
    x: anchor.x,
    y: anchor.y,
    rotation: cellLabel.rotation,
  });
}

/** Centre of a track square in pixels. */
export function squareToPoint(
  squareNumber: number,
  playSize: number,
  originX = 0,
  originY = 0,
): BoardPoint {
  return unitPointToPixel(
    squareToCell(squareNumber).center,
    playSize,
    originX,
    originY,
  );
}

/** Full pixel position of one track square. */
export function getSquarePosition(
  squareNumber: number,
  playSize: number,
  originX = 0,
  originY = 0,
): SquarePosition {
  const cell = squareToCell(squareNumber);
  const center = unitPointToPixel(
    cell.center,
    playSize,
    originX,
    originY,
  );

  return Object.freeze({
    square: cell.square,
    x: center.x,
    y: center.y,
    kind: cell.kind,
    color: cell.color,
    polygon: pixelPolygon(cell, playSize, originX, originY),
    label: pixelCellLabel(cell.label, playSize, originX, originY),
  });
}

/**
 * Square position in a player's view: rotated around the play centre, with the
 * player-relative number and a label rotation composed with the board rotation.
 */
export function getViewSquarePosition(
  color: ParchisColor,
  squareNumber: number,
  playSize: number,
  originX = 0,
  originY = 0,
): ViewSquarePosition {
  const base = getSquarePosition(squareNumber, playSize, originX, originY);
  const view = getBoardView(color);
  const centerX = originX + playSize / 2;
  const centerY = originY + playSize / 2;
  const center = rotateAround(base, view.rotation, centerX, centerY);
  const label = rotateAround(
    { x: base.label.x, y: base.label.y },
    view.rotation,
    centerX,
    centerY,
  );

  return Object.freeze({
    ...base,
    x: center.x,
    y: center.y,
    polygon: Object.freeze(
      base.polygon.map((vertex) =>
        rotateAround(vertex, view.rotation, centerX, centerY),
      ),
    ),
    label: Object.freeze({
      x: label.x,
      y: label.y,
      rotation: base.label.rotation + view.rotation,
    }),
    viewSquare: getViewSquareNumber(color, squareNumber),
    viewRotation: view.rotation,
  });
}

/**
 * Every position on the board for a given play-surface size (in pixels):
 * track squares, private corridors, yards and their token slots, and goals.
 *
 * The renderer uses this layout directly, and token layers can use it to place
 * pieces without knowing how the board is drawn.
 */
export function getBoardPositions(
  playSize: number,
  originX = 0,
  originY = 0,
): BoardPositions {
  assertPlaySize(playSize);

  const origin = point(originX, originY);
  const unit = playSize / BOARD_UNITS;

  const squares = Object.freeze(
    TRACK_CELLS.map((cell) =>
      getSquarePosition(cell.square, playSize, originX, originY),
    ),
  );

  const corridors = Object.freeze(
    Object.fromEntries(
      COLORS.map((color) => [
        color,
        Object.freeze(
          getCorridorCells(color).map((cell) => {
            const center = unitPointToPixel(
              cell.center,
              playSize,
              originX,
              originY,
            );

            return Object.freeze({
              color,
              index: cell.index,
              points: cell.points,
              center: cell.center,
              polygon: pixelPolygon(cell, playSize, originX, originY),
              x: center.x,
              y: center.y,
            });
          }),
        ),
      ]),
    ) as Record<ParchisColor, readonly CorridorPosition[]>,
  );

  const yards = Object.freeze(
    Object.fromEntries(
      COLORS.map((color) => {
        const yard = getYardRect(color);
        const center = unitPointToPixel(
          getYardCenter(color),
          playSize,
          originX,
          originY,
        );

        return [
          color,
          Object.freeze({
            color,
            x: unitToPixel(yard.x, playSize, originX),
            y: unitToPixel(yard.y, playSize, originY),
            width: yard.width * unit,
            height: yard.height * unit,
            center,
            slots: Object.freeze(
              [0, 1, 2, 3].map((slot) =>
                unitPointToPixel(
                  getYardSlotAnchor(color, slot),
                  playSize,
                  originX,
                  originY,
                ),
              ),
            ),
          }),
        ];
      }),
    ) as Record<ParchisColor, YardPosition>,
  );

  const goals = Object.freeze(
    Object.fromEntries(
      COLORS.map((color) => {
        const goal = getGoalTriangle(color);
        const center = unitPointToPixel(
          goal.center,
          playSize,
          originX,
          originY,
        );

        return [
          color,
          Object.freeze({
            color,
            x: center.x,
            y: center.y,
            polygon: pixelPolygon(goal, playSize, originX, originY),
          }),
        ];
      }),
    ) as Record<ParchisColor, GoalPosition>,
  );

  return Object.freeze({
    playSize,
    origin,
    unit,
    squares,
    corridors,
    yards,
    goals,
    center: unitPointToPixel(point(10.5, 10.5), playSize, originX, originY),
  });
}

/**
 * Convenience lookup for a square canvas: uses the standard table/frame
 * proportions and returns every position in canvas pixels. This is the main
 * function for a future token layer that only knows the rendered canvas size.
 */
export function getBoardPositionsForCanvas(
  canvasSize: number,
  originX = 0,
  originY = 0,
): BoardPositions {
  const frame = getBoardFrameLayout(canvasSize);

  return getBoardPositions(
    frame.playSize,
    originX + frame.playX,
    originY + frame.playY,
  );
}

/**
 * All numbered squares in a player's view for a square canvas: centre,
 * polygon, label, and player-relative number after the board rotation.
 */
export function getViewBoardPositionsForCanvas(
  canvasSize: number,
  color: ParchisColor,
  originX = 0,
  originY = 0,
): readonly ViewSquarePosition[] {
  const frame = getBoardFrameLayout(canvasSize);

  return Object.freeze(
    TRACK_CELLS.map((cell) =>
      getViewSquarePosition(
        color,
        cell.square,
        frame.playSize,
        originX + frame.playX,
        originY + frame.playY,
      ),
    ),
  );
}

/** Pixel anchor for a token at an engine progress value. */
export function getProgressPoint(
  color: ParchisColor,
  progress: number,
  playSize: number,
  originX = 0,
  originY = 0,
): BoardPoint {
  return unitPointToPixel(
    getProgressAnchor(color, progress),
    playSize,
    originX,
    originY,
  );
}
