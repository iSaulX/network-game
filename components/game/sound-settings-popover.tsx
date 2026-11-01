"use client";

import { useEffect, useRef } from "react";
import {
  DrawablyButton,
  DrawablyCard,
  DrawablyCheckbox,
  DrawablyDivider,
} from "drawably/react";
import {
  SOUND_CATEGORIES,
  SOUND_CATEGORY_LABELS,
  areAllSoundsMuted,
  type SoundCategory,
} from "./game-sound-settings";

export interface SoundSettingsPopoverProps {
  muted: Readonly<Record<SoundCategory, boolean>>;
  onToggle: (category: SoundCategory, muted: boolean) => void;
  onToggleAll: (muted: boolean) => void;
  onClose: () => void;
}

/**
 * Non-modal sound settings panel. Checked category boxes mean "mute this
 * sound"; the first control mutes every category. The backdrop, Escape and
 * the close button dismiss it.
 */
export function SoundSettingsPopover({
  muted,
  onToggle,
  onToggleAll,
  onClose,
}: SoundSettingsPopoverProps) {
  const allMuted = areAllSoundsMuted(muted);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Drawably checkboxes only sync their mask on a native change event. When
  // one checkbox updates the whole controlled group (master ↔ individual),
  // React changes `checked` without a native event, so mirror the state onto
  // each wrapper for the drawn checkmark.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const inputs = dialog.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    const checkedStates = [
      allMuted,
      ...SOUND_CATEGORIES.map((category) => muted[category]),
    ];

    inputs.forEach((input, index) => {
      const wrapper = input.parentElement;
      if (!wrapper) return;
      if (checkedStates[index]) {
        wrapper.dataset.checked = "";
      } else {
        delete wrapper.dataset.checked;
      }
    });
  }, [allMuted, muted]);

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Cerrar ajustes de sonido"
        onClick={onClose}
        className="fixed inset-0 z-50 cursor-default select-none bg-stone-950/10"
      />

      <div
        ref={dialogRef}
        id="sound-settings-dialog"
        data-sound-menu
        role="dialog"
        aria-labelledby="sound-settings-title"
        className="fixed left-1/2 top-20 z-[60] w-[min(92vw,24rem)] -translate-x-1/2"
      >
        <DrawablyCard
          className="max-h-[calc(100dvh-7rem)] overflow-hidden p-4 shadow-[0_18px_45px_rgba(45,28,12,0.28)]"
          style={{ background: "var(--drawably-paper)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2
                id="sound-settings-title"
                className="text-base font-semibold"
              >
                Ajustes de sonido
              </h2>
              <p className="mt-0.5 text-xs leading-5 text-stone-600">
                Marca los sonidos que quieras silenciar.
              </p>
            </div>
            <DrawablyButton
              type="button"
              variant="outline"
              onClick={onClose}
              aria-label="Cerrar ajustes de sonido"
              className="select-none px-2 py-0 text-sm"
            >
              ×
            </DrawablyButton>
          </div>

          <label className="mt-3 flex cursor-pointer select-none items-center gap-2 rounded-lg bg-stone-900/[0.04] px-2 py-2 text-sm font-medium">
            <DrawablyCheckbox
              checked={allMuted}
              onChange={(event) => onToggleAll(event.target.checked)}
              autoFocus
              className="shrink-0"
            />
            <span>Silenciar todos los sonidos</span>
          </label>

          <DrawablyDivider className="my-3" />

          <fieldset className="min-w-0 border-0 p-0">
            <legend className="sr-only">Sonidos individuales</legend>
            <div className="max-h-[min(52vh,22rem)] overflow-y-auto pr-1">
              <div className="grid gap-1">
                {SOUND_CATEGORIES.map((category) => (
                  <label
                    key={category}
                    className="flex cursor-pointer select-none items-center gap-2 rounded-md px-1 py-1 text-sm text-stone-700"
                  >
                    <DrawablyCheckbox
                      checked={muted[category]}
                      onChange={(event) =>
                        onToggle(category, event.target.checked)
                      }
                      className="shrink-0"
                    />
                    <span>{SOUND_CATEGORY_LABELS[category]}</span>
                  </label>
                ))}
              </div>
            </div>
          </fieldset>
        </DrawablyCard>
      </div>
    </>
  );
}
