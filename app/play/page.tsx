"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  DrawablyBadge,
  DrawablyButton,
  DrawablyHighlight,
} from "drawably/react";
import { ParchisBoard } from "@/components/game/parchis-board";
import {
  COLOR_NAMES,
  type ParchisColor,
} from "@/lib/parchis/board-geometry";

const PLAYER_COLORS: readonly ParchisColor[] = [
  "green",
  "yellow",
  "red",
  "blue",
];

const COLOR_SWATCH: Readonly<Record<ParchisColor, string>> = {
  green: "#6fab49",
  yellow: "#fde65b",
  red: "#e3422b",
  blue: "#0a84ae",
};

export default function PlayPage() {
  const router = useRouter();
  const [playerColor, setPlayerColor] = useState<ParchisColor>("green");
  const shouldRestoreFocusRef = useRef(false);

  useEffect(() => {
    if (!shouldRestoreFocusRef.current) return;

    shouldRestoreFocusRef.current = false;
    document
      .querySelector<HTMLButtonElement>(`[data-color="${playerColor}"]`)
      ?.focus({ preventScroll: true });
  }, [playerColor]);

  return (
    <main className="flex min-h-dvh flex-col px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Image
            src="/icon.png"
            alt=""
            width={48}
            height={48}
            priority
            className="h-11 w-11 object-contain mix-blend-multiply sm:h-12 sm:w-12"
          />
          <div>
            <DrawablyBadge
              stroke="var(--parchis-red)"
              className="px-2.5 py-0.5 text-xs"
            >
              Parchís Stars
            </DrawablyBadge>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              <DrawablyHighlight fill="var(--parchis-yellow)" boil={0.18}>
                Tablero de Parchís
              </DrawablyHighlight>
            </h1>
          </div>
        </div>

        <DrawablyButton
          type="button"
          variant="outline"
          onClick={() => router.push("/")}
          className="select-none px-4 py-2.5 text-sm"
        >
          Volver al inicio
        </DrawablyButton>
      </div>

      <div className="mx-auto mt-5 flex w-full max-w-6xl flex-1 flex-col items-center gap-3">
        <div className="flex w-full flex-col items-center gap-2 sm:w-auto sm:flex-row">
          <span id="color-label" className="text-sm font-medium text-stone-700">
            Juegas como
          </span>
          <div
            role="group"
            aria-labelledby="color-label"
            className="grid w-full max-w-[360px] grid-cols-2 gap-2 sm:flex sm:w-auto sm:max-w-none sm:flex-wrap sm:justify-center"
          >
            {PLAYER_COLORS.map((color) => {
              const active = color === playerColor;

              return (
                <DrawablyButton
                  key={`${color}-${active ? "active" : "idle"}`}
                  type="button"
                  variant={active ? "solid" : "outline"}
                  onClick={() => {
                    if (color === playerColor) return;
                    shouldRestoreFocusRef.current = true;
                    setPlayerColor(color);
                  }}
                  aria-pressed={active}
                  data-color={color}
                  className="w-full select-none px-3 py-1.5 text-sm sm:w-auto"
                >
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: COLOR_SWATCH[color] }}
                    />
                    <span className="capitalize">{COLOR_NAMES[color]}</span>
                  </span>
                </DrawablyButton>
              );
            })}
          </div>
        </div>

        <div className="w-full max-w-[860px] overflow-hidden rounded-2xl shadow-[0_18px_45px_rgba(55,32,16,0.28)]">
          <ParchisBoard playerColor={playerColor} />
        </div>
      </div>

      <p className="mx-auto mt-4 max-w-xl text-center text-xs leading-5 text-stone-600 sm:text-sm">
        Tu casa aparece siempre en la esquina inferior izquierda y la casilla 1
        es tu salida. El tablero gira y se numera según el color que elijas.
      </p>
    </main>
  );
}
