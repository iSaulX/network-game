import type { Color } from "@/lib/parchis/types";
import type { ParchisColor } from "@/lib/parchis/board-geometry";
import type { LanPlayerInfo, LanRoster } from "@/lib/party/protocol";
import {
  LAN_GUEST_ENGINE_COLOR,
  LAN_HOST_ENGINE_COLOR,
} from "@/lib/party/lan-colors";
import {
  COLOR_ACCENT,
  type GamePlayerProfile,
} from "@/components/game/game-players";

/** Fixed LAN seats: the host plays board red, the guest board yellow. */
export const LAN_HOST_COLOR: ParchisColor = "red";
export const LAN_GUEST_COLOR: ParchisColor = "yellow";

export const DEFAULT_HOST_INFO: LanPlayerInfo = Object.freeze({
  id: "host",
  name: "Anfitrión",
  avatar: "/pictures/dog.png",
});

export const DEFAULT_GUEST_INFO: LanPlayerInfo = Object.freeze({
  id: "guest",
  name: "Invitado",
  avatar: "/pictures/octupus.png",
});

export function createLanRoster(
  host: LanPlayerInfo,
  guest: LanPlayerInfo,
): LanRoster {
  return {
    host: { ...host, id: "host" },
    guest: { ...guest, id: "guest" },
  };
}

export function createLanProfiles(roster: LanRoster): GamePlayerProfile[] {
  return [
    {
      id: "host",
      name: roster.host.name,
      avatar: roster.host.avatar,
      color: LAN_HOST_COLOR,
      engineColor: LAN_HOST_ENGINE_COLOR,
      accent: COLOR_ACCENT[LAN_HOST_COLOR],
    },
    {
      id: "guest",
      name: roster.guest.name,
      avatar: roster.guest.avatar,
      color: LAN_GUEST_COLOR,
      engineColor: LAN_GUEST_ENGINE_COLOR,
      accent: COLOR_ACCENT[LAN_GUEST_COLOR],
    },
  ];
}

export function createLanConfigs(
  roster: LanRoster,
): { id: string; color: Color }[] {
  // The host is always red and the guest yellow, matching the roster profiles.
  return [
    { id: roster.host.id, color: LAN_HOST_ENGINE_COLOR },
    { id: roster.guest.id, color: LAN_GUEST_ENGINE_COLOR },
  ];
}
