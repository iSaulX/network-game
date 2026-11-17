import type { ReactNode } from "react";
import type {
  GameMode,
  LanPlayerInfo,
  SeatConnection,
} from "@/lib/party/protocol";
import { describeSeatConnection } from "@/lib/party/connection-copy";
import { boardColorOf } from "@/lib/party/seats";
import { AvatarVisual } from "@/components/avatar-visual";
import { COLOR_ACCENT } from "@/components/game/game-players";
import { seatLabel } from "@/lib/party/versus/lobby";

export interface LobbySeatProps {
  /** A connected human, or null for an empty seat filled by a bot on start. */
  readonly player: LanPlayerInfo | null;
  /** Seat id, used for the colour and the label. */
  readonly seatId: string;
  readonly isHost: boolean;
  /** The room's mode: a 1v1 seats the guest on the opposite corner. */
  readonly mode: GameMode;
  /** True when the host left this seat without a bot. */
  readonly empty?: boolean;
  /** How the seat's client is connected, when known. */
  readonly connection?: SeatConnection | null;
  /** Optional inline control (the host's bot/empty picker). */
  readonly action?: ReactNode;
}

/** One seat row in the lobby: avatar, name and role, with empty seats marked. */
export function LobbySeat({
  player,
  seatId,
  isHost,
  mode,
  empty = false,
  connection = null,
  action,
}: LobbySeatProps) {
  const boardColor = boardColorOf(seatId, mode) ?? "red";
  const accent = COLOR_ACCENT[boardColor];
  const connectionCopy = describeSeatConnection(connection);

  return (
    <li
      className="flex items-center gap-3 rounded-xl px-3 py-2.5"
      style={{
        background: player
          ? `color-mix(in srgb, ${accent} 9%, transparent)`
          : "transparent",
        border: `1.5px dashed ${
          player ? `color-mix(in srgb, ${accent} 55%, transparent)` : "#b9ad97"
        }`,
      }}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2"
        style={{ borderColor: accent, opacity: player ? 1 : 0.45 }}
      >
        {player ? (
          <AvatarVisual image={player.avatar} size="sm" />
        ) : (
          <span aria-hidden="true" className="text-lg text-stone-400">
            {empty ? "—" : "+"}
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">
          {player ? player.name : empty ? "Sin jugador" : "Asiento libre"}
        </p>
        <p className="text-[11px] leading-tight text-stone-600">
          {isHost ? "Anfitrión" : seatLabel(seatId)}
          {player
            ? ""
            : empty
              ? " · queda vacío en la partida"
              : " · lo ocupa un bot al empezar"}
        </p>
        {connectionCopy && (
          <p className="truncate text-[10px] leading-tight text-stone-500">
            {connectionCopy}
          </p>
        )}
      </div>

      {action ??
        (player ? (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: accent }}
          >
            Listo
          </span>
        ) : null)}
    </li>
  );
}
