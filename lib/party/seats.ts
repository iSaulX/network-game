/**
 * Seat helpers for online party matches.
 *
 * A room always uses the same board colours: the host plays red, the guests
 * take yellow, blue and green. Missing seats are filled by bots when the host
 * starts, so a match can begin with any number of humans. Everything here is
 * pure and dependency-free; the engine-facing sessions must not import UI.
 */
import { BOARD_TO_ENGINE_COLOR } from "@/lib/parchis";
import type { ParchisColor } from "@/lib/parchis/board-geometry";
import type { Color, PlayerConfig } from "@/lib/parchis/types";
import {
  SEAT_BOARD_COLOR,
  type GameMode,
  type LanPlayerInfo,
  type LanRoster,
  type PlayerId,
} from "./protocol";

/** Board-colour turn order shared with the offline mode. */
export const PARTY_COLOR_ORDER: readonly ParchisColor[] = Object.freeze([
  "blue",
  "red",
  "yellow",
  "green",
]);

/** Stable seat order: host, then guests in join order. */
const ALL_SEATS: readonly PlayerId[] = Object.freeze([
  "host",
  "guest-1",
  "guest-2",
  "guest-3",
]);

/**
 * The two seats of a 1v1 sit on opposite corners, so the guest takes the
 * colour diagonal to the host instead of the adjacent yellow.
 */
const DUEL_SEATS: readonly PlayerId[] = Object.freeze(["host", "guest-1"]);

const BOT_INFO: Readonly<
  Record<"red" | "blue" | "yellow" | "green", LanPlayerInfo>
> = Object.freeze({
  red: { id: "bot-red", name: "Carla", avatar: "/pictures/chicken.png" },
  blue: { id: "bot-blue", name: "Bruno", avatar: "/pictures/octupus.png" },
  yellow: { id: "bot-yellow", name: "Diego", avatar: "/pictures/bee.png" },
  green: { id: "bot-green", name: "Ana", avatar: "/pictures/dog.png" },
});

function seatsFor(mode: GameMode): readonly PlayerId[] {
  return mode === "1v1" ? DUEL_SEATS : ALL_SEATS;
}

/** Board colour of one seat in a mode. */
export function seatBoardColor(
  mode: GameMode,
  id: string,
): ParchisColor | null {
  return boardColorOf(id, mode);
}

/** The board colours a mode seats, in fixed seat order. */
export function seatColors(mode: GameMode): readonly ParchisColor[] {
  return seatsFor(mode).map(
    (id) => seatBoardColor(mode, id) as ParchisColor,
  );
}

export function botForColor(color: ParchisColor): LanPlayerInfo {
  return BOT_INFO[color];
}

export function isBotPlayerId(id: string): boolean {
  return id.startsWith("bot-");
}

/** Seat ids a mode can leave unoccupied (never the host's own seat). */
export function seatIdsFor(mode: GameMode): readonly PlayerId[] {
  return seatsFor(mode);
}

/** Board colour of any seat id (human or bot) within a mode. */
export function boardColorOf(
  id: string,
  mode: GameMode = "all",
): ParchisColor | null {
  if (mode === "1v1") {
    if (id === "host" || id === "bot-red") {
      return "red";
    }
    if (id === "guest-1" || id === "bot-green") {
      return "green";
    }
    return null;
  }
  if (id in SEAT_BOARD_COLOR) {
    return SEAT_BOARD_COLOR[id as PlayerId] as ParchisColor;
  }
  return null;
}

/**
 * Completes the connected humans with bots for the mode's remaining seats and
 * returns the full roster, ordered by seat. Seats listed in `emptyIds` are
 * skipped entirely, so the match seats fewer players.
 */
export function buildRoster(
  mode: GameMode,
  humans: readonly LanPlayerInfo[],
  emptyIds: readonly string[] = [],
): LanRoster {
  const byId = new Map(humans.map((player) => [player.id, player] as const));
  const empty = new Set(emptyIds);

  const players: LanPlayerInfo[] = seatsFor(mode)
    .filter((id) => !empty.has(id))
    .map((id) => {
      const human = byId.get(id);
      if (human) {
        return { ...human, id };
      }
      return botForColor(seatBoardColor(mode, id) as ParchisColor);
    });

  // A room must always seat a second player for the engine to start.
  if (players.length < 2) {
    const missing = seatsFor(mode).find(
      (id) => !players.some((player) => player.id === id),
    );
    if (missing) {
      const human = byId.get(missing);
      players.push(
        human
          ? { ...human, id: missing }
          : botForColor(seatBoardColor(mode, missing) as ParchisColor),
      );
    }
  }

  return { players };
}

/**
 * Engine player configs, sorted by the shared board-colour turn order. The
 * room's mode decides the seat colours, because a two-player `all` room still
 * uses the four-seat colour map.
 */
export function buildConfigs(
  roster: LanRoster,
  mode: GameMode = "all",
): PlayerConfig[] {
  return [...roster.players]
    .sort(
      (a, b) =>
        PARTY_COLOR_ORDER.indexOf(boardColorOf(a.id, mode) ?? "red") -
        PARTY_COLOR_ORDER.indexOf(boardColorOf(b.id, mode) ?? "red"),
    )
    .map((player) => ({
      id: player.id,
      color: BOARD_TO_ENGINE_COLOR[
        boardColorOf(player.id, mode) ?? "red"
      ] as Color,
    }));
}

export function engineColorOf(
  playerId: string,
  mode: GameMode = "all",
): Color {
  return BOARD_TO_ENGINE_COLOR[boardColorOf(playerId, mode) ?? "red"];
}
