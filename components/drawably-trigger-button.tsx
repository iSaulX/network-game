"use client";

import { forwardRef, useEffect, useRef } from "react";
import type { ComponentPropsWithoutRef } from "react";
import { drawablyButton } from "drawably";

export const DrawablyTriggerButton = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button"> & {
    onNode?: (node: HTMLButtonElement | null) => void;
  }
>(function DrawablyTriggerButton(
  { className, children, onNode, ...props },
  forwardedRef,
) {
  const localRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = localRef.current;
    if (!element) return;

    const sketch = drawablyButton(element, { variant: "outline" });

    return () => sketch.destroy();
  }, []);

  return (
    <button
      ref={(node) => {
        localRef.current = node;
        onNode?.(node);

        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      }}
      type="button"
      {...props}
      className={className}
    >
      {children}
    </button>
  );
});
