"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import {
  DrawablyBadge,
  DrawablyButton,
  DrawablyCard,
} from "drawably/react";
import {
  getViewSquareNumber,
  progressToSquare,
  type ParchisColor,
} from "@/lib/parchis/board-geometry";
import type { DieValue, GameState } from "@/lib/parchis/types";
import type { GamePlayerProfile } from "./game-players";

export interface DiceCardProps {
  state: GameState;
  profile: GamePlayerProfile;
  /** Square colour of the viewer; the exit is number 1. */
  viewColor: ParchisColor;
  values: readonly [DieValue | null, DieValue | null];
  used: readonly [boolean, boolean];
  active: boolean;
  human: boolean;
  rolling: boolean;
  rollingFaces: readonly [DieValue, DieValue] | null;
  onRoll: () => void;
  onChooseBarrier: (progress: number) => void;
}

function DieFace({
  value,
  used,
  active,
  rolling,
  delay,
  accent,
}: {
  value: DieValue | null;
  used: boolean;
  active: boolean;
  rolling: boolean;
  delay: number;
  accent: string;
}) {
  return (
    <span
      className={`relative block h-11 w-11 shrink-0 rounded-lg border-2 ${used ? "opacity-35" : ""} ${rolling ? "dice-rolling" : ""}`}
      style={{
        borderColor:
          active && !used
            ? accent
            : "color-mix(in srgb, var(--drawably-stroke) 32%, transparent)",
        background:
          value === null
            ? "color-mix(in srgb, var(--drawably-paper) 88%, transparent)"
            : undefined,
        animationDelay: rolling ? `${delay}ms` : undefined,
      }}
    >
      {value !== null && (
        <Image
          src={`/dices/faces/${value}.png`}
          alt=""
          width={44}
          height={44}
          className="h-full w-full rounded-md object-contain"
        />
      )}
    </span>
  );
}

/**
 * A dice-only tray for one seat. The active seat's card gets the colour
 * border and background; inactive trays are neutral. There is no idle copy:
 * the dice themselves are the roll control and the board glows for moves.
 * Barrier choices and the bonus badge appear only when that action is needed.
 */
export function DiceCard({
  state,
  profile,
  viewColor,
  values,
  used,
  active,
  human,
  rolling,
  rollingFaces,
  onRoll,
  onChooseBarrier,
}: DiceCardProps) {
  const visibleValues = rolling && rollingFaces ? rollingFaces : values;
  const visibleUsed = rolling ? ([false, false] as const) : used;
  const canRoll = active && state.phase === "awaiting-roll" && !rolling;

  const style = {
    "--drawably-stroke": active
      ? profile.accent
      : `color-mix(in srgb, ${profile.accent} 42%, #78716c)`,
    "--drawably-width": active ? "2.6" : "1.5",
    background: active
      ? `color-mix(in srgb, ${profile.accent} 8%, var(--drawably-paper))`
      : undefined,
  } as CSSProperties;

  const dice = (
    <div className="flex items-center justify-center gap-2">
      <DieFace
        value={visibleValues[0]}
        used={visibleUsed[0]}
        active={active}
        rolling={rolling}
        delay={0}
        accent={profile.accent}
      />
      <DieFace
        value={visibleValues[1]}
        used={visibleUsed[1]}
        active={active}
        rolling={rolling}
        delay={80}
        accent={profile.accent}
      />
    </div>
  );

  const ownerLabel = human ? "Tus dados" : `Dados de ${profile.name}`;
  const status = rolling
    ? "Tirando los dados."
    : active
      ? "Turno activo."
      : "Esperando turno.";

  return (
    <DrawablyCard
      className="mx-auto w-fit max-w-full select-none p-2"
      style={style}
      aria-label={`${ownerLabel}. ${status}`}
    >
      {canRoll ? (
        <button
          type="button"
          onClick={onRoll}
          aria-label={human ? "Tirar tus dados" : `Tirar los dados de ${profile.name}`}
          className="block w-full cursor-pointer select-none rounded-xl p-1 transition-transform hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-800"
        >
          {dice}
        </button>
      ) : (
        <div className={`rounded-xl p-1 ${active ? "" : "opacity-70"}`}>
          {dice}
        </div>
      )}

      {active &&
        state.phase === "awaiting-barrier" &&
        state.barrierChoice && (
          <div className="mt-1.5 flex flex-col gap-1">
            {state.barrierChoice.squares.map((progress) => {
              const square = getViewSquareNumber(
                viewColor,
                progressToSquare(profile.color, progress),
              );

              return (
                <DrawablyButton
                  key={progress}
                  type="button"
                  variant="outline"
                  onClick={() => onChooseBarrier(progress)}
                  className="w-full select-none px-2 py-1 text-left text-[10px]"
                >
                  Romper barrera · casilla {square}
                </DrawablyButton>
              );
            })}
          </div>
        )}

      {active && state.phase === "awaiting-bonus" && (
        <div className="mt-1 flex justify-center">
          <DrawablyBadge
            variant="scribble"
            stroke={profile.accent}
            className="px-1.5 py-0 text-[9px]"
          >
            Bono +{state.bonus?.kind === "capture-20" ? 20 : 10}
          </DrawablyBadge>
        </div>
      )}

      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
    </DrawablyCard>
  );
}
