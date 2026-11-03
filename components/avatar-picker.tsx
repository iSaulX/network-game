"use client";

import { useEffect, useRef, useState } from "react";
import { Popover } from "@heroui/react";
import { DrawablyButton } from "drawably/react";
import { AvatarVisual } from "@/components/avatar-visual";
import { DrawablyTriggerButton } from "@/components/drawably-trigger-button";

export type AvatarPickerOption = {
  label: string;
  image: string;
  accent?: string;
};

type AvatarPickerProps = {
  options: readonly AvatarPickerOption[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** Fallback fill for options that do not define their own accent. */
  accent: string;
  triggerLabel?: string;
  heading?: string;
  className?: string;
};

/**
 * Shared HeroUI popover avatar dropdown. The trigger is a drawably button and
 * every option is a drawably button showing its circular PFP.
 */
export function AvatarPicker({
  options,
  selectedIndex,
  onSelect,
  accent,
  triggerLabel = "Cambiar avatar",
  heading = "Elige tu avatar",
  className,
}: AvatarPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = options[selectedIndex] ?? options[0];

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

  function choose(index: number) {
    onSelect(index);
    setOpen(false);

    requestAnimationFrame(() => {
      triggerRef.current?.focus({ preventScroll: true });
    });
  }

  return (
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
            aria-label={`${triggerLabel}. Avatar actual: ${current.label}`}
            className={`${heroClassName ?? ""} flex w-full select-none items-center justify-center gap-2 px-4 py-2.5 ${className ?? ""}`}
          >
            <span>{triggerLabel}</span>
          </DrawablyTriggerButton>
        )}
      />

      <Popover.Content
        placement="bottom"
        offset={8}
        className="w-72 max-w-[calc(100vw-3rem)] rounded-2xl bg-[var(--drawably-paper)] text-[var(--foreground)]"
      >
        <Popover.Arrow />

        <Popover.Dialog>
          <Popover.Heading className="mb-2 px-1 text-sm font-semibold text-stone-600">
            {heading}
          </Popover.Heading>

          <div className="grid grid-cols-4 gap-2">
            {options.map((option, index) => {
              const isSelected = index === selectedIndex;

              return (
                <DrawablyButton
                  key={option.image}
                  type="button"
                  variant={isSelected ? "solid" : "outline"}
                  fill={isSelected ? (option.accent ?? accent) : undefined}
                  aria-label={`Elegir avatar ${option.label}`}
                  aria-pressed={isSelected}
                  onClick={() => choose(index)}
                  className="flex h-14 w-full select-none items-center justify-center p-1 text-2xl"
                >
                  <AvatarVisual image={option.image} size="sm" />
                </DrawablyButton>
              );
            })}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover.Root>
  );
}
