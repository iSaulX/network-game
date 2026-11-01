"use client";

import { useEffect, useRef, useState } from "react";
import type { Application, Texture } from "pixi.js";
import {
  COLORS,
  getBoardFrameLayout,
  type ParchisColor,
} from "@/lib/parchis/board-geometry";
import {
  getDestinationViews,
  getTokenViews,
} from "@/lib/parchis/presentation";
import { getLegalBonusMoves, getLegalMoves } from "@/lib/parchis/rules";
import type { GameState } from "@/lib/parchis/types";
import {
  drawBoard,
  drawGameLayers,
  type BoardScene,
  type PixiModule,
  type TokenDrawTarget,
  type TokenTextures,
} from "./board-drawing";

/** Transparent, 256 px versions of the chip artwork in `/public/chips/tokens`. */
const TOKEN_TEXTURE_URL = (color: ParchisColor) => `/chips/tokens/${color}.png`;

export interface ParchisBoardProps {
  className?: string;
  state: GameState;
  /** Colour whose home is at the bottom-left; numbers start at its exit. */
  viewColor: ParchisColor;
  /** Only this player's legal chips are pointer-selectable. */
  humanPlayerId: string;
  /** False during auto-play: the human's chips are not tappable. */
  humanControlled?: boolean;
  /** Reports a tap on a legal human chip; the page opens its move popover. */
  onTokenSelect: (tokenId: string) => void;
}

/**
 * PixiJS layer for the playable board. React owns the engine state and the
 * surrounding app UI; this component draws the board, chips and legal-move
 * markers, interpolates chip movement, and reports taps through the callback.
 */
