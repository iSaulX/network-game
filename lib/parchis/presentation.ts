import {
  getBoardFrameLayout,
  getBoardView,
  getCorridorCells,
  getGoalTriangle,
  getProgressAnchor,
  getViewSquareNumber,
  getYardSlotAnchor,
  progressToSquare,
  rotateUnitPoint,
  squareToCell,
  type BoardPoint,
  type ParchisColor,
} from "./board-geometry";
import type {
  BonusMove,
  Color,
  DieValue,
  GameState,
  Move,
  Player,
  Token,
  Zone,
} from "./types";

/**
 * Translation between the engine's colour names and the artwork's corner
 * colours. The engine numbers its starts red 0 → blue 17 → yellow 34 →
 * green 51; the board numbers green 5 → blue 22 → red 39 → yellow 56. The
 * constant +4 board offset between the two start sets makes this a pure
 * renaming: a token's progress (0–71) is identical in both models.
 */
export const ENGINE_TO_BOARD_COLOR: Readonly<Record<Color, ParchisColor>> =
  Object.freeze({
    red: "green",
    blue: "blue",
    yellow: "red",
    green: "yellow",
  });

export const BOARD_TO_ENGINE_COLOR: Readonly<Record<ParchisColor, Color>> =
  Object.freeze({
    green: "red",
    blue: "blue",
    red: "yellow",
    yellow: "green",
  });

export function getBoardColor(color: Color): ParchisColor {
  return ENGINE_TO_BOARD_COLOR[color];
}

export function getEngineColor(color: ParchisColor): Color {
  return BOARD_TO_ENGINE_COLOR[color];
}

export function getPlayerBoardColor(player: Player): ParchisColor {
  return getBoardColor(player.color);
}

/** A piece positioned in board units, ready for the Pixi layer. */
export interface PresentedToken {
  readonly id: string;
  readonly playerId: string;
  readonly color: ParchisColor;
  readonly zone: Zone;
  readonly progress: number | null;
  readonly anchor: BoardPoint;
  /** Radius in board units (the renderer multiplies by the board unit size). */
  readonly radius: number;
}

/** A highlighted landing square in board units. */
export interface PresentedDestination {
  readonly playerId: string;
  readonly color: ParchisColor;
  readonly progress: number;
  readonly anchor: BoardPoint;
}

/** The two dice of a player's latest roll, plus which faces are still unspent. */
export interface PresentedDie {
  readonly playerId: string;
  readonly color: ParchisColor;
  readonly values: readonly [DieValue | null, DieValue | null];
  readonly used: readonly [boolean, boolean];
  readonly active: boolean;
}

const YARD_RADIUS = 1.18;
const TRACK_RADIUS = 0.64;
const STACKED_TRACK_RADIUS = 0.54;
const CORRIDOR_RADIUS = 0.56;
const CORRIDOR_STACK_RADIUS = 0.46;
const CORRIDOR_SMALL_RADIUS = 0.34;
const GOAL_RADIUS = 0.5;
const GOAL_STACK_RADIUS = 0.4;

interface TokenEntry {
  readonly token: Token;
  readonly player: Player;
}

interface StackGroup {
  readonly kind: "track" | "corridor" | "goal";
  readonly color: ParchisColor;
  readonly anchor: BoardPoint;
  /** Long axis of the containing cell, used to spread stacked chips. */
  readonly axis: "x" | "y";
  readonly entries: TokenEntry[];
}

function boundsAxis(points: readonly BoardPoint[]): "x" | "y" {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  return maxX - minX >= maxY - minY ? "x" : "y";
}

function offset(anchor: BoardPoint, axis: "x" | "y", amount: number): BoardPoint {
  return axis === "x"
    ? { x: anchor.x + amount, y: anchor.y }
    : { x: anchor.x, y: anchor.y + amount };
}

function offset2(
  anchor: BoardPoint,
  x: number,
  y: number,
): BoardPoint {
  return { x: anchor.x + x, y: anchor.y + y };
}

function trackOffsets(count: number): number[] {
  if (count <= 1) return [0];
  if (count === 2) return [-0.38, 0.38];
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * 0.28);
}

