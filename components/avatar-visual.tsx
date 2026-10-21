"use client";

import Image from "next/image";
import { useState } from "react";

type AvatarVisualProps = {
  image: string;
  size: "sm" | "lg";
  priority?: boolean;
};

export function AvatarVisual({
  image,
  size,
  priority = false,
}: AvatarVisualProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const isLarge = size === "lg";

  if (!imageFailed) {
    return (
      <Image
        src={image}
        alt=""
        width={isLarge ? 144 : 40}
        height={isLarge ? 144 : 40}
        priority={priority}
        onError={() => setImageFailed(true)}
        className={
          isLarge
            ? "h-full w-full rounded-full object-cover"
            : "h-9 w-9 rounded-full object-cover"
        }
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={
        isLarge
          ? "flex h-full w-full items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] text-stone-500"
          : "flex h-9 w-9 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] text-stone-500"
      }
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isLarge ? "h-16 w-16" : "h-5 w-5"}
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </span>
  );
}
