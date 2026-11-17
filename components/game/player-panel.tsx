import type { CSSProperties } from "react";
import { Chip } from "@heroui/react";
import { DrawablyBadge, DrawablyCard } from "drawably/react";
import { AvatarVisual } from "@/components/avatar-visual";
import { COLOR_NAMES } from "@/lib/parchis/board-geometry";
import { describeSeatConnection } from "@/lib/party/connection-copy";
import type { SeatConnection } from "@/lib/party/protocol";
import type { GamePlayerProfile } from "./game-players";

export interface PlayerPanelProps {
  profile: GamePlayerProfile;
  active: boolean;
  winner: boolean;
  /** The bottom-left seat is the person using this device. */
  human: boolean;
  /** With `!human`: the seat is another person over the network, not a bot. */
  remote?: boolean;
  /** The human's seat is currently played by the auto bot. */
  auto?: boolean;
  /** How this seat is connected (direct, STUN or TURN relay). */
  connection?: SeatConnection | null;
  className?: string;
}

/** Compact profile card for one seat: avatar, name, colour, and badges. */
export function PlayerPanel({
  profile,
  active,
  winner,
  human,
  remote = false,
  auto = false,
  connection = null,
  className,
}: PlayerPanelProps) {
  const role = human ? (auto ? "Tú (auto)" : "Tú") : remote ? "Rival" : "Bot";
  const connectionCopy = describeSeatConnection(connection);
  // Online rooms fill empty seats with `bot-*` players too, so the id is the
  // reliable signal even when the other seats are remote humans.
  const isBot = !human && profile.id.startsWith("bot-");
  const showsBotChip = isBot || (!human && !remote);
  const style = {
    "--drawably-stroke": profile.accent,
    background: active
      ? `color-mix(in srgb, ${profile.accent} 12%, var(--drawably-paper))`
      : undefined,
  } as CSSProperties;

  return (
    <DrawablyCard
      className={`select-none p-3 ${className ?? ""}`}
      style={style}
      aria-label={`${profile.name}${human ? (auto ? ", tú, modo automático" : ", tú") : remote ? ", rival" : ", bot"}, color ${COLOR_NAMES[profile.color]}${connectionCopy ? `, ${connectionCopy}` : ""}${active ? ", en turno" : ""}${winner ? ", ganador" : ""}.`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="shrink-0 rounded-full p-0.5"
          style={{ border: `2px solid ${profile.accent}` }}
        >
          <AvatarVisual image={profile.avatar} size="sm" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">
            {profile.name}
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <p className="text-[11px] capitalize leading-tight text-stone-600">
              {COLOR_NAMES[profile.color]}
            </p>
            {showsBotChip ? (
              <Chip
                size="sm"
                variant="soft"
                color="default"
                className="select-none px-1.5 py-0 text-[9px] leading-4"
              >
                Bot
              </Chip>
            ) : (
              <p className="text-[11px] leading-tight text-stone-600">
                · {role}
              </p>
            )}
          </div>
          {connectionCopy && (
            <p className="truncate text-[10px] leading-tight text-stone-500">
              {connectionCopy}
            </p>
          )}
        </div>

        {active && (
          <span className="hidden shrink-0 min-[480px]:inline-block">
            <DrawablyBadge
              variant="scribble"
              stroke={profile.accent}
              className="px-2 py-0.5 text-[10px]"
            >
              Turno
            </DrawablyBadge>
          </span>
        )}
        {winner && (
          <span className="hidden shrink-0 min-[480px]:inline-block">
            <DrawablyBadge
              variant="scribble"
              stroke={profile.accent}
              className="px-2 py-0.5 text-[10px]"
            >
              Gana
            </DrawablyBadge>
          </span>
        )}
      </div>
    </DrawablyCard>
  );
}
