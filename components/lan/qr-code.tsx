"use client";

import { QRCodeSVG } from "qrcode.react";
import { DrawablyButton } from "drawably/react";

export interface QrCodeProps {
  /** Current part text to encode. */
  value: string;
  index: number;
  total: number;
  onPrevious(): void;
  onNext(): void;
}

/**
 * One pairing part as a QR code plus previous/next controls. Long SDP offers
 * never fit one QR; each part gets its own screen and can be scanned in order.
 */
export function QrCode({
  value,
  index,
  total,
  onPrevious,
  onNext,
}: QrCodeProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-xl bg-white p-3 shadow-[0_10px_24px_rgba(45,28,12,0.18)]">
        <QRCodeSVG
          value={value}
          size={264}
          level="M"
          marginSize={1}
          title={`Código de conexión, parte ${index + 1} de ${total}`}
        />
      </div>

      {total > 1 && (
        <div className="flex items-center gap-3">
          <DrawablyButton
            type="button"
            variant="outline"
            onClick={onPrevious}
            disabled={index === 0}
            aria-label="Parte anterior del código"
            className="select-none px-3 py-1.5 text-sm"
          >
            Anterior
          </DrawablyButton>
          <p
            aria-live="polite"
            className="min-w-24 text-center text-sm text-stone-600"
          >
            Parte {index + 1} de {total}
          </p>
          <DrawablyButton
            type="button"
            variant="outline"
            onClick={onNext}
            disabled={index === total - 1}
            aria-label="Parte siguiente del código"
            className="select-none px-3 py-1.5 text-sm"
          >
            Siguiente
          </DrawablyButton>
        </div>
      )}
    </div>
  );
}
