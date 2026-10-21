"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Popover } from "@heroui/react";
import {
  DrawablyBadge,
  DrawablyButton,
  DrawablyCard,
  DrawablyHighlight,
  DrawablyInput,
} from "drawably/react";
import { AvatarPfp } from "@/components/avatar-pfp";
import { AvatarVisual } from "@/components/avatar-visual";
import { DrawablyTriggerButton } from "@/components/drawably-trigger-button";

type Avatar = {
  label: string;
  accent: string;
  image: string;
};

const AVATARS: Avatar[] = [
  {
    label: "perro",
    image: "/pictures/dog.png",
    accent: "var(--parchis-blue)",
  },
  {
    label: "mono",
    image: "/pictures/monkey.png",
    accent: "var(--parchis-yellow)",
  },
  {
    label: "pollo",
    image: "/pictures/chicken.png",
    accent: "var(--parchis-red)",
  },
  {
    label: "cara",
    image: "/pictures/face.png",
    accent: "var(--parchis-green)",
  },
  {
    label: "pulpo",
    image: "/pictures/octupus.png",
    accent: "var(--parchis-red)",
  },
  {
    label: "abeja",
    image: "/pictures/bee.png",
    accent: "var(--parchis-yellow)",
  },
  {
    label: "unicornio",
    image: "/pictures/unicorn.png",
    accent: "var(--parchis-blue)",
  },
  {
    label: "popó",
    image: "/pictures/poop.png",
    accent: "var(--parchis-green)",
  },
];

const DEFAULT_NAMES = [
  "Mono Galáctico",
  "Waffle Interestelar",
  "Pirata de Sofá",
  "Dinosaurio Elegante",
  "Nube de Queso",
  "Gato Cósmico",
  "Tortilla Ninja",
  "Búho Turbio",
  "Pingüino Supremo",
  "Sandía Veloz",
  "Dragón de Barrio",
  "Pulpo Romántico",
  "Setas del Espacio",
  "Lobo de Oficina",
  "Plátano Cuántico",
  "Cactus Fashion",
  "Pato Misterioso",
  "Koala de Acero",
  "Zanahoria Estelar",
  "Yeti Dominguero",
] as const;

const ACCENT_DOTS = [
  "var(--parchis-red)",
  "var(--parchis-blue)",
  "var(--parchis-yellow)",
  "var(--parchis-green)",
];

const subscribeToNothing = () => () => {};

let generatedPlayerName: string | null = null;
let generatedAvatarIndex: number | null = null;

function getGeneratedPlayerName(): string {
  if (generatedPlayerName === null) {
    generatedPlayerName =
      DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)];
  }

  return generatedPlayerName;
}

function getGeneratedAvatarIndex(): number {
  if (generatedAvatarIndex === null) {
    generatedAvatarIndex = Math.floor(Math.random() * AVATARS.length);
  }

  return generatedAvatarIndex;
}

function getServerPlayerName(): string {
  return "";
}

function getServerAvatarIndex(): number {
  return 0;
}