function corridorOffsets(count: number): number[] {
  if (count <= 1) return [0];
  if (count === 2) return [-0.4, 0.4];
  if (count === 3) return [-0.48, 0, 0.48];
  return [-0.68, -0.23, 0.23, 0.68];
}

function goalOffsets(count: number): Array<{ x: number; y: number }> {
  if (count <= 1) return [{ x: 0, y: 0 }];
  if (count === 2) {
    return [
      { x: -0.35, y: 0 },
      { x: 0.35, y: 0 },
    ];
  }
  if (count === 3) {
    return [
      { x: -0.35, y: -0.2 },
      { x: 0.35, y: -0.2 },
      { x: 0, y: 0.3 },
    ];
  }
  return [
    { x: -0.35, y: -0.25 },
    { x: 0.35, y: -0.25 },
    { x: -0.35, y: 0.25 },
    { x: 0.35, y: 0.25 },
  ];
}

function radiusFor(kind: StackGroup["kind"], count: number): number {
  if (kind === "track") return count > 1 ? STACKED_TRACK_RADIUS : TRACK_RADIUS;
  if (kind === "goal") return count > 1 ? GOAL_STACK_RADIUS : GOAL_RADIUS;
  if (count > 2) return CORRIDOR_SMALL_RADIUS;
  return count > 1 ? CORRIDOR_STACK_RADIUS : CORRIDOR_RADIUS;
}

function presentGroup(group: StackGroup): PresentedToken[] {
  const count = group.entries.length;
  const radius = radiusFor(group.kind, count);

  if (group.kind === "goal") {
    const offsets = goalOffsets(count);
    return group.entries.map((entry, index) => ({
      id: entry.token.id,
      playerId: entry.player.id,
      color: group.color,
      zone: entry.token.zone,
      progress: entry.token.progress,
      anchor: offset2(group.anchor, offsets[index].x, offsets[index].y),
      radius,
    }));
  }

  const positions =
    group.kind === "track" ? trackOffsets(count) : corridorOffsets(count);

  return group.entries.map((entry, index) => ({
    id: entry.token.id,
    playerId: entry.player.id,
    color: group.color,
    zone: entry.token.zone,
    progress: entry.token.progress,
    anchor: offset(group.anchor, group.axis, positions[index]),
    radius,
  }));
}

function addToGroup(
  groups: Map<string, StackGroup>,
  key: string,
  group: Omit<StackGroup, "entries">,
  entry: TokenEntry,
): void {
  const existing = groups.get(key);
  if (existing) {
    existing.entries.push(entry);
    return;
  }

  groups.set(key, { ...group, entries: [entry] });
}

/**
 * Every engine token placed in board units. Yard tokens keep their original
 * slot; track and corridor tokens are grouped per cell and fanned out; goal
 * tokens cluster inside their colour's triangle.
 */
export function getTokenViews(state: GameState): PresentedToken[] {
  const views: PresentedToken[] = [];
  const groups = new Map<string, StackGroup>();

  for (const player of state.players) {
    const color = getPlayerBoardColor(player);

    player.tokens.forEach((token, tokenIndex) => {
      const entry: TokenEntry = { token, player };

      if (token.zone === "yard") {
        views.push({
          id: token.id,
          playerId: player.id,
          color,
          zone: token.zone,
          progress: null,
          anchor: getYardSlotAnchor(color, tokenIndex),
          radius: YARD_RADIUS,
        });
        return;
      }

      const progress = token.progress as number;

      if (progress <= 63) {
        const cell = squareToCell(progressToSquare(color, progress));
        addToGroup(
          groups,
          `track:${cell.square}`,
          {
            kind: "track",
            color,
            anchor: cell.center,
            axis: cell.side === "top" || cell.side === "bottom" ? "x" : "y",
          },
          entry,
        );
        return;
      }

      if (progress <= 70) {
        const corridor = getCorridorCells(color)[progress - 64];
        addToGroup(
          groups,
          `corridor:${player.id}:${progress}`,
          {
            kind: "corridor",
            color,
            anchor: corridor.center,
            axis: boundsAxis(corridor.points),
          },
          entry,
        );
        return;
      }

      addToGroup(
        groups,
        `goal:${player.id}`,
        {
          kind: "goal",
          color,
          anchor: getGoalTriangle(color).center,
          axis: "x",
        },
        entry,
      );
    });
  }

  for (const group of groups.values()) views.push(...presentGroup(group));

  return views;
}

