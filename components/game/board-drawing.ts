import type * as PIXI from "pixi.js";
import {
  COLORS,
  getBoardFrameLayout,
  getBoardPositions,
  getBoardView,
  getViewSquareNumber,
  type BoardPoint,
  type ParchisColor,
} from "@/lib/parchis/board-geometry";

export type PixiModule = typeof import("pixi.js");

type Random = () => number;

/**
 * Warm, photo-derived palette. Fills are painted over a wooden play surface;
 * the grain drawn later unifies everything into one board.
 */
const PALETTE = {
  table: 0x664429,
  tableDark: 0x422817,
  tableLight: 0x865733,
  frame: 0xc08c58,
  frameLight: 0xd5a36c,
  frameDark: 0x8f5c34,
  frameLine: 0x432714,
  surface: 0xe9ba85,
  surfaceLight: 0xf4d3a4,
  surfaceDark: 0xdfa976,
  grain: 0x74492a,
  ink: 0x241408,
  inkSoft: 0x4a2f18,
  shadow: 0x000000,
  safe: 0xcf8352,
  tip: 0xb85a33,
} as const;

const HOME_COLOR: Readonly<Record<ParchisColor, number>> = Object.freeze({
  green: 0x6fab49,
  yellow: 0xfde65b,
  blue: 0x0a84ae,
  red: 0xe3422b,
});

const MOTIF_COLOR: Readonly<Record<ParchisColor, number>> = Object.freeze({
  green: 0x158f4b,
  yellow: 0xf9e2ac,
  blue: 0x03608d,
  red: 0xf08068,
});

/** Paint used for corridor cells and start squares. */
const PAINT_COLOR: Readonly<Record<ParchisColor, number>> = Object.freeze({
  green: 0x91bd65,
  yellow: 0xfce45b,
  blue: 0x1699bf,
  red: 0xe65449,
});

/** The centre triangles are painted a touch brighter than the corridors. */
const GOAL_COLOR: Readonly<Record<ParchisColor, number>> = Object.freeze({
  green: 0x8bb859,
  yellow: 0xfde869,
  blue: 0x27a7cf,
  red: 0xe65449,
});

export interface DrawBoardOptions {
  width: number;
  height: number;
  fontFamily: string;
  playerColor: ParchisColor;
}