export default function Home() {
  const [selectedAvatar, setSelectedAvatar] = useState<number | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [editedName, setEditedName] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const generatedName = useSyncExternalStore(
    subscribeToNothing,
    getGeneratedPlayerName,
    getServerPlayerName,
  );
  const defaultAvatarIndex = useSyncExternalStore(
    subscribeToNothing,
    getGeneratedAvatarIndex,
    getServerAvatarIndex,
  );

  const playerName = editedName ?? generatedName;
  const avatarIndex = selectedAvatar ?? defaultAvatarIndex;
  const avatar = AVATARS[avatarIndex];

  useEffect(() => {
    if (!avatarOpen) return;

    const restoreFocusOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      requestAnimationFrame(() => {
        triggerRef.current?.focus({ preventScroll: true });
      });
    };

    document.addEventListener("keydown", restoreFocusOnEscape);
    return () => document.removeEventListener("keydown", restoreFocusOnEscape);
  }, [avatarOpen]);

  function chooseAvatar(index: number) {
    setSelectedAvatar(index);
    setAvatarOpen(false);

    requestAnimationFrame(() => {
      triggerRef.current?.focus({ preventScroll: true });
    });
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-6 sm:px-6 lg:h-dvh lg:min-h-0 lg:overflow-hidden lg:py-0">
      <div className="w-full max-w-4xl">
        <header className="mb-4 flex flex-col items-center gap-2.5 text-center sm:mb-6">
          <DrawablyBadge
            stroke="var(--parchis-red)"
            className="px-2.5 py-1"
          >
            Parchís Stars
          </DrawablyBadge>

          <div className="flex items-center gap-2" aria-hidden="true">
            {ACCENT_DOTS.map((color) => (
              <span
                key={color}
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>

          <div className="flex items-center justify-center gap-3">
            <Image
              src="/icon.png"
              alt=""
              width={56}
              height={56}
              priority
              className="h-12 w-12 shrink-0 object-contain mix-blend-multiply sm:h-14 sm:w-14"
            />
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              <DrawablyHighlight fill="var(--parchis-yellow)" boil={0.18}>
                Parchís Stars
              </DrawablyHighlight>
            </h1>
          </div>

          <p className="max-w-2xl text-pretty text-sm leading-6 text-stone-600 sm:text-base">
            Elige tu avatar, consigue un código y llama a tus amigos a la mesa.
          </p>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <DrawablyCard
            role="region"
            aria-labelledby="profile-title"
            className="flex h-full flex-col rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6"
          >
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2
                id="profile-title"
                className="text-lg font-semibold tracking-tight sm:text-xl"
              >
                Tu perfil
              </h2>
              <p className="text-sm text-stone-500">
                Elige cómo te verán los demás.
              </p>
            </div>

            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-3">
              <AvatarPfp label={avatar.label} image={avatar.image} />

              <div className="w-full">
                <label
                  htmlFor="player-name"
                  className="mb-1.5 block text-sm font-medium text-stone-700"
                >
                  Tu nombre
                </label>
                <DrawablyInput
                  id="player-name"
                  value={playerName}
                  onChange={(event) => setEditedName(event.target.value)}
                  placeholder="Jugador"
                  maxLength={24}
                  autoComplete="name"
                  className="block w-full text-lg"
                />
              </div>
            </div>

            <div className="pt-4">
              <Popover.Root isOpen={avatarOpen} onOpenChange={setAvatarOpen}>
                <Popover.Trigger<"button">
                  render={({ ref, className: heroClassName, ...props }) => (
                    <DrawablyTriggerButton
                      {...props}
                      ref={ref}
                      onNode={(node) => {
                        triggerRef.current = node;
                      }}
                      aria-haspopup="dialog"
                      aria-label={`Cambiar avatar. Avatar actual: ${avatar.label}`}
                      className={`${heroClassName ?? ""} flex w-full select-none items-center justify-center gap-2 px-4 py-2.5`}
                    >
                      <span>Cambiar avatar</span>
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
                      Elige tu avatar
                    </Popover.Heading>

                    <div className="grid grid-cols-4 gap-2">
                      {AVATARS.map((option, index) => {
                        const isSelected = index === avatarIndex;

                        return (
                          <DrawablyButton
                            key={option.label}
                            type="button"
                            variant={isSelected ? "solid" : "outline"}
                            fill={isSelected ? option.accent : undefined}
                            aria-label={`Elegir avatar ${option.label}`}
                            aria-pressed={isSelected}
                            onClick={() => chooseAvatar(index)}
                            className="flex h-14 w-full select-none items-center justify-center p-1 text-2xl"
                          >
                            <AvatarVisual
                              image={option.image}
                              size="sm"
                            />
                          </DrawablyButton>
                        );
                      })}
                    </div>
                  </Popover.Dialog>
                </Popover.Content>
              </Popover.Root>
            </div>
          </DrawablyCard>

          <div className="grid gap-4 lg:grid-rows-2">
            <DrawablyCard
              role="region"
              aria-labelledby="join-title"
              className="flex h-full flex-col rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6"
            >
              <h2
                id="join-title"
                className="mb-3 text-lg font-semibold tracking-tight sm:text-xl"
              >
                Unirse a una partida
              </h2>

              <label
                htmlFor="party-code"
                className="mb-1.5 block text-sm font-medium text-stone-700"
              >
                Código de partida
              </label>
              <DrawablyInput
                id="party-code"
                placeholder="ABC123"
                maxLength={6}
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                aria-describedby="party-code-help"
                className="block w-full text-lg uppercase tracking-[0.28em]"
              />

              <div className="mt-auto pt-3">
                <DrawablyButton
                  variant="solid"
                  className="w-full select-none px-6 py-2.5"
                >
                  Unirse a la partida
                </DrawablyButton>

                <p id="party-code-help" className="mt-2 text-sm text-stone-500">
                  Pídele el código al anfitrión.
                </p>
              </div>
            </DrawablyCard>

            <DrawablyCard
              role="region"
              aria-labelledby="create-title"
              className="flex h-full flex-col rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6"
            >
              <h2
                id="create-title"
                className="mb-3 text-lg font-semibold tracking-tight sm:text-xl"
              >
                Crear una partida
              </h2>

              <p className="text-sm leading-6 text-stone-600">
                Abre una mesa y comparte el código con tus amigos.
              </p>

              <div className="mt-auto pt-4">
                <DrawablyButton
                  variant="outline"
                  stroke="var(--parchis-green)"
                  className="w-full select-none px-6 py-3 text-base font-medium"
                >
                  Crear una partida
                </DrawablyButton>
              </div>
            </DrawablyCard>
          </div>
        </div>

        <p className="mt-4 text-center text-xs tracking-wide text-stone-500">
          Hecho a mano. Jugado entre amigos.
        </p>
      </div>
    </main>
  );
}
