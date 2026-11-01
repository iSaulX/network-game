import type { ParchisColor } from "@/lib/parchis/board-geometry";
import type { Color, PlayerConfig } from "@/lib/parchis/types";

/**
 * Temporary placeholder roster for local (pass-and-play) games. The seat order
 * follows the artwork's counter-clockwise numbering: green → blue → red →
 * yellow. Engine colours are the internal names that match that same order.
 */
export interface GamePlayerProfile {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly color: ParchisColor;
  readonly engineColor: Color;
  readonly accent: string;
}

/** The bottom-left seat belongs to the person using this device. */
export const HUMAN_PLAYER_ID = "bruno";

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

export const HUMAN_PROFILE: GamePlayerProfile =
  GAME_PLAYERS.find((player) => player.id === HUMAN_PLAYER_ID) ??
  GAME_PLAYERS[0];

/**
 * The human seat rolls first. The remaining seats keep their roster order;
 * the board's colours and the card corners are unaffected by turn order.
 */
export const GAME_PLAYER_CONFIGS: PlayerConfig[] = [
  HUMAN_PROFILE,
  ...GAME_PLAYERS.filter((player) => player.id !== HUMAN_PROFILE.id),
].map((player) => ({ id: player.id, color: player.engineColor }));

export function getPlayerProfile(id: string): GamePlayerProfile | undefined {
  return GAME_PLAYERS.find((player) => player.id === id);
}
