/**
 * Presentation profiles for a party roster.
 *
 * The engine and the network only carry ids, names, avatars and colours; this
 * module maps a seat to the board profile `GameStage` renders (board colour,
 * engine colour and accent). Server-safe and UI-free so sessions never import
 * components.
 */
import { BOARD_TO_ENGINE_COLOR } from "@/lib/parchis";
import type { ParchisColor } from "@/lib/parchis/board-geometry";
import type { GameMode, LanRoster } from "@/lib/party/protocol";
import { boardColorOf, PARTY_COLOR_ORDER } from "@/lib/party/seats";
import {
  COLOR_ACCENT,
  type GamePlayerProfile,
} from "@/components/game/game-players";

/**
 * `mode` decides the seat colours: a 1v1 seats the host in red and the guest
 * on the opposite corner in green, while four-player rooms use yellow and
 * blue as well.
 */
export function partyProfiles(
  roster: LanRoster,
  mode: GameMode = roster.players.length === 2 ? "1v1" : "all",
): readonly GamePlayerProfile[] {
  return [...roster.players]
    .map((player) => {
      const color = (boardColorOf(player.id, mode) ?? "red") as ParchisColor;

      return {
        id: player.id,
        name: player.name,
        avatar: player.avatar,
        color,
        engineColor: BOARD_TO_ENGINE_COLOR[color],
        accent: COLOR_ACCENT[color],
      };
    })
    .sort(
      (a, b) =>
        PARTY_COLOR_ORDER.indexOf(a.color) -
        PARTY_COLOR_ORDER.indexOf(b.color),
    );
}
