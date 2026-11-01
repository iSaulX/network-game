import { BOARD_TO_ENGINE_COLOR } from "@/lib/parchis";
import type { ParchisColor } from "@/lib/parchis/board-geometry";
import type { Color, PlayerConfig } from "@/lib/parchis/types";

/**
 * Temporary bot roster. One profile per board colour; the human replaces the
 * profile of their chosen colour. Engine colours are the internal names that
 * match the two-dice engine's starts.
 */
export interface GamePlayerProfile {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly color: ParchisColor;
  readonly engineColor: Color;
  readonly accent: string;
}

export interface AvatarOption {
  readonly label: string;
  readonly image: string;
}

export type GameMode = "all" | "1v1";

export interface GameSettings {
  readonly mode: GameMode;
  readonly color: ParchisColor;
  readonly name: string;
  readonly avatar: string;
}

export interface GameSetup {
  readonly mode: GameMode;
  readonly human: GamePlayerProfile;
  readonly seats: readonly GamePlayerProfile[];
  readonly configs: PlayerConfig[];
}

export const GAME_PLAYERS: readonly GamePlayerProfile[] = Object.freeze([
  {
    id: "ana",
    name: "Ana",
    avatar: "/pictures/dog.png",
    color: "green",
    engineColor: "red",
    accent: "var(--parchis-green)",
  },
  {
    id: "bruno",
    name: "Bruno",
    avatar: "/pictures/octupus.png",
    color: "blue",
    engineColor: "blue",
    accent: "var(--parchis-blue)",
  },
  {
    id: "carla",
    name: "Carla",
    avatar: "/pictures/chicken.png",
    color: "red",
    engineColor: "yellow",
    accent: "var(--parchis-red)",
  },
  {
    id: "diego",
    name: "Diego",
    avatar: "/pictures/bee.png",
    color: "yellow",
    engineColor: "green",
    accent: "var(--parchis-yellow)",
  },
]);

/** The fixed board-colour turn order: blue → red → yellow → green. */
export const BOARD_COLOR_ORDER: readonly ParchisColor[] = Object.freeze([
  "blue",
  "red",
  "yellow",
  "green",
]);

/** Opposite-corner pairs used by 1 vs 1: blue/yellow and red/green. */
export const OPPOSITE_COLOR: Readonly<Record<ParchisColor, ParchisColor>> =
  Object.freeze({
    blue: "yellow",
    yellow: "blue",
    red: "green",
    green: "red",
  });

export const COLOR_ACCENT: Readonly<Record<ParchisColor, string>> =
  Object.freeze({
    green: "var(--parchis-green)",
    blue: "var(--parchis-blue)",
    red: "var(--parchis-red)",
    yellow: "var(--parchis-yellow)",
  });

export const AVATARS: readonly AvatarOption[] = Object.freeze([
  { label: "Perro", image: "/pictures/dog.png" },
  { label: "Mono", image: "/pictures/monkey.png" },
  { label: "Pollo", image: "/pictures/chicken.png" },
  { label: "Cara", image: "/pictures/face.png" },
  { label: "Pulpo", image: "/pictures/octupus.png" },
  { label: "Abeja", image: "/pictures/bee.png" },
  { label: "Unicornio", image: "/pictures/unicorn.png" },
  { label: "Popó", image: "/pictures/poop.png" },
]);

export const DEFAULT_GAME_SETTINGS: GameSettings = Object.freeze({
  mode: "all",
  color: "blue",
  name: "Bruno",
  avatar: "/pictures/octupus.png",
});

export function isParchisColor(value: string | null): value is ParchisColor {
  return (
    value === "red" ||
    value === "blue" ||
    value === "yellow" ||
    value === "green"
  );
}

export function getOppositeColor(color: ParchisColor): ParchisColor {
  return OPPOSITE_COLOR[color];
}

export interface SearchParamReader {
  get(name: string): string | null;
}

/** Validates URL settings; unknown values fall back to the defaults. */
export function getGameSettingsFromSearchParams(
  params: SearchParamReader,
): GameSettings {
  const mode: GameMode = params.get("mode") === "1v1" ? "1v1" : "all";
  const rawColor = params.get("color");
  const color = isParchisColor(rawColor)
    ? rawColor
    : DEFAULT_GAME_SETTINGS.color;
  const rawName = params.get("name")?.trim() ?? "";
  const name = rawName
    ? rawName.slice(0, 24)
    : DEFAULT_GAME_SETTINGS.name;
  const rawAvatar = params.get("avatar");
  const avatar =
    AVATARS.find((option) => option.image === rawAvatar)?.image ??
    DEFAULT_GAME_SETTINGS.avatar;

  return { mode, color, name, avatar };
}

/**
 * Builds the local roster for a chosen mode and colour. The human is a
 * synthetic profile with id `human`; the other colours use the placeholder
 * bot profiles. Seats are always sorted by the fixed colour order, so the
 * engine's turn order remains blue → red → yellow → green (filtered for 1v1).
 */
export function createGameSetup(settings: GameSettings): GameSetup {
  const name = settings.name.trim().slice(0, 24) || "Jugador";
  const avatar = AVATARS.some((option) => option.image === settings.avatar)
    ? settings.avatar
    : DEFAULT_GAME_SETTINGS.avatar;
  const human: GamePlayerProfile = {
    id: "human",
    name,
    avatar,
    color: settings.color,
    engineColor: BOARD_TO_ENGINE_COLOR[settings.color],
    accent: COLOR_ACCENT[settings.color],
  };

  const requiredColors =
    settings.mode === "1v1"
      ? [settings.color, OPPOSITE_COLOR[settings.color]]
      : [...BOARD_COLOR_ORDER];

  const seats = requiredColors
    .map((color) => {
      if (color === settings.color) return human;
      return GAME_PLAYERS.find((profile) => profile.color === color);
    })
    .filter((profile): profile is GamePlayerProfile => Boolean(profile))
    .sort(
      (a, b) =>
        BOARD_COLOR_ORDER.indexOf(a.color) -
        BOARD_COLOR_ORDER.indexOf(b.color),
    );

  return {
    mode: settings.mode,
    human,
    seats: Object.freeze(seats),
    configs: seats.map((profile) => ({
      id: profile.id,
      color: profile.engineColor,
    })),
  };
}
