"use client";

import { useEffect, useRef, useState } from "react";
import type { Application } from "pixi.js";
import { COLOR_NAMES, type ParchisColor } from "@/lib/parchis/board-geometry";
import { drawBoard, type PixiModule } from "./board-drawing";

export interface ParchisBoardProps {
  className?: string;
  /** The colour whose home is shown in the bottom-left corner. */
  playerColor?: ParchisColor;
}

/**
 * PixiJS layer for the game board. The canvas is the only thing this component
 * owns; page chrome and controls stay in React/drawably outside it.
 */
export function ParchisBoard({
  className,
  playerColor = "green",
}: ParchisBoardProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const pixiRef = useRef<PixiModule | null>(null);
  const fontFamilyRef = useRef("sans-serif");
  const playerColorRef = useRef<ParchisColor>(playerColor);
  const redrawRef = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let app: Application | null = null;
    let animationFrame = 0;

    const render = () => {
      animationFrame = 0;
      const pixi = pixiRef.current;
      const currentApp = appRef.current;
      if (!pixi || !currentApp) return;

      const size = Math.round(
        Math.min(host.clientWidth, host.clientHeight),
      );
      if (size < 24) return;

      currentApp.renderer.resize(size, size);
      drawBoard(pixi, currentApp.stage, {
        width: size,
        height: size,
        fontFamily: fontFamilyRef.current,
        playerColor: playerColorRef.current,
      });
    };

    redrawRef.current = render;

    const scheduleRender = () => {
      if (animationFrame) return;
      animationFrame = requestAnimationFrame(render);
    };

    const start = async () => {
      const PIXI = await import("pixi.js");
      if (cancelled) return;

      try {
        await document.fonts.ready;
      } catch {
        // Font loading is best-effort; the fallback family still works.
      }
      if (cancelled) return;

      const size = Math.max(
        24,
        Math.round(Math.min(host.clientWidth, host.clientHeight)),
      );
      const instance = new PIXI.Application();
      await instance.init({
        width: size,
        height: size,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      });

      if (cancelled) {
        instance.destroy(true, { children: true });
        return;
      }

      app = instance;
      appRef.current = instance;
      pixiRef.current = PIXI;
      fontFamilyRef.current =
        getComputedStyle(document.body).fontFamily || "sans-serif";

      instance.canvas.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;display:block;";
      host.appendChild(instance.canvas);

      render();
      setReady(true);

      observer = new ResizeObserver(scheduleRender);
      observer.observe(host);
    };

    void start();

    return () => {
      cancelled = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      observer = null;
      app?.destroy(true, { children: true });
      app = null;
      appRef.current = null;
      pixiRef.current = null;
      redrawRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    playerColorRef.current = playerColor;
    redrawRef.current();
  }, [playerColor]);

  return (
    <div
      className={`relative aspect-square w-full ${className ?? ""}`}
      role="img"
      aria-label={`Tablero de Parchís orientado para el jugador ${COLOR_NAMES[playerColor]}. Tu casa queda en la esquina inferior izquierda y la casilla 1 es tu salida.`}
      aria-busy={!ready}
    >
      <div ref={hostRef} className="absolute inset-0" aria-hidden="true" />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center">
          <p className="rounded-xl bg-[var(--drawably-paper)] px-4 py-2 text-sm text-stone-500 shadow-sm">
            Preparando el tablero…
          </p>
        </div>
      )}
    </div>
  );
}
