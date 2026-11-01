"use client";

import {
  DrawablyBadge,
  DrawablyButton,
  DrawablyCard,
  DrawablyHighlight,
} from "drawably/react";

export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-6">
      <DrawablyCard className="w-full max-w-md rounded-xl bg-[var(--drawably-paper)] p-6 text-center sm:p-8">
        <DrawablyBadge stroke="var(--parchis-red)" className="px-2.5 py-1">
          Parchís Stars
        </DrawablyBadge>

        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          <DrawablyHighlight fill="var(--parchis-yellow)" boil={0.18}>
            Sin conexión
          </DrawablyHighlight>
        </h1>

        <p className="mt-4 text-base leading-7 text-stone-700">
          No hay conexión a internet.
        </p>
        <p className="mt-1 text-sm leading-6 text-stone-500">
          Puedes seguir jugando contra los bots sin conexión. Las partidas en
          línea necesitan red.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <DrawablyButton
            type="button"
            variant="solid"
            onClick={() => window.location.reload()}
            className="w-full select-none px-6 py-2.5"
          >
            Reintentar
          </DrawablyButton>

          {/* Offline local mode entry point (the game itself runs in PixiJS). */}
          <form action="/alone" method="get">
            <DrawablyButton
              type="submit"
              variant="outline"
              stroke="var(--parchis-green)"
              className="w-full select-none px-6 py-2.5"
            >
              Jugar sin conexión
            </DrawablyButton>
          </form>
        </div>

        <p className="mt-5 text-xs leading-5 text-stone-500">
          Vuelve a conectarte para crear o unirte a una partida con amigos.
        </p>
      </DrawablyCard>
    </main>
  );
}
