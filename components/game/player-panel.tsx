import type { CSSProperties } from "react";
import { DrawablyBadge, DrawablyCard } from "drawably/react";
import { AvatarVisual } from "@/components/avatar-visual";
import { COLOR_NAMES } from "@/lib/parchis/board-geometry";
import type { GamePlayerProfile } from "./game-players";

export interface PlayerPanelProps {
  profile: GamePlayerProfile;
  active: boolean;
  winner: boolean;
  /** The bottom-left seat is the person using this device. */
  human: boolean;
  className?: string;
}

/** Compact profile card for one seat: avatar, name, colour, and badges. */
export function PlayerPanel({
  profile,
  active,
  winner,
  human,
  className,
}: PlayerPanelProps) {
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
      aria-label={`${profile.name}${human ? ", tú" : ""}, color ${COLOR_NAMES[profile.color]}${active ? ", en turno" : ""}${winner ? ", ganador" : ""}.`}
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
          <p className="text-[11px] capitalize leading-tight text-stone-600">
            {COLOR_NAMES[profile.color]}
            {human && <span className="normal-case"> · Tú</span>}
          </p>
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
