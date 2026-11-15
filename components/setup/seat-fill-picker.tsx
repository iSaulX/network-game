"use client";

import { useEffect, useRef, useState } from "react";
import { Popover } from "@heroui/react";
import { DrawablyButton } from "drawably/react";
import { DrawablyTriggerButton } from "@/components/drawably-trigger-button";
import { COLOR_ACCENT } from "@/components/game/game-players";
import { COLOR_NAMES, type ParchisColor } from "@/lib/parchis/board-geometry";

type SeatFillPickerProps = {
  /** Board colour of the seat this row configures. */
  color: ParchisColor;
  /** True when the seat stays unoccupied (no bot). */
  empty: boolean;
  /** False when the table already has the minimum of two seats. */
  canEmpty: boolean;
  onChange(empty: boolean): void;
  /** Row label; defaults to the colour name. */
  label?: string;
  /** Short trigger label for the lobby; defaults to "Con bot"/"Vacío". */
  compact?: boolean;
};

/**
 * One row of the "Huecos de la mesa" list. The trigger is a drawably button
 * that states the current choice; the HeroUI popover offers "Con bot" and
 * "Vacío" as drawably buttons.
 */
export function SeatFillPicker({
  color,
  empty,
  canEmpty,
  onChange,
  label,
  compact = false,
}: SeatFillPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const accent = COLOR_ACCENT[color];
  const currentLabel = empty ? "Vacío" : "Con bot";
  const rowLabel = label ?? COLOR_NAMES[color];

  useEffect(() => {
    if (!open) return;

    const restoreFocusOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      requestAnimationFrame(() => {
        triggerRef.current?.focus({ preventScroll: true });
      });
    };

    document.addEventListener("keydown", restoreFocusOnEscape);
    return () => document.removeEventListener("keydown", restoreFocusOnEscape);
  }, [open]);

  function choose(nextEmpty: boolean) {
    onChange(nextEmpty);
    setOpen(false);

    requestAnimationFrame(() => {
      triggerRef.current?.focus({ preventScroll: true });
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-stone-700">
        <span
          aria-hidden="true"
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <span className="truncate">{rowLabel}</span>
      </span>

      <Popover.Root isOpen={open} onOpenChange={setOpen}>
        <Popover.Trigger<"button">
          render={({ ref, className: heroClassName, ...props }) => (
            <DrawablyTriggerButton
              {...props}
              ref={ref}
              onNode={(node) => {
                triggerRef.current = node;
              }}
              aria-haspopup="dialog"
              aria-label={`${rowLabel}: ${currentLabel}. Cambiar ocupación del asiento`}
              className={`${heroClassName ?? ""} flex ${
                compact ? "w-28" : "w-36"
              } select-none items-center justify-center gap-1.5 px-3 py-1.5 text-xs`}
            >
              <span>{currentLabel}</span>
              <span aria-hidden="true" className="text-[9px]">
                ▾
              </span>
            </DrawablyTriggerButton>
          )}
        />

        <Popover.Content
          placement="bottom"
          offset={8}
          className="w-56 max-w-[calc(100vw-3rem)] rounded-2xl bg-[var(--drawably-paper)] text-[var(--foreground)]"
        >
          <Popover.Arrow />

          <Popover.Dialog>
            <Popover.Heading className="mb-2 px-1 text-sm font-semibold text-stone-600">
              Asiento {rowLabel}
            </Popover.Heading>

            <div className="flex flex-col gap-1.5">
              <DrawablyButton
                type="button"
                variant={empty ? "outline" : "solid"}
                fill={empty ? undefined : accent}
                aria-pressed={!empty}
                onClick={() => choose(false)}
                className="w-full select-none px-3 py-1.5 text-left text-xs"
              >
                Jugar con un bot
              </DrawablyButton>
              <DrawablyButton
                type="button"
                variant={empty ? "solid" : "outline"}
                stroke={accent}
                aria-pressed={empty}
                disabled={!canEmpty && !empty}
                onClick={() => choose(true)}
                className="w-full select-none px-3 py-1.5 text-left text-xs"
              >
                Dejarlo vacío
              </DrawablyButton>
            </div>

            {!canEmpty && !empty && (
              <p className="mt-2 px-1 text-[11px] leading-4 text-stone-500">
                Una partida necesita al menos un rival.
              </p>
            )}
          </Popover.Dialog>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}