export function ParchisBoard({
  className,
  state,
  viewColor,
  humanPlayerId,
  humanControlled = true,
  onTokenSelect,
}: ParchisBoardProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const pixiRef = useRef<PixiModule | null>(null);
  const sceneRef = useRef<BoardScene | null>(null);
  const tokenTexturesRef = useRef<TokenTextures>({});
  const fontFamilyRef = useRef("sans-serif");
  const stateRef = useRef<GameState>(state);
  const viewColorRef = useRef<ParchisColor>(viewColor);
  const humanPlayerIdRef = useRef(humanPlayerId);
  const humanControlledRef = useRef(humanControlled);
  const onTokenSelectRef = useRef(onTokenSelect);
  const redrawRef = useRef<(full?: boolean) => void>(() => {});
  const tokenPositionsRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  const tokenAnimationFrameRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    stateRef.current = state;
    redrawRef.current();
  }, [state]);

  useEffect(() => {
    viewColorRef.current = viewColor;
    redrawRef.current(true);
  }, [viewColor]);

  useEffect(() => {
    humanPlayerIdRef.current = humanPlayerId;
    redrawRef.current(true);
  }, [humanPlayerId]);

  useEffect(() => {
    humanControlledRef.current = humanControlled;
    redrawRef.current(true);
  }, [humanControlled]);

  useEffect(() => {
    onTokenSelectRef.current = onTokenSelect;
  }, [onTokenSelect]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const tokenPositions = tokenPositionsRef.current;
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let app: Application | null = null;
    let animationFrame = 0;
    let pendingFull = false;

    /**
     * Interpolates each chip from its last drawn position to the new anchor.
     * The positions map stores the last painted frame, so a move that arrives
     * mid-animation continues from where the chip actually is on screen.
     */
    const animateTokens = (targets: readonly TokenDrawTarget[]) => {
      const positions = tokenPositions;
      const reducedMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (reducedMotion) {
        for (const target of targets) {
          target.container.position.set(target.x, target.y);
          positions.set(target.id, { x: target.x, y: target.y });
        }
        return;
      }

      const animations: Array<{
        target: TokenDrawTarget;
        from: { x: number; y: number };
      }> = [];

      for (const target of targets) {
        const previous = positions.get(target.id);
        const moved =
          previous !== undefined &&
          Math.hypot(target.x - previous.x, target.y - previous.y) > 0.5;

        if (previous && moved) {
          target.container.position.set(previous.x, previous.y);
          animations.push({ target, from: previous });
        } else {
          target.container.position.set(target.x, target.y);
          positions.set(target.id, { x: target.x, y: target.y });
        }
      }

      if (animations.length === 0) return;

      const startedAt = performance.now();
      const duration = 380;

      const step = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - (1 - progress) ** 3;

        for (const animation of animations) {
          const x =
            animation.from.x +
            (animation.target.x - animation.from.x) * eased;
          const y =
            animation.from.y +
            (animation.target.y - animation.from.y) * eased;

          animation.target.container.position.set(x, y);
          positions.set(animation.target.id, { x, y });
        }

        if (progress < 1) {
          tokenAnimationFrameRef.current = requestAnimationFrame(step);
        } else {
          tokenAnimationFrameRef.current = null;
        }
      };

      tokenAnimationFrameRef.current = requestAnimationFrame(step);
    };

    const render = (full: boolean) => {
      const pixi = pixiRef.current;
      const currentApp = appRef.current;
      if (!pixi || !currentApp) return;

      if (tokenAnimationFrameRef.current !== null) {
        cancelAnimationFrame(tokenAnimationFrameRef.current);
        tokenAnimationFrameRef.current = null;
      }

      const size = Math.round(
        Math.min(host.clientWidth, host.clientHeight),
      );
      if (size < 24) return;

      currentApp.renderer.resize(size, size);

      const frame = getBoardFrameLayout(size);
      const scene = sceneRef.current;
      const currentViewColor = viewColorRef.current;
      const needsStatic =
        full ||
        !scene ||
        Math.abs(scene.playSize - frame.playSize) > 0.01 ||
        scene.viewColor !== currentViewColor;

      if (needsStatic) {
        tokenPositions.clear();
        sceneRef.current = drawBoard(pixi, currentApp.stage, {
          width: size,
          height: size,
          fontFamily: fontFamilyRef.current,
          viewColor: currentViewColor,
        });
      }

      const activeScene = sceneRef.current;
      if (!activeScene) return;

      const gameState = stateRef.current;
      const moves =
        gameState.phase === "awaiting-move"
          ? getLegalMoves(gameState)
          : gameState.phase === "awaiting-bonus"
            ? getLegalBonusMoves(gameState)
            : [];

      const currentPlayerId =
        gameState.players[gameState.currentPlayerIndex]?.id;
      const selectableTokenIds =
        humanControlledRef.current &&
        currentPlayerId === humanPlayerIdRef.current
          ? moves.map((move) => move.tokenId)
          : [];

      const targets = drawGameLayers(
        pixi,
        activeScene,
        {
          tokens: getTokenViews(gameState),
          destinations: getDestinationViews(gameState, moves),
          selectableTokenIds,
          onTokenTap: (tokenId) => onTokenSelectRef.current(tokenId),
        },
        {
          tokens: tokenTexturesRef.current,
        },
      );

      animateTokens(targets);
    };

    const schedule = (full: boolean) => {
      pendingFull = pendingFull || full;
      if (animationFrame) return;

      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        const fullNow = pendingFull;
        pendingFull = false;
        render(fullNow);
      });
    };

    redrawRef.current = (full = false) => schedule(full);

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
        "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:manipulation;";
      host.appendChild(instance.canvas);

      render(true);
      setReady(true);

      observer = new ResizeObserver(() => schedule(true));
      observer.observe(host);

      const loadTextures = async () => {
        const entries = await Promise.all(
          COLORS.map(async (color) => {
            const texture = await PIXI.Assets.load<Texture>(
              TOKEN_TEXTURE_URL(color),
            );
            return [color, texture] as const;
          }),
        );

        return Object.fromEntries(entries) as Record<ParchisColor, Texture>;
      };

      void loadTextures()
        .then((textures) => {
          if (cancelled) return;
          tokenTexturesRef.current = textures;
          schedule(false);
        })
        .catch((error: unknown) => {
          console.warn("No se pudieron cargar las fichas del tablero.", error);
        });
    };

    void start();

    return () => {
      cancelled = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (tokenAnimationFrameRef.current !== null) {
        cancelAnimationFrame(tokenAnimationFrameRef.current);
        tokenAnimationFrameRef.current = null;
      }
      tokenPositions.clear();
      observer?.disconnect();
      observer = null;
      app?.destroy(true, { children: true });
      app = null;
      appRef.current = null;
      pixiRef.current = null;
      sceneRef.current = null;
      redrawRef.current = () => {};
    };
  }, []);

  return (
    <div
      className={`relative aspect-square w-full ${className ?? ""}`}
      role="img"
      aria-label="Tablero de Parchís clásico con las cuatro casas, los números desde tu salida y las fichas."
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
