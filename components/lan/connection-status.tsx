"use client";

import { DrawablyBadge } from "drawably/react";
import {
  describePairing,
  type PairingState,
} from "@/lib/party/webrtc/pairing";

export interface ConnectionStatusProps {
  pairing: PairingState;
}

const TONE_STROKE: Readonly<Record<"info" | "success" | "error", string>> =
  Object.freeze({
    info: "var(--parchis-blue)",
    success: "var(--parchis-green)",
    error: "var(--parchis-red)",
  });

/** The single line of pairing status: title, detail, and a colour-coded badge. */
export function ConnectionStatus({ pairing }: ConnectionStatusProps) {
  const described = describePairing(pairing);
  const attention =
    pairing.phase === "connecting"
      ? "Preparando"
      : described.tone === "success"
        ? "Conectado"
        : described.tone === "error"
          ? "Atención"
          : "Conexión";

  return (
    <div
      aria-live="polite"
      className="flex flex-col items-center gap-1.5 text-center"
    >
      <DrawablyBadge
        stroke={TONE_STROKE[described.tone]}
        className="px-2.5 py-0.5 text-[11px]"
      >
        {attention}
      </DrawablyBadge>
      <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
        {described.title}
      </h2>
      {described.detail && (
        <p className="max-w-md text-sm leading-6 text-stone-600">
          {described.detail}
        </p>
      )}
    </div>
  );
}