function mulberry32(seed: number): Random {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function flatten(points: readonly BoardPoint[]): number[] {
  const result: number[] = [];
  for (const point of points) result.push(point.x, point.y);
  return result;
}

const lerp = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;

function samplePolyline(
  points: readonly BoardPoint[],
  closed: boolean,
  step: number,
): BoardPoint[] {
  if (points.length < 2) return [...points];

  const sampled: BoardPoint[] = [];
  const edgeCount = closed ? points.length : points.length - 1;

  for (let edge = 0; edge < edgeCount; edge += 1) {
    const from = points[edge];
    const to = points[(edge + 1) % points.length];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const segments = Math.max(1, Math.ceil(length / step));

    for (let index = 0; index < segments; index += 1) {
      const amount = index / segments;
      sampled.push({
        x: lerp(from.x, to.x, amount),
        y: lerp(from.y, to.y, amount),
      });
    }
  }

  if (!closed) sampled.push(points[points.length - 1]);

  return sampled;
}

function jitter(
  points: readonly BoardPoint[],
  random: Random,
  amplitude: number,
): BoardPoint[] {
  return points.map((point) => ({
    x: point.x + (random() * 2 - 1) * amplitude,
    y: point.y + (random() * 2 - 1) * amplitude,
  }));
}

interface Ink {
  color: number;
  width: number;
  alpha: number;
}

/**
 * A single seeded free-hand pass. The same sampled skeleton is jittered twice
 * for the main stroke and a faint pencil echo, matching drawably's language.
 */
function strokeRough(
  graphics: PIXI.Graphics,
  points: readonly BoardPoint[],
  closed: boolean,
  random: Random,
  options: {
    width: number;
    amplitude: number;
    step: number;
    ink: Ink;
    echo?: boolean;
  },
): void {
  const { width, amplitude, step, ink, echo = true } = options;
  const skeleton = samplePolyline(points, closed, step);
  const main = jitter(skeleton, random, amplitude);

  graphics.poly(flatten(main), closed).stroke({
    width,
    color: ink.color,
    alpha: ink.alpha,
  });

  if (echo) {
    const second = jitter(skeleton, random, amplitude * 1.45);
    graphics.poly(flatten(second), closed).stroke({
      width: Math.max(0.5, width * 0.52),
      color: ink.color,
      alpha: ink.alpha * 0.24,
    });
  }
}

function rectPoints(
  x: number,
  y: number,
  width: number,
  height: number,
): BoardPoint[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

interface GrainOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  random: Random;
  count: number;
  vertical: boolean;
  color: number;
  alphaMin: number;
  alphaMax: number;
  lineWidth: number;
  waviness?: number;
}

function drawGrain(graphics: PIXI.Graphics, options: GrainOptions): void {
  const {
    x,
    y,
    width,
    height,
    random,
    count,
    vertical,
    color,
    alphaMin,
    alphaMax,
    lineWidth,
    waviness = 0.012,
  } = options;

  for (let index = 0; index < count; index += 1) {
    const alpha = lerp(alphaMin, alphaMax, random());
    const strokeWidth = lineWidth * (0.55 + random() * 0.9);

    if (vertical) {
      const startX = x + random() * width;
      const startY = y + random() * height * 0.12;
      const endY = y + height * (0.78 + random() * 0.22);
      const segments = 5;

      graphics.moveTo(startX, startY);
      for (let step = 1; step <= segments; step += 1) {
        const amount = step / segments;
        graphics.lineTo(
          startX + (random() - 0.5) * width * waviness,
          lerp(startY, endY, amount),
        );
      }
    } else {
      const startX = x + random() * width * 0.08;
      const endX = x + width * (0.82 + random() * 0.18);
      const startY = y + random() * height;
      const segments = 5;

      graphics.moveTo(startX, startY);
      for (let step = 1; step <= segments; step += 1) {
        const amount = step / segments;
        graphics.lineTo(
          lerp(startX, endX, amount),
          startY + (random() - 0.5) * height * waviness,
        );
      }
    }

    graphics.stroke({ width: strokeWidth, color, alpha });
  }
}

function drawKnot(
  graphics: PIXI.Graphics,
  x: number,
  y: number,
  radius: number,
  color: number,
): void {
  for (let ring = 0; ring < 4; ring += 1) {
    graphics
      .ellipse(
        x + ring * radius * 0.12,
        y - ring * radius * 0.06,
        radius * (1 - ring * 0.18),
        radius * (0.55 - ring * 0.08),
      )
      .stroke({
        width: Math.max(0.5, radius * 0.06),
        color,
        alpha: 0.09 - ring * 0.015,
      });
  }
}

/**
 * One of the four home flowers: sixteen rice-grain petals, an eight-point star,
 * a scalloped gear ring, and a separate centre dot. Fills are flat paint; the
 * board grain drawn afterwards gives them the printed-on-wood look.
 */
function drawFlower(
  pixi: PixiModule,
  parent: PIXI.Container,
  options: {
    color: ParchisColor;
    centerX: number;
    centerY: number;
    unit: number;
  },
): void {
  const { color, centerX, centerY, unit } = options;
  const motif = MOTIF_COLOR[color];
  const flower = new pixi.Graphics();

  const rotatePoint = (x: number, y: number, rotation: number): BoardPoint => ({
    x: centerX + x * Math.cos(rotation) - y * Math.sin(rotation),
    y: centerY + x * Math.sin(rotation) + y * Math.cos(rotation),
  });

  // Sixteen outer petals, alternating long and short like the reference.
  const petalCount = 16;
  const baseRadius = 1.94 * unit;

  for (let index = 0; index < petalCount; index += 1) {
    const longPetal = index % 2 === 0;
    const tipRadius = (longPetal ? 3.32 : 2.9) * unit;
    const petalWidth = (longPetal ? 0.345 : 0.32) * unit;
    const petalLength = tipRadius - baseRadius;
    const angle = -Math.PI / 2 + (index / petalCount) * Math.PI * 2;
    const rotation = angle + Math.PI / 2;

    const base = rotatePoint(0, -baseRadius, rotation);
    const control1 = rotatePoint(
      -petalWidth,
      -baseRadius - petalLength * 0.22,
      rotation,
    );
    const control2 = rotatePoint(
      -petalWidth,
      -tipRadius + petalLength * 0.16,
      rotation,
    );
    const tip = rotatePoint(0, -tipRadius, rotation);
    const control3 = rotatePoint(
      petalWidth,
      -tipRadius + petalLength * 0.16,
      rotation,
    );
    const control4 = rotatePoint(
      petalWidth,
      -baseRadius - petalLength * 0.22,
      rotation,
    );

    flower.moveTo(base.x, base.y);
    flower.bezierCurveTo(
      control1.x,
      control1.y,
      control2.x,
      control2.y,
      tip.x,
      tip.y,
    );
    flower.bezierCurveTo(
      control3.x,
      control3.y,
      control4.x,
      control4.y,
      base.x,
      base.y,
    );
    flower.closePath();
  }

  flower.fill({ color: motif, alpha: 0.98 });

  // Eight-point star with V notches; points sit a half-step off vertical.
  const star: BoardPoint[] = [];
  const starPoints = 8;
  const starInner = 1.44 * unit;
  const starOuter = 1.8 * unit;

  for (let index = 0; index < starPoints; index += 1) {
    const innerAngle = -Math.PI / 2 + (index / starPoints) * Math.PI * 2;
    const outerAngle =
      -Math.PI / 2 + Math.PI / 8 + (index / starPoints) * Math.PI * 2;

    star.push({
      x: centerX + Math.cos(innerAngle) * starInner,
      y: centerY + Math.sin(innerAngle) * starInner,
    });
    star.push({
      x: centerX + Math.cos(outerAngle) * starOuter,
      y: centerY + Math.sin(outerAngle) * starOuter,
    });
  }

  flower.poly(flatten(star), true).fill({ color: motif, alpha: 0.98 });

  // Scalloped ring: a paint disc bitten by eight home-colour notches.
  flower
    .circle(centerX, centerY, 1.1 * unit)
    .fill({ color: motif, alpha: 0.98 });

  for (let index = 0; index < 8; index += 1) {
    const angle = -Math.PI / 2 + Math.PI / 8 + (index / 8) * Math.PI * 2;
    flower
      .circle(
        centerX + Math.cos(angle) * 1.0 * unit,
        centerY + Math.sin(angle) * 1.0 * unit,
        0.22 * unit,
      )
      .fill({ color: HOME_COLOR[color], alpha: 1 });
  }

  flower
    .circle(centerX, centerY, 0.72 * unit)
    .fill({ color: HOME_COLOR[color], alpha: 1 });
  flower
    .circle(centerX, centerY, 0.36 * unit)
    .fill({ color: motif, alpha: 0.98 });

  parent.addChild(flower);
}

interface Interval {
  start: number;
  end: number;
}

function addAxisEdge(
  lines: Map<string, Interval[]>,
  coordinate: number,
  start: number,
  end: number,
): void {
  const key = coordinate.toFixed(3);
  const bucket = lines.get(key);
  const interval = { start: Math.min(start, end), end: Math.max(start, end) };

  if (bucket) bucket.push(interval);
  else lines.set(key, [interval]);
}

/**
 * Collects every axis-aligned cell edge into line buckets. Shared edges are
 * merged later, so the sketch grid is drawn once per border instead of once per
 * neighbouring cell. Chamfer diagonals are handled by the goal X stroke.
 */
function collectCellBorders(
  polygons: readonly (readonly BoardPoint[])[],
  vertical: Map<string, Interval[]>,
  horizontal: Map<string, Interval[]>,
): void {
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) {
      const from = polygon[index];
      const to = polygon[(index + 1) % polygon.length];
      const dx = to.x - from.x;
      const dy = to.y - from.y;

      if (Math.abs(dx) < 0.01 && Math.abs(dy) >= 0.5) {
        addAxisEdge(vertical, from.x, from.y, to.y);
      } else if (Math.abs(dy) < 0.01 && Math.abs(dx) >= 0.5) {
        addAxisEdge(horizontal, from.y, from.x, to.x);
      }
    }
  }
}

