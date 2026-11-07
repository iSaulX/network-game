"use client";

import Image from "next/image";
import { useEffect, useId, useRef } from "react";
import { DrawablyButton } from "drawably/react";
import { getGameResultSummary } from "./game-result";

export interface GameResultOverlayProps {
  humanWon: boolean;
  winnerName: string;
  /** Omit to hide the rematch button (a LAN guest cannot restart the match). */
  onPlayAgain?: () => void;
  onGoHome: () => void;
}

/**
 * Full-screen post-game result screen. It sits above the Pixi board, blurs the
 * game behind it, and traps focus between its two actions.
 */
export function GameResultOverlay({
  humanWon,
  winnerName,
  onPlayAgain,
  onGoHome,
}: GameResultOverlayProps) {
  const result = getGameResultSummary(humanWon, winnerName);
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );

    const first = focusable()[0];
    first?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }

      const items = focusable();

      if (items.length === 0) {
        return;
      }

      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;

      if (!dialog.contains(active)) {
        event.preventDefault();
        firstItem.focus();
        return;
      }

      if (event.shiftKey && active === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-game-result
      className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain text-[var(--drawably-paper)]"
      style={{
        backgroundColor: "rgba(18, 14, 10, 0.62)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-2 sm:px-6">
        <div className="flex flex-1 flex-col items-center justify-center gap-5 py-6 text-center">
          <Image
            src={result.image}
            alt={result.alt}
            width={1536}
            height={1024}
            priority
            sizes="(max-width: 768px) 92vw, 720px"
            className="h-auto w-auto max-h-[42vh] max-w-full rounded-[2rem] object-contain shadow-[0_24px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/10"
          />

          <div className="max-w-xl">
            <h2
              id={titleId}
              className="text-balance text-4xl font-semibold tracking-tight drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)] sm:text-5xl"
            >
              {result.title}
            </h2>
            <p
              id={descriptionId}
              className="mt-2 text-pretty text-base leading-7 text-stone-200 sm:text-lg"
            >
              {result.description}
            </p>
          </div>
        </div>

        <div className="mx-auto mt-auto flex w-full max-w-md flex-col gap-3 pb-2 sm:flex-row sm:justify-center sm:pb-4">
          {onPlayAgain && (
            <DrawablyButton
              type="button"
              variant="solid"
              onClick={() => onPlayAgain?.()}
              className="flex w-full select-none items-center justify-center gap-2.5 px-6 py-3 text-base font-medium sm:flex-1"
            >
              <Image
                src="/button-icons/new-game.png"
                alt=""
                width={1536}
                height={1024}
                sizes="32px"
                aria-hidden="true"
                className="h-8 w-8 shrink-0 object-cover invert"
              />
              <span>Jugar de nuevo</span>
            </DrawablyButton>
          )}

          <DrawablyButton
            type="button"
            variant="outline"
            stroke="var(--drawably-paper)"
            onClick={onGoHome}
            className="flex w-full select-none items-center justify-center gap-2.5 px-6 py-3 text-base font-medium text-[var(--drawably-paper)] sm:flex-1"
          >
            <Image
              src="/button-icons/house.png"
              alt=""
              width={1536}
              height={1024}
              sizes="32px"
              aria-hidden="true"
              className="h-8 w-8 shrink-0 object-cover invert"
            />
            <span>Volver al inicio</span>
          </DrawablyButton>
        </div>
      </div>
    </div>
  );
}
