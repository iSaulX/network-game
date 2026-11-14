"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DrawablyButton } from "drawably/react";
import { TextMorph } from "torph/react";

/** How long the success state stays before returning to "Copiar código". */
const COPY_RESET_MS = 2400;

export interface RoomCodeProps {
  readonly code: string | null;
}

type CopyState = "idle" | "ok" | "error";

/**
 * Shows the six-character room code and copies it.
 *
 * While the server is still answering, a null code renders a pulsing skeleton
 * so the lobby feels like it is loading rather than broken. The copy button
 * morphs its own label ("Copiar código" → "Copiado") and swaps to a round
 * green check, so no separate status line is needed.
 */
export function RoomCode({ code }: RoomCodeProps) {
  const [copied, setCopied] = useState<CopyState>("idle");
  const resetRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetRef.current !== null) {
        window.clearTimeout(resetRef.current);
      }
    },
    [],
  );

  const copy = useCallback(async () => {
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      setCopied("ok");
    } catch {
      setCopied("error");
    }

    if (resetRef.current !== null) {
      window.clearTimeout(resetRef.current);
    }
    resetRef.current = window.setTimeout(() => {
      resetRef.current = null;
      setCopied("idle");
    }, COPY_RESET_MS);
  }, [code]);

  const ready = code !== null;
  const label =
    copied === "ok"
      ? "Copiado"
      : copied === "error"
        ? "No se pudo copiar"
        : "Copiar código";

  return (
    <div className="flex flex-col items-center gap-2">
      <p id="room-code" className="text-sm font-medium text-stone-700">
        Código de partida
      </p>

      <div className={`t-skel w-full ${ready ? "is-revealed" : ""}`}>
        <div
          className={`t-skel-skeleton ${
            ready ? "" : "is-pulsing"
          } flex items-center justify-center`}
          aria-hidden="true"
        >
          <span className="h-[1.9rem] w-44 rounded-md bg-stone-900/10 sm:h-[2.2rem] sm:w-52" />
        </div>

        <p
          aria-labelledby="room-code"
          className="t-skel-content text-center font-mono text-3xl font-semibold tracking-[0.35em] text-stone-900 sm:text-4xl"
        >
          {code ?? ""}
        </p>
      </div>

      <DrawablyButton
        type="button"
        variant="outline"
        disabled={!ready}
        onClick={copy}
        aria-label={ready ? label : "Código pendiente"}
        className="flex select-none items-center gap-2 px-3 py-1.5 text-sm"
      >
        <span className="t-icon-swap" data-state={copied === "ok" ? "b" : "a"}>
          <span className="t-icon" data-icon="a" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
              <rect
                x="8"
                y="8"
                width="12"
                height="12"
                rx="2.5"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M16 5.5A2.5 2.5 0 0013.5 3h-7A3.5 3.5 0 003 6.5v7A2.5 2.5 0 005.5 16"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="t-icon" data-icon="b" aria-hidden="true">
            <span className="t-success-check" data-state={copied === "ok" ? "in" : "out"}>
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="11"
                  fill="var(--parchis-green)"
                  stroke="var(--parchis-green)"
                  strokeWidth="1.5"
                />
                <path
                  d="M7.2 12.3l3.1 3.1 6.5-6.6"
                  stroke="#fbf6e8"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </span>
        </span>

        {/* torph swaps one span per character, so the button carries the
            accessible name and the live region announces the outcome. */}
        <TextMorph
          as="span"
          className="inline-block whitespace-nowrap"
          duration={260}
        >
          {label}
        </TextMorph>
      </DrawablyButton>

      <p aria-live="polite" className="text-xs text-stone-500">
        {copied === "error" ? (
          "Selecciona el texto y cópialo a mano."
        ) : (
          <span className="sr-only">
            {copied === "ok" ? "Código copiado." : ""}
          </span>
        )}
      </p>
    </div>
  );
}