function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];

  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end + 0.05) {
      merged.push({ ...interval });
    } else {
      last.end = Math.max(last.end, interval.end);
    }
  }

  return merged;
}

function corridorBounds(
  cells: readonly { polygon: readonly BoardPoint[] }[],
): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const cell of cells) {
    for (const point of cell.polygon) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Draws the whole board. The canvas is square in normal use; if it is not, the
 * board is centred on the smaller side and the table wood fills the rest.
 */
export function drawBoard(
  pixi: PixiModule,
  stage: PIXI.Container,
  options: DrawBoardOptions,
): void {
  const previous = stage.removeChildren();
  for (const child of previous) child.destroy({ children: true });

  const { width, height, fontFamily, playerColor } = options;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 24 ||
    height < 24
  ) {
    return;
  }

  const side = Math.min(width, height);
  const offsetX = (width - side) / 2;
  const offsetY = (height - side) / 2;

  const frameLayout = getBoardFrameLayout(side);
  const { frameWidth, boardSize, playSize } = frameLayout;
  const playX = offsetX + frameLayout.playX;
  const playY = offsetY + frameLayout.playY;
  const boardX = playX - frameWidth;
  const boardY = playY - frameWidth;

  const unit = playSize / 21;
  const positions = getBoardPositions(playSize, playX, playY);
  const view = getBoardView(playerColor);
  const playCenterX = playX + playSize / 2;
  const playCenterY = playY + playSize / 2;

  const tableRandom = mulberry32(0x51ab1e);
  const frameRandom = mulberry32(0xf4a3e1);
  const playRandom = mulberry32(0x9a7c3e);
  const borderRandom = mulberry32(0xc0ffee);

  const line = Math.max(0.9, unit * 0.048);
  const featureLine = Math.max(1.1, unit * 0.06);
  const frameLine = Math.max(1.25, unit * 0.075);
  const roughAmplitude = Math.max(0.7, unit * 0.04);
  const featureAmplitude = Math.max(0.85, unit * 0.048);
  const frameAmplitude = Math.max(1.05, unit * 0.065);
  const step = Math.max(5.5, unit * 0.32);
  const ink: Ink = { color: PALETTE.ink, width: line, alpha: 0.92 };
  const featureInk: Ink = {
    color: PALETTE.ink,
    width: featureLine,
    alpha: 0.95,
  };
  const frameInk: Ink = {
    color: PALETTE.frameLine,
    width: frameLine,
    alpha: 0.88,
  };

  const root = new pixi.Container();
  stage.addChild(root);

  // 1. Walnut table and its grain.
  const table = new pixi.Graphics();
  table.rect(0, 0, width, height).fill(PALETTE.table);
  root.addChild(table);

  drawGrain(table, {
    x: 0,
    y: 0,
    width,
    height,
    random: tableRandom,
    count: Math.round(side / 6),
    vertical: false,
    color: PALETTE.tableDark,
    alphaMin: 0.07,
    alphaMax: 0.2,
    lineWidth: Math.max(0.8, side * 0.0026),
    waviness: 0.04,
  });
  drawGrain(table, {
    x: 0,
    y: 0,
    width,
    height,
    random: tableRandom,
    count: Math.round(side / 18),
    vertical: false,
    color: PALETTE.tableLight,
    alphaMin: 0.05,
    alphaMax: 0.13,
    lineWidth: Math.max(1.1, side * 0.004),
    waviness: 0.045,
  });

  for (let index = 0; index < 3; index += 1) {
    drawKnot(
      table,
      tableRandom() * width,
      tableRandom() * height,
      side * (0.03 + tableRandom() * 0.04),
      PALETTE.tableDark,
    );
  }

  // 2. Soft drop shadow, then the oak frame.
  const shadow = new pixi.Graphics();
  shadow
    .roundRect(
      boardX + side * 0.004,
      boardY + side * 0.01,
      boardSize,
      boardSize,
      side * 0.012,
    )
    .fill({ color: PALETTE.shadow, alpha: 0.16 });
  shadow
    .roundRect(
      boardX + side * 0.008,
      boardY + side * 0.016,
      boardSize,
      boardSize,
      side * 0.014,
    )
    .fill({ color: PALETTE.shadow, alpha: 0.1 });
  root.addChild(shadow);

  const frame = new pixi.Graphics();
  frame
    .rect(boardX, boardY, boardSize, boardSize)
    .fill(PALETTE.frame);
  frame
    .rect(
      playX - frameWidth * 0.34,
      playY - frameWidth * 0.34,
      playSize + frameWidth * 0.68,
      playSize + frameWidth * 0.68,
    )
    .fill(PALETTE.frameLight);
  root.addChild(frame);

  // Frame grain runs along each band, so the mitres read as real wood.
  drawGrain(frame, {
    x: boardX,
    y: boardY,
    width: boardSize,
    height: frameWidth,
    random: frameRandom,
    count: Math.max(5, Math.round(frameWidth / 3)),
    vertical: false,
    color: PALETTE.frameDark,
    alphaMin: 0.07,
    alphaMax: 0.17,
    lineWidth: Math.max(0.55, unit * 0.022),
    waviness: 0.028,
  });
  drawGrain(frame, {
    x: boardX,
    y: boardY + boardSize - frameWidth,
    width: boardSize,
    height: frameWidth,
    random: frameRandom,
    count: Math.max(5, Math.round(frameWidth / 3)),
    vertical: false,
    color: PALETTE.frameDark,
    alphaMin: 0.07,
    alphaMax: 0.17,
    lineWidth: Math.max(0.55, unit * 0.022),
    waviness: 0.028,
  });
  drawGrain(frame, {
    x: boardX,
    y: boardY + frameWidth,
    width: frameWidth,
    height: playSize,
    random: frameRandom,
    count: Math.max(8, Math.round(playSize / 9)),
    vertical: true,
    color: PALETTE.frameDark,
    alphaMin: 0.06,
    alphaMax: 0.15,
    lineWidth: Math.max(0.55, unit * 0.022),
    waviness: 0.028,
  });
  drawGrain(frame, {
    x: boardX + boardSize - frameWidth,
    y: boardY + frameWidth,
    width: frameWidth,
    height: playSize,
    random: frameRandom,
    count: Math.max(8, Math.round(playSize / 9)),
    vertical: true,
    color: PALETTE.frameDark,
    alphaMin: 0.06,
    alphaMax: 0.15,
    lineWidth: Math.max(0.55, unit * 0.022),
    waviness: 0.028,
  });

  // Mitred corner lines from the outer frame to the play surface.
  const frameCorners: Array<[BoardPoint, BoardPoint]> = [
    [{ x: boardX, y: boardY }, { x: playX, y: playY }],
    [{ x: boardX + boardSize, y: boardY }, { x: playX + playSize, y: playY }],
    [
      { x: boardX + boardSize, y: boardY + boardSize },
      { x: playX + playSize, y: playY + playSize },
    ],
    [{ x: boardX, y: boardY + boardSize }, { x: playX, y: playY + playSize }],
  ];

  for (const [from, to] of frameCorners) {
    strokeRough(frame, [from, to], false, borderRandom, {
      width: frameLine * 0.8,
      amplitude: frameAmplitude * 0.65,
      step,
      ink: { ...frameInk, alpha: 0.58 },
      echo: false,
    });
  }

  // The whole play area rotates for the current player's view.
  const playRoot = new pixi.Container();
  playRoot.pivot.set(playCenterX, playCenterY);
  playRoot.position.set(playCenterX, playCenterY);
  playRoot.rotation = view.rotation;
  root.addChild(playRoot);

  // 3. Cream wooden play surface.
  const surface = new pixi.Graphics();
  surface
    .rect(playX, playY, playSize, playSize)
    .fill(PALETTE.surface);
  playRoot.addChild(surface);

  // Broad tonal planks.
  for (let index = 0; index < 7; index += 1) {
    const plankWidth = playSize * (0.06 + playRandom() * 0.1);
    const plankX = playX + playRandom() * (playSize - plankWidth);
    surface
      .rect(plankX, playY, plankWidth, playSize)
      .fill({
        color:
          playRandom() > 0.5 ? PALETTE.surfaceLight : PALETTE.surfaceDark,
        alpha: 0.055,
      });
  }

  drawGrain(surface, {
    x: playX,
    y: playY,
    width: playSize,
    height: playSize,
    random: playRandom,
    count: Math.round(playSize / 7),
    vertical: true,
    color: PALETTE.grain,
    alphaMin: 0.03,
    alphaMax: 0.085,
    lineWidth: Math.max(0.5, unit * 0.015),
    waviness: 0.032,
  });
  drawGrain(surface, {
    x: playX,
    y: playY,
    width: playSize,
    height: playSize,
    random: playRandom,
    count: Math.round(playSize / 12),
    vertical: false,
    color: PALETTE.grain,
    alphaMin: 0.025,
    alphaMax: 0.06,
    lineWidth: Math.max(0.45, unit * 0.012),
    waviness: 0.03,
  });
  drawGrain(surface, {
    x: playX,
    y: playY,
    width: playSize,
    height: playSize,
    random: playRandom,
    count: Math.round(playSize / 26),
    vertical: true,
    color: PALETTE.surfaceLight,
    alphaMin: 0.03,
    alphaMax: 0.075,
    lineWidth: Math.max(0.9, unit * 0.04),
    waviness: 0.024,
  });

  // 4. Painted areas: homes, private corridors, special cells, goal.
  const fills = new pixi.Graphics();
  playRoot.addChild(fills);

  for (const color of COLORS) {
    const yard = positions.yards[color];
    fills
      .rect(yard.x, yard.y, yard.width, yard.height)
      .fill({ color: HOME_COLOR[color], alpha: 0.94 });
  }

  for (const color of COLORS) {
    const bounds = corridorBounds(positions.corridors[color]);
    fills
      .rect(bounds.x, bounds.y, bounds.width, bounds.height)
      .fill({ color: PAINT_COLOR[color], alpha: 0.93 });
  }

  for (const square of positions.squares) {
    if (square.kind === "start" && square.color) {
      fills
        .poly(flatten(square.polygon), true)
        .fill({ color: PAINT_COLOR[square.color], alpha: 0.95 });
    } else if (square.kind === "safe") {
      fills
        .poly(flatten(square.polygon), true)
        .fill({ color: PALETTE.safe, alpha: 0.8 });
    } else if (square.kind === "home-entrance") {
      fills
        .poly(flatten(square.polygon), true)
        .fill({ color: PALETTE.tip, alpha: 0.96 });
    }
  }

  for (const color of COLORS) {
    const goal = positions.goals[color];
    fills
      .poly(flatten(goal.polygon), true)
      .fill({ color: GOAL_COLOR[color], alpha: 0.94 });
  }

  // 5. Home flowers.
  const flowers = new pixi.Container();
  playRoot.addChild(flowers);

  for (const color of COLORS) {
    const yard = positions.yards[color];
    drawFlower(pixi, flowers, {
      color,
      centerX: yard.center.x,
      centerY: yard.center.y,
      unit,
    });
  }

  // 6. A light grain wash over the paint, so the board is one piece of wood.
  const overlay = new pixi.Graphics();
  playRoot.addChild(overlay);

  drawGrain(overlay, {
    x: playX,
    y: playY,
    width: playSize,
    height: playSize,
    random: playRandom,
    count: Math.round(playSize / 10),
    vertical: true,
    color: PALETTE.grain,
    alphaMin: 0.025,
    alphaMax: 0.06,
    lineWidth: Math.max(0.45, unit * 0.012),
    waviness: 0.028,
  });
  drawGrain(overlay, {
    x: playX,
    y: playY,
    width: playSize,
    height: playSize,
    random: playRandom,
    count: Math.round(playSize / 26),
    vertical: false,
    color: PALETTE.grain,
    alphaMin: 0.02,
    alphaMax: 0.05,
    lineWidth: Math.max(0.4, unit * 0.011),
    waviness: 0.03,
  });
  drawGrain(overlay, {
    x: playX,
    y: playY,
    width: playSize,
    height: playSize,
    random: playRandom,
    count: Math.round(playSize / 30),
    vertical: true,
    color: PALETTE.surfaceLight,
    alphaMin: 0.025,
    alphaMax: 0.055,
    lineWidth: Math.max(0.8, unit * 0.028),
    waviness: 0.02,
  });

  // 7. One free-hand ink stroke per shared border.
  const borders = new pixi.Graphics();
  playRoot.addChild(borders);

  const goalMinX = playX + (8 / 21) * playSize;
  const goalMinY = playY + (8 / 21) * playSize;
  const goalMaxX = playX + (13 / 21) * playSize;
  const goalMaxY = playY + (13 / 21) * playSize;

  const verticalLines = new Map<string, Interval[]>();
  const horizontalLines = new Map<string, Interval[]>();
  const borderPolygons: BoardPoint[][] = [
    ...positions.squares.map((square) => [...square.polygon]),
    ...COLORS.flatMap((color) =>
      positions.corridors[color].map((corridor) => [...corridor.polygon]),
    ),
    ...COLORS.map((color) => {
      const yard = positions.yards[color];
      return rectPoints(yard.x, yard.y, yard.width, yard.height);
    }),
    rectPoints(goalMinX, goalMinY, goalMaxX - goalMinX, goalMaxY - goalMinY),
  ];

  collectCellBorders(borderPolygons, verticalLines, horizontalLines);

  for (const [coordinate, intervals] of [...verticalLines.entries()].sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  )) {
    const x = Number(coordinate);
    for (const interval of mergeIntervals(intervals)) {
      strokeRough(
        borders,
        [
          { x, y: interval.start },
          { x, y: interval.end },
        ],
        false,
        borderRandom,
        {
          width: line,
          amplitude: roughAmplitude,
          step,
          ink,
          echo: false,
        },
      );
    }
  }

  for (const [coordinate, intervals] of [...horizontalLines.entries()].sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  )) {
    const y = Number(coordinate);
    for (const interval of mergeIntervals(intervals)) {
      strokeRough(
        borders,
        [
          { x: interval.start, y },
          { x: interval.end, y },
        ],
        false,
        borderRandom,
        {
          width: line,
          amplitude: roughAmplitude,
          step,
          ink,
          echo: false,
        },
      );
    }
  }

  // The goal X continues the two diagonals out to the four home corners.
  const xLines: Array<[BoardPoint, BoardPoint]> = [
    [
      { x: playX + (7 / 21) * playSize, y: playY + (7 / 21) * playSize },
      { x: playX + (14 / 21) * playSize, y: playY + (14 / 21) * playSize },
    ],
    [
      { x: playX + (14 / 21) * playSize, y: playY + (7 / 21) * playSize },
      { x: playX + (7 / 21) * playSize, y: playY + (14 / 21) * playSize },
    ],
  ];

  for (const [from, to] of xLines) {
    strokeRough(borders, [from, to], false, borderRandom, {
      width: featureLine,
      amplitude: featureAmplitude,
      step,
      ink: featureInk,
    });
  }

  // Outer frame edge and bevel stay fixed while the play area rotates.
  const frameBorders = new pixi.Graphics();
  root.addChild(frameBorders);

  strokeRough(
    frameBorders,
    rectPoints(boardX, boardY, boardSize, boardSize),
    true,
    borderRandom,
    {
      width: frameLine,
      amplitude: frameAmplitude,
      step,
      ink: frameInk,
    },
  );

  // A quiet highlight on the inner frame bevel.
  strokeRough(
    frameBorders,
    rectPoints(
      playX - frameWidth * 0.3,
      playY - frameWidth * 0.3,
      playSize + frameWidth * 0.6,
      playSize + frameWidth * 0.6,
    ),
    true,
    borderRandom,
    {
      width: Math.max(0.7, frameLine * 0.55),
      amplitude: frameAmplitude * 0.7,
      step,
      ink: { color: PALETTE.surfaceLight, width: 1, alpha: 0.25 },
      echo: false,
    },
  );

  // 8. Numbers, rotated to face the player on each side of the board.
  const fontSize = Math.max(6, unit * 0.42);
  const labels = new pixi.Container();
  playRoot.addChild(labels);

  for (const square of positions.squares) {
    const label = new pixi.Text({
      text: String(getViewSquareNumber(playerColor, square.square)),
      style: {
        fontFamily,
        fontSize,
        fontWeight: "700",
        fill: PALETTE.ink,
        align: "center",
      },
    });

    label.anchor.set(0.5);
    label.x = square.label.x;
    label.y = square.label.y;
    label.rotation = square.label.rotation;
    label.alpha = 0.95;
    labels.addChild(label);
  }
}