/** Landing markers for the current player's legal moves, de-duplicated. */
export function getDestinationViews(
  state: GameState,
  moves: readonly (Move | BonusMove)[],
): PresentedDestination[] {
  const player = state.players[state.currentPlayerIndex];
  if (!player) return [];

  const color = getPlayerBoardColor(player);
  const seen = new Set<string>();
  const destinations: PresentedDestination[] = [];

  for (const move of moves) {
    const progress = move.to;

    if (!Number.isInteger(progress) || progress < 0 || progress > 71) continue;

    const key = `${color}:${progress}`;
    if (seen.has(key)) continue;
    seen.add(key);

    destinations.push({
      playerId: player.id,
      color,
      progress,
      anchor: getProgressAnchor(color, progress),
    });
  }

  return destinations;
}

/**
 * The two-dice views for the board. Every player keeps their latest pair on
 * the table. The active player's current roll exposes its used flags so the
 * engine's spent dice can be dimmed; before the first roll of their turn the
 * previous pair stays visible but marked as used.
 */
export function getDieViews(state: GameState): PresentedDie[] {
  const lastRolls = new Map<
    string,
    { dice: [DieValue, DieValue]; turn: number }
  >();

  for (const event of state.log) {
    if (event.type === "roll") {
      lastRolls.set(event.playerId, { dice: event.dice, turn: event.turn });
    }
  }

  const currentId =
    state.phase === "finished"
      ? null
      : (state.players[state.currentPlayerIndex]?.id ?? null);

  return state.players.map((player) => {
    const active = player.id === currentId;
    const current = active ? state.dice : null;
    const last = lastRolls.get(player.id);

    if (current) {
      return {
        playerId: player.id,
        color: getPlayerBoardColor(player),
        values: [current[0].value, current[1].value],
        used: [current[0].used, current[1].used],
        active,
      };
    }

    // A fresh turn starts with blank dice; an extra roll keeps the same turn
    // number and therefore keeps the pending double visible.
    const visible =
      active && state.phase === "awaiting-roll"
        ? last && last.turn === state.turn
          ? last.dice
          : null
        : (last?.dice ?? null);

    return {
      playerId: player.id,
      color: getPlayerBoardColor(player),
      values: visible ? [visible[0], visible[1]] : [null, null],
      used: active
        ? [false, false]
        : visible
          ? [true, true]
          : [false, false],
      active,
    };
  });
}

/** Anchor as percentages of the square board canvas, for DOM overlays. */
export interface BoardPercentAnchor {
  readonly left: number;
  readonly top: number;
}

/**
 * Converts a board-unit anchor to CSS percentages of the rendered square. The
 * proportions come from the same frame layout the Pixi renderer uses, so a DOM
 * popover can sit exactly above a chip without measuring the canvas. When a
 * view colour is supplied, the anchor is rotated exactly like the Pixi play
 * area so DOM overlays stay above the chips in a player-relative view.
 */
export function getBoardAnchorPercent(
  anchor: BoardPoint,
  viewColor?: ParchisColor,
): BoardPercentAnchor {
  const layout = getBoardFrameLayout(100);
  const rotated = viewColor
    ? rotateUnitPoint(anchor, getBoardView(viewColor).rotation)
    : anchor;

  return {
    left: layout.playX + rotated.x * layout.unit,
    top: layout.playY + rotated.y * layout.unit,
  };
}

/**
 * Human-readable destination for a progress value, in Spanish. Passing the
 * viewer's colour prints the player-relative square number shown on the board
 * (the viewer's exit is always square 1).
 */
export function describeProgress(
  color: ParchisColor,
  progress: number,
  viewColor?: ParchisColor,
): string {
  if (progress === 71) return "la meta";
  if (progress >= 64) return `el pasillo ${progress - 63}/7`;

  const square = progressToSquare(color, progress);
  const displayed = viewColor
    ? getViewSquareNumber(viewColor, square)
    : square;

  return `la casilla ${displayed}`;
}
