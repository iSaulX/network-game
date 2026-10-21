"use client";

import { DrawablyCircle } from "drawably/react";
import { AvatarVisual } from "@/components/avatar-visual";

type AvatarPfpProps = {
  label: string;
  image: string;
};

export function AvatarPfp({ label, image }: AvatarPfpProps) {
  return (
    <div className="flex flex-col items-center gap-10">
      <DrawablyCircle
        key={image}
        aria-hidden="true"
        className="inline-flex h-32 w-32 items-center justify-center overflow-visible sm:h-36 sm:w-36"
      >
        <AvatarVisual image={image} size="lg" priority />
      </DrawablyCircle>
      <p className="text-sm font-medium capitalize text-stone-600">{label}</p>
    </div>
  );
}
