"use client";

import Image from "next/image";
import { useState } from "react";
import {
  DrawablyBadge,
  DrawablyButton,
  DrawablyCard,
  DrawablyHighlight,
  DrawablyInput,
} from "drawably/react";
import { AvatarPicker } from "@/components/avatar-picker";
import { AvatarVisual } from "@/components/avatar-visual";
import { useGameFeedback } from "@/components/game/game-feedback";
import {
  AVATARS,
  BOARD_COLOR_ORDER,
  COLOR_ACCENT,
  getOppositeColor,
} from "@/components/game/game-players";
import {
  COLOR_NAMES,
  type ParchisColor,
} from "@/lib/parchis/board-geometry";

export default function AlonePage() {
  const feedback = useGameFeedback();
  const [name, setName] = useState("Jugador");
  const [color, setColor] = useState<ParchisColor>("blue");
  const [avatarIndex, setAvatarIndex] = useState(0);

  const avatar = AVATARS[avatarIndex];
  const accent = COLOR_ACCENT[color];
  const opponent = getOppositeColor(color);
  const otherColors = BOARD_COLOR_ORDER.filter((item) => item !== color);

  return (
    <main className="min-h-dvh px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
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
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                <DrawablyHighlight fill="var(--parchis-yellow)" boil={0.18}>
                  Jugar solo
                </DrawablyHighlight>
              </h1>
              <p className="mt-1 max-w-xl text-sm leading-6 text-stone-600">
                Elige tu ficha, tu nombre y tu foto. Después elige cómo quieres
                jugar contra los bots.
              </p>
            </div>
          </div>

          <form action="/" method="get">
            <DrawablyButton
              type="submit"
              variant="outline"
              onClick={() => feedback.tap()}
              className="select-none px-4 py-2.5 text-sm"
            >
              Volver al inicio
            </DrawablyButton>
          </form>
        </header>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <DrawablyCard className="p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold tracking-tight">
                Tu jugador
              </h2>
              <p className="text-xs text-stone-500">Así te verás en la mesa.</p>
            </div>

            <div className="mt-4 flex items-center gap-4">
              <span
                className="block h-24 w-24 shrink-0 overflow-hidden rounded-full border-4 bg-[var(--drawably-paper)]"
                style={{ borderColor: accent }}
              >
                <AvatarVisual image={avatar.image} size="lg" priority />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xl font-semibold">
                  {name.trim() || "Jugador"}
                </p>
                <p className="mt-0.5 text-sm capitalize text-stone-600">
                  {COLOR_NAMES[color]} · Tú
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  Avatar: {avatar.label}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <label
                htmlFor="alone-name"
                className="mb-1.5 block text-sm font-medium text-stone-700"
              >
                Tu nombre
              </label>
              <DrawablyInput
                id="alone-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Jugador"
                maxLength={24}
                autoComplete="name"
                className="block w-full text-lg"
              />
            </div>

            <fieldset className="mt-5">
              <legend className="mb-2 text-sm font-medium text-stone-700">
                Color de tu ficha
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {BOARD_COLOR_ORDER.map((option) => {
                  const selected = option === color;

                  return (
                    <DrawablyButton
                      key={option}
                      type="button"
                      variant="outline"
                      stroke={selected ? COLOR_ACCENT[option] : undefined}
                      aria-pressed={selected}
                      aria-label={`Elegir color ${COLOR_NAMES[option]}`}
                      onClick={() => {
                        if (option === color) return;
                        feedback.select();
                        setColor(option);
                      }}
                      className={`flex select-none items-center justify-center gap-1.5 px-2 py-2 text-xs ${selected ? "font-semibold" : ""}`}
                    >
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: COLOR_ACCENT[option] }}
                      />
                      {COLOR_NAMES[option]}
                      {selected && <span aria-hidden="true">✓</span>}
                    </DrawablyButton>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-5">
              <p className="mb-2 text-sm font-medium text-stone-700">
                Tu foto de perfil
              </p>
              <AvatarPicker
                options={AVATARS}
                selectedIndex={avatarIndex}
                onSelect={(index) => {
                  if (index === avatarIndex) return;
                  feedback.select();
                  setAvatarIndex(index);
                }}
                accent={accent}
              />
            </div>
          </DrawablyCard>

          <DrawablyCard className="select-none p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold tracking-tight">
                Modo de juego
              </h2>
              <p className="text-xs text-stone-500">
                Elige uno para empezar.
              </p>
            </div>

            <form
              action="/play"
              method="get"
              className="mt-4 grid gap-3 sm:grid-cols-2"
            >
              <input type="hidden" name="color" value={color} />
              <input type="hidden" name="avatar" value={avatar.image} />
              <input
                type="hidden"
                name="name"
                value={name.trim() || "Jugador"}
              />
              <DrawablyButton
                type="submit"
                name="mode"
                value="1v1"
                variant="outline"
                onClick={() => feedback.start()}
                aria-label={`Jugar 1 contra 1 contra el bot ${COLOR_NAMES[opponent]}`}
                className="flex h-full w-full select-none flex-col items-stretch gap-2 p-3 text-left transition-transform hover:-translate-y-0.5"
              >
                <Image
                  src="/modes/1vs1.png"
                  alt=""
                  width={1536}
                  height={1024}
                  loading="eager"
                  className="h-28 w-full object-contain mix-blend-multiply"
                />
                <span className="text-lg font-semibold">1 vs 1</span>
                <span className="text-xs leading-5 text-stone-600">
                  Tú contra un bot en la esquina opuesta. Rival:{" "}
                  {COLOR_NAMES[opponent]}.
                </span>
              </DrawablyButton>

              <DrawablyButton
                type="submit"
                name="mode"
                value="all"
                variant="outline"
                onClick={() => feedback.start()}
                aria-label="Jugar todos contra todos"
                className="flex h-full w-full select-none flex-col items-stretch gap-2 p-3 text-left transition-transform hover:-translate-y-0.5"
              >
                <Image
                  src="/modes/all-for-all.png"
                  alt=""
                  width={1536}
                  height={1024}
                  loading="eager"
                  className="h-28 w-full object-contain mix-blend-multiply"
                />
                <span className="text-lg font-semibold">
                  Todos contra todos
                </span>
                <span className="text-xs leading-5 text-stone-600">
                  Tú contra tres bots. Rivales:{" "}
                  {otherColors.map((item) => COLOR_NAMES[item]).join(", ")}.
                </span>
              </DrawablyButton>
            </form>
          </DrawablyCard>
        </div>
      </div>
    </main>
  );
}
