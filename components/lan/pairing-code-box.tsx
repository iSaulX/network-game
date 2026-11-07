"use client";

import { useState } from "react";
import { DrawablyButton, DrawablyTextarea } from "drawably/react";

export interface PairingCodeBoxProps {
  /** Every outgoing part; empty before one exists. Copied as one text block. */
  parts: readonly string[];
  label: string;
  onAddPart(part: string): void;
  /** Parts already gathered, joined by newlines. */
  gathered: readonly string[];
  missingCount: number;
  /** False on the guest before it has the offer, when pasting is all it can do. */
  showOutgoing?: boolean;
}

/**
 * Text fallback for both directions: copy every part at once, or paste/speak
 * one part at a time into the field below. Never hides the QR path.
 *
 * The whole code is copied as a single newline-separated block because a
 * multi-part offer is useless one part at a time: the receiving device only
 * negotiates once it holds every part.
 */
export function PairingCodeBox({
  parts,
  label,
  onAddPart,
  gathered,
  missingCount,
  showOutgoing = true,
}: PairingCodeBoxProps) {
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState<"idle" | "ok" | "error">("idle");

  const code = parts.length > 0 ? parts.join("\n") : null;

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied("ok");
      window.setTimeout(() => setCopied("idle"), 2000);
    } catch {
      setCopied("error");
    }
  };

  return (
    <div className="flex w-full flex-col gap-3">
      {showOutgoing && code !== null && (
        <div>
          <label
            htmlFor="pairing-code-out"
            className="mb-1.5 block text-sm font-medium text-stone-700"
          >
            {label}
          </label>
          <DrawablyTextarea
            id="pairing-code-out"
            value={code}
            readOnly
            rows={4}
            spellCheck={false}
            className="block w-full font-mono text-xs"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <DrawablyButton
              type="button"
              variant="outline"
              onClick={copy}
              className="select-none px-3 py-1.5 text-sm"
            >
              Copiar código
            </DrawablyButton>
            <p aria-live="polite" className="text-xs text-stone-500">
              {copied === "ok" && "Copiado."}
              {copied === "error" && "No se pudo copiar. Selecciona el texto."}
            </p>
          </div>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const clean = draft.trim();
          if (!clean) return;
          onAddPart(clean);
          setDraft("");
        }}
        className="flex flex-col gap-2"
      >
        <label
          htmlFor="pairing-code-in"
          className="block text-sm font-medium text-stone-700"
        >
          Pega el código del otro dispositivo
        </label>
        <DrawablyTextarea
          id="pairing-code-in"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          placeholder="PARCHIS-LAN-1.…"
          className="block w-full font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <DrawablyButton
            type="submit"
            variant="solid"
            className="select-none px-3 py-1.5 text-sm"
          >
            Añadir código
          </DrawablyButton>
          <p aria-live="polite" className="text-xs text-stone-500">
            {gathered.length === 0
              ? "Puedes pegar el código entero o una parte cada vez."
              : missingCount > 0
                ? `Faltan ${missingCount} ${missingCount === 1 ? "parte" : "partes"}.`
                : "Código completo. Ya puedes conectar."}
          </p>
        </div>
      </form>
    </div>
  );
}
