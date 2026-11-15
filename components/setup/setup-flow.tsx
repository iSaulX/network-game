"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  DrawablyBadge,
  DrawablyButton,
  DrawablyCard,
  DrawablyDivider,
  DrawablyHighlight,
  DrawablyInput,
} from "drawably/react";
import { AvatarPicker } from "@/components/avatar-picker";
import { AvatarPfp } from "@/components/avatar-pfp";
import { useGameFeedback } from "@/components/game/game-feedback";
import { LobbySeat } from "@/components/party/lobby-seat";
import { PartyGameScreen } from "@/components/party/party-game-screen";
import {
  AVATARS,
  COLOR_ACCENT,
  type GameMode as OfflineGameMode,
} from "@/components/game/game-players";
import { usePartySession } from "@/lib/party/versus/use-party-session";
import {
  describeLobby,
  LOBBY_FAILURE_COPY,
} from "@/lib/party/versus/lobby";
import type { GameMode, PlayerId } from "@/lib/party/protocol";
import { COLOR_NAMES, type ParchisColor } from "@/lib/parchis/board-geometry";
import { getLanSupport, LAN_SUPPORT_COPY } from "@/lib/party/webrtc/support";
import { RoomCode } from "@/components/setup/room-code";
import { SeatFillPicker } from "@/components/setup/seat-fill-picker";

type Step = "home" | "create" | "join" | "lobby" | "game";
type Connection = "online" | "bots";

const PROFILE_KEY = "parchis.profile.v1";

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
] as const;

const ACCENT_DOTS = [
  "var(--parchis-red)",
  "var(--parchis-blue)",
  "var(--parchis-yellow)",
  "var(--parchis-green)",
];

const BOARD_COLORS: readonly ParchisColor[] = [
  "blue",
  "red",
  "yellow",
  "green",
];

/**
 * Initial name and avatar. Prerendering must not observe `Math.random()`, so
 * the random pick is cached behind `useSyncExternalStore`: the server value is
 * the placeholder, and the browser switches to the generated one on hydration.
 */
let generatedName: string | null = null;
let generatedAvatarIndex: number | null = null;

const subscribeToNothing = () => () => {};

function clientName(): string {
  generatedName ??= readSavedProfile()?.name ?? initialName();
  return generatedName;
}

function serverName(): string {
  return "";
}

function clientAvatarIndex(): number {
  if (generatedAvatarIndex === null) {
    const saved = readSavedProfile()?.avatar;
    const found = AVATARS.findIndex((option) => option.image === saved);
    generatedAvatarIndex = found === -1 ? initialAvatar() : found;
  }
  return generatedAvatarIndex;
}

function serverAvatarIndex(): number {
  return 0;
}

function initialName(): string {
  return DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)];
}

function initialAvatar(): number {
  return Math.floor(Math.random() * AVATARS.length);
}

/** Reads the saved profile once on mount; the app is client-rendered anyway. */
function readSavedProfile(): { name?: string; avatar?: string } | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { name?: unknown; avatar?: unknown };
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      avatar: typeof parsed.avatar === "string" ? parsed.avatar : undefined,
    };
  } catch {
    return null;
  }
}

function saveProfile(name: string, avatar: string): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, avatar }));
  } catch {
    // Storage may be unavailable; the profile then lasts for this page only.
  }
}

export function SetupFlow() {
  const router = useRouter();
  const feedback = useGameFeedback();
  const support = useMemo(() => getLanSupport(), []);

  const generatedName = useSyncExternalStore(
    subscribeToNothing,
    clientName,
    serverName,
  );
  const generatedAvatarIndex = useSyncExternalStore(
    subscribeToNothing,
    clientAvatarIndex,
    serverAvatarIndex,
  );

  const [editedName, setEditedName] = useState<string | null>(null);
  const [selectedAvatar, setSelectedAvatar] = useState<number | null>(null);
  const [offlineColor, setOfflineColor] = useState<ParchisColor>("blue");
  const [emptyColors, setEmptyColors] = useState<readonly ParchisColor[]>([]);

  const [step, setStep] = useState<Step>("home");
  const [connection, setConnection] = useState<Connection>("online");
  const [joinCode, setJoinCode] = useState("");

  const name = editedName ?? generatedName;
  const avatarIndex = selectedAvatar ?? generatedAvatarIndex;

  const avatar = AVATARS[avatarIndex]!;
  const playerName = name.trim().slice(0, 24) || "Jugador";

  const party = usePartySession(
    { name: playerName, avatar: avatar.image },
    feedback,
  );

  const rememberProfile = useCallback(
    (nextName: string, nextAvatar: string) => {
      saveProfile(nextName.trim().slice(0, 24) || "Jugador", nextAvatar);
    },
    [],
  );

  const goHome = useCallback(() => {
    setStep("home");
    setJoinCode("");
    party.abort();
  }, [party]);

  const openCreate = useCallback(() => {
    feedback.select();
    setStep("create");
  }, [feedback]);

  const openJoin = useCallback(() => {
    feedback.tap();
    setStep("join");
    party.openJoin();
  }, [feedback, party]);

  const chooseOfflineMode = useCallback(
    (mode: OfflineGameMode) => {
      feedback.start();
      rememberProfile(playerName, avatar.image);
      const params = new URLSearchParams({
        mode,
        color: offlineColor,
        name: playerName,
        avatar: avatar.image,
      });
      // A four-player table may leave colours unoccupied; a 1v1 never does.
      if (mode === "all") {
        const empties = emptyColors.filter((item) => item !== offlineColor);
        if (empties.length > 0) params.set("empty", empties.join(","));
      }
      router.push(`/play?${params.toString()}`);
    },
    [
      avatar.image,
      emptyColors,
      feedback,
      offlineColor,
      playerName,
      rememberProfile,
      router,
    ],
  );

  const chooseOnlineMode = useCallback(
    (mode: GameMode) => {
      rememberProfile(playerName, avatar.image);
      party.createGame(mode);
      setStep("lobby");
    },
    [avatar.image, party, playerName, rememberProfile],
  );

  const submitJoin = useCallback(() => {
    if (joinCode.length !== 6) return;
    rememberProfile(playerName, avatar.image);
    party.joinGame(joinCode);
    setStep("lobby");
  }, [avatar.image, joinCode, party, playerName, rememberProfile]);

  const leaveLobby = useCallback(() => {
    party.abort();
    setStep("home");
  }, [party]);

  const startOnline = useCallback(() => {
    party.startGame();
  }, [party]);

  // The session's state is the switch to the board; it does not need a step.
  if (party.session && party.snapshot?.state && party.snapshot.roster) {
    return (
      <PartyGameScreen
        key={party.session.playerId}
        session={party.session}
        snapshot={party.snapshot}
        viewerId={party.session.playerId}
        feedback={feedback}
        onLeave={goHome}
      />
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center px-4 py-6 sm:px-6">
      <div className="w-full max-w-4xl">
        <Header step={step} onHome={goHome} />

        {step === "home" && (
          <HomeStep
            name={name}
            onNameChange={setEditedName}
            avatarIndex={avatarIndex}
            onAvatarChange={setSelectedAvatar}
            onCreate={openCreate}
            onJoin={openJoin}
          />
        )}

        {step === "create" && (
          <CreateStep
            connection={connection}
            onConnection={setConnection}
            color={offlineColor}
            onColor={(next) => {
              setOfflineColor(next);
              // The chosen colour is always yours: it cannot stay marked empty.
              setEmptyColors((current) =>
                current.filter((item) => item !== next),
              );
            }}
            emptyColors={emptyColors}
            onToggleEmpty={(target, empty) =>
              setEmptyColors((current) =>
                empty
                  ? current.includes(target)
                    ? current
                    : [...current, target]
                  : current.filter((item) => item !== target),
              )
            }
            onlineSupported={support.ok}
            onlineUnavailableCopy={
              support.ok ? null : LAN_SUPPORT_COPY[support.reason]
            }
            onOfflineMode={chooseOfflineMode}
            onOnlineMode={chooseOnlineMode}
            onBack={goHome}
          />
        )}

        {step === "join" && (
          <JoinStep
            code={joinCode}
            onCode={setJoinCode}
            onSubmit={submitJoin}
            unavailableCopy={
              support.ok ? null : LAN_SUPPORT_COPY[support.reason]
            }
            failure={
              party.lobby.phase === "failed" && party.lobby.failure
                ? LOBBY_FAILURE_COPY[party.lobby.failure]
                : null
            }
            onBack={goHome}
          />
        )}

        {step === "lobby" && (
          <LobbyStep
            party={party}
            name={playerName}
            onStart={startOnline}
            onLeave={leaveLobby}
          />
        )}
      </div>
    </main>
  );
}

function Header({ step, onHome }: { step: Step; onHome(): void }) {
  const labels: Record<Step, string> = {
    home: "Inicio",
    create: "Crear partida",
    join: "Unirse",
    lobby: "Sala de espera",
    game: "Partida",
  };

  return (
    <header className="mb-5 flex flex-col items-center gap-2 text-center">
      <div className="flex items-center gap-2" aria-hidden="true">
        {ACCENT_DOTS.map((color) => (
          <span
            key={color}
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onHome}
        className="flex select-none items-center justify-center gap-3 rounded-xl"
        aria-label="Parchís Stars, volver al inicio"
      >
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
      </button>

      <DrawablyBadge
        stroke="var(--parchis-blue)"
        className="px-2.5 py-0.5 text-[11px]"
      >
        {labels[step]}
      </DrawablyBadge>
    </header>
  );
}

function HomeStep({
  name,
  onNameChange,
  avatarIndex,
  onAvatarChange,
  onCreate,
  onJoin,
}: {
  name: string;
  onNameChange(value: string): void;
  avatarIndex: number;
  onAvatarChange(index: number): void;
  onCreate(): void;
  onJoin(): void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <DrawablyCard className="flex h-full flex-col rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
            Tu perfil
          </h2>
          <p className="text-sm text-stone-500">Así te verán los demás.</p>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-3">
          <AvatarPfp label={AVATARS[avatarIndex]!.label} image={AVATARS[avatarIndex]!.image} />

          <div className="w-full">
            <label
              htmlFor="player-name"
              className="mb-1.5 block text-sm font-medium text-stone-700"
            >
              Tu nombre
            </label>
            <DrawablyInput
              id="player-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Jugador"
              maxLength={24}
              autoComplete="name"
              className="block w-full text-lg"
            />
          </div>
        </div>

        <div className="pt-4">
          <AvatarPicker
            options={AVATARS}
            selectedIndex={avatarIndex}
            onSelect={onAvatarChange}
            accent="var(--parchis-blue)"
          />
        </div>
      </DrawablyCard>

      <div className="grid content-start gap-4">
        <DrawablyCard className="flex flex-col rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6">
          <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
            Crear una partida
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Juega en línea contra otras personas o contra bots. Tú eliges el
            modo, la conexión y cuándo empieza la partida.
          </p>
          <div className="mt-4">
            <DrawablyButton
              type="button"
              variant="solid"
              stroke="var(--parchis-green)"
              onClick={onCreate}
              className="w-full select-none px-6 py-2.5"
            >
              Crear una partida
            </DrawablyButton>
          </div>
        </DrawablyCard>

        <DrawablyCard className="flex flex-col rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6">
          <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
            Unirse a una partida
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Pídele el código de 6 caracteres al anfitrión y entra en su mesa.
          </p>
          <div className="mt-4">
            <DrawablyButton
              type="button"
              variant="outline"
              stroke="var(--parchis-blue)"
              onClick={onJoin}
              className="w-full select-none px-6 py-2.5"
            >
              Tengo un código
            </DrawablyButton>
          </div>
        </DrawablyCard>
      </div>
    </div>
  );
}

function CreateStep({
  connection,
  onConnection,
  color,
  onColor,
  emptyColors,
  onToggleEmpty,
  onlineSupported,
  onlineUnavailableCopy,
  onOfflineMode,
  onOnlineMode,
  onBack,
}: {
  connection: Connection;
  onConnection(next: Connection): void;
  color: ParchisColor;
  onColor(next: ParchisColor): void;
  emptyColors: readonly ParchisColor[];
  onToggleEmpty(target: ParchisColor, empty: boolean): void;
  onlineSupported: boolean;
  onlineUnavailableCopy: string | null;
  onOfflineMode(mode: OfflineGameMode): void;
  onOnlineMode(mode: GameMode): void;
  onBack(): void;
}) {
  return (
    <div className="grid gap-4">
      <DrawablyCard className="rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
          Modo de multijugador
        </h2>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            selected={connection === "online"}
            disabled={!onlineSupported}
            title="Sí, con personas"
            detail={
              onlineUnavailableCopy ??
              "Comparte un código y juega contra quien se una. Los huecos libres los ocupan bots."
            }
            accent="var(--parchis-green)"
            onChoose={() => onConnection("online")}
          />
          <ChoiceCard
            selected={connection === "bots"}
            title="No, contra bots"
            detail="Sin esperas ni códigos: empieza ahora mismo contra la máquina."
            accent="var(--parchis-red)"
            onChoose={() => onConnection("bots")}
          />
        </div>

        {connection === "bots" && (
          <fieldset className="mt-4">
            <legend className="mb-2 text-sm font-medium text-stone-700">
              Color de tu ficha
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {BOARD_COLORS.map((option) => {
                const selected = option === color;
                return (
                  <DrawablyButton
                    key={option}
                    type="button"
                    variant="outline"
                    stroke={COLOR_ACCENT[option]}
                    aria-pressed={selected}
                    onClick={() => onColor(option)}
                    className={`flex select-none items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs capitalize ${
                      selected ? "font-semibold" : ""
                    }`}
                    style={{
                      background: selected
                        ? `color-mix(in srgb, ${COLOR_ACCENT[option]} 12%, transparent)`
                        : "transparent",
                    }}
                  >
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: COLOR_ACCENT[option] }}
                    />
                    {COLOR_NAMES[option]}
                    {selected && <span aria-hidden="true">✓</span>}
                  </DrawablyButton>
                );
              })}
            </div>
          </fieldset>
        )}
      </DrawablyCard>

      <DrawablyCard className="rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
          Modo de juego
        </h2>
        <p className="mt-1 text-sm leading-6 text-stone-600">
          Elige cuántos jugadores se sientan a la mesa.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ModeCard
            image="/modes/1vs1.png"
            title="1 contra 1"
            detail="Dos jugadores, en esquinas opuestas."
            onChoose={() =>
              connection === "online" ? onOnlineMode("1v1") : onOfflineMode("1v1")
            }
          />
          <ModeCard
            image="/modes/all-for-all.png"
            title="4 jugadores · todos contra todos"
            detail="Cuatro colores, cuatro fichas por jugador."
            onChoose={() =>
              connection === "online" ? onOnlineMode("all") : onOfflineMode("all")
            }
          />
        </div>

        {connection === "bots" && (
          <fieldset className="mt-5 border-t border-stone-200 pt-4">
            <legend className="sr-only">Huecos de la mesa</legend>
            <p className="text-sm font-medium text-stone-700">
              Huecos de la mesa
            </p>
            <p className="mt-1 text-xs leading-5 text-stone-600">
              En la mesa de cuatro puedes dejar colores vacíos o llenarlos con
              bots. Siempre necesitas al menos un rival.
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {BOARD_COLORS.map((option) =>
                option === color ? (
                  <div key={option} className="flex items-center gap-2">
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-stone-700">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: COLOR_ACCENT[option] }}
                      />
                      <span className="truncate">{COLOR_NAMES[option]}</span>
                    </span>
                    <span className="w-36 rounded-lg border border-dashed border-stone-300 px-3 py-1.5 text-center text-xs font-semibold text-stone-700">
                      Tu asiento
                    </span>
                  </div>
                ) : (
                  <SeatFillPicker
                    key={option}
                    color={option}
                    empty={emptyColors.includes(option)}
                    canEmpty={
                      BOARD_COLORS.filter(
                        (item) =>
                          item !== color && !emptyColors.includes(item),
                      ).length > 1
                    }
                    onChange={(empty) => onToggleEmpty(option, empty)}
                  />
                ),
              )}
            </div>
          </fieldset>
        )}
      </DrawablyCard>

      <div>
        <DrawablyButton
          type="button"
          variant="outline"
          onClick={onBack}
          className="select-none px-4 py-2 text-sm"
        >
          Volver al inicio
        </DrawablyButton>
      </div>
    </div>
  );
}

function ChoiceCard({
  selected,
  disabled = false,
  title,
  detail,
  accent,
  onChoose,
}: {
  selected: boolean;
  disabled?: boolean;
  title: string;
  detail: string;
  accent: string;
  onChoose(): void;
}) {
  return (
    <DrawablyButton
      type="button"
      variant="outline"
      stroke={selected ? accent : undefined}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onChoose}
      className="flex h-full w-full select-none flex-col items-start gap-1 rounded-xl p-4 text-left transition-colors"
      style={{
        background: selected
          ? "color-mix(in srgb, var(--parchis-blue) 18%, transparent)"
          : "transparent",
        color: "var(--color-stone-900, #1c1917)",
      }}
    >
      <span className="text-base font-semibold">{title}</span>
      <span className="text-xs leading-5 text-stone-600">{detail}</span>
    </DrawablyButton>
  );
}

function ModeCard({
  image,
  title,
  detail,
  onChoose,
}: {
  image: string;
  title: string;
  detail: string;
  onChoose(): void;
}) {
  return (
    <DrawablyButton
      type="button"
      variant="outline"
      onClick={onChoose}
      className="flex h-full w-full select-none flex-col items-stretch gap-2 p-3 text-left transition-transform hover:-translate-y-0.5"
    >
      <Image
        src={image}
        alt=""
        width={1536}
        height={1024}
        loading="eager"
        className="h-28 w-full object-contain mix-blend-multiply"
      />
      <span className="text-lg font-semibold">{title}</span>
      <span className="text-xs leading-5 text-stone-600">{detail}</span>
    </DrawablyButton>
  );
}

function JoinStep({
  code,
  onCode,
  onSubmit,
  unavailableCopy,
  failure,
  onBack,
}: {
  code: string;
  onCode(value: string): void;
  onSubmit(): void;
  unavailableCopy: string | null;
  failure: string | null;
  onBack(): void;
}) {
  if (unavailableCopy) {
    return (
      <DrawablyCard className="mx-auto w-full max-w-md rounded-xl bg-[var(--drawably-paper)] p-5 text-center sm:p-6">
        <h2 className="text-lg font-semibold">El juego en línea no está disponible</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">{unavailableCopy}</p>
        <DrawablyButton
          type="button"
          variant="solid"
          onClick={onBack}
          className="mt-4 select-none px-5 py-2.5"
        >
          Volver al inicio
        </DrawablyButton>
      </DrawablyCard>
    );
  }

  return (
    <DrawablyCard className="mx-auto w-full max-w-md rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
        Unirse a una partida
      </h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">
        Escribe el código que te ha pasado el anfitrión.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="mt-4 flex flex-col gap-3"
      >
        <div>
          <label
            htmlFor="party-code"
            className="mb-1.5 block text-sm font-medium text-stone-700"
          >
            Código de partida
          </label>
          <DrawablyInput
            id="party-code"
            value={code}
            onChange={(event) =>
              onCode(event.target.value.toUpperCase().slice(0, 6))
            }
            placeholder="ABC123"
            maxLength={6}
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            className="block w-full text-lg uppercase tracking-[0.28em]"
          />
        </div>

        {failure && (
          <p role="alert" className="text-sm text-[var(--drawably-error)]">
            {failure}
          </p>
        )}

        <DrawablyButton
          type="submit"
          variant="solid"
          disabled={code.length !== 6}
          className="w-full select-none px-6 py-2.5"
        >
          Unirse a la partida
        </DrawablyButton>
      </form>

      <div className="mt-4">
        <DrawablyButton
          type="button"
          variant="outline"
          onClick={onBack}
          className="select-none px-4 py-2 text-sm"
        >
          Volver al inicio
        </DrawablyButton>
      </div>
    </DrawablyCard>
  );
}

function SkeletonBar({
  className,
  pulse = false,
}: {
  className: string;
  pulse?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-md bg-stone-900/10 ${pulse ? "animate-pulse" : ""} ${className}`}
    />
  );
}

/**
 * The lobby before the server has answered. It mirrors the real layout with
 * skeleton cards so the wait reads as "still connecting" rather than a broken
 * screen, and it never surfaces how long the connection is taking.
 */
function LobbyConnecting({
  mode,
  isHost,
}: {
  mode: GameMode;
  isHost: boolean;
}) {
  const seats = mode === "1v1" ? 2 : 4;

  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">
        Conectando con la partida. Estamos buscando al anfitrión y abriendo la
        conexión.
      </span>

      <DrawablyCard className="flex flex-col gap-4 rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6">
        <div>
          <DrawablyBadge
            stroke="var(--parchis-blue)"
            className="px-2.5 py-0.5 text-[11px]"
          >
            {isHost ? "Eres el anfitrión" : "Sala de espera"}
          </DrawablyBadge>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">
            {isHost ? "Creando la partida…" : "Conectando con la partida…"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            La conexión va directa entre los dispositivos. Un momento.
          </p>
        </div>

        <DrawablyDivider />

        <div className="flex flex-col items-center gap-3">
          <SkeletonBar className="h-4 w-28" pulse />
          <div className="flex items-center gap-2">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <SkeletonBar
                key={index}
                className="h-8 w-5"
                pulse
              />
            ))}
          </div>
          <SkeletonBar className="h-8 w-32 rounded-lg" pulse />
        </div>

        <SkeletonBar className="h-4 w-3/4 self-center" pulse />
      </DrawablyCard>

      <DrawablyCard className="flex flex-col gap-4 rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Jugadores</h2>
          <p className="text-xs text-stone-500">Conectando…</p>
        </div>

        <div className="flex flex-col gap-2">
          {Array.from({ length: seats }, (_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5"
              style={{ border: "1.5px dashed #d6c9b2" }}
            >
              <SkeletonBar className="h-10 w-10 shrink-0 rounded-full" pulse />
              <div className="min-w-0 flex-1 space-y-2">
                <SkeletonBar className="h-3 w-2/3" pulse />
                <SkeletonBar className="h-3 w-1/3" pulse />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <SkeletonBar className="h-10 flex-1 rounded-xl" pulse />
          <SkeletonBar className="h-10 w-24 rounded-xl" pulse />
        </div>
      </DrawablyCard>
    </div>
  );
}

function LobbyStep({
  party,
  name,
  onStart,
  onLeave,
}: {
  party: ReturnType<typeof usePartySession>;
  name: string;
  onStart(): void;
  onLeave(): void;
}) {
  const { lobby } = party;
  const described = describeLobby(lobby);
  const isHost = lobby.role === "host";
  const seats = Array.from({ length: lobby.capacity }, (_, index) =>
    index === 0 ? ("host" as const) : (`guest-${index}` as PlayerId),
  );
  const playersById = new Map(
    lobby.players.map((player) => [player.id, player] as const),
  );
  const guestCount = Math.max(0, lobby.players.length - 1);
  const guestSeats = lobby.capacity - 1;
  const connecting =
    lobby.phase === "creating" ||
    lobby.phase === "joining" ||
    (lobby.role === "guest" && lobby.players.length === 0 && !lobby.failure);

  if (connecting) {
    return <LobbyConnecting mode={lobby.mode} isHost={isHost} />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <DrawablyCard className="flex flex-col gap-4 rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6">
        <div aria-live="polite">
          <DrawablyBadge
            stroke={
              described.tone === "error"
                ? "var(--parchis-red)"
                : described.tone === "success"
                  ? "var(--parchis-green)"
                  : "var(--parchis-blue)"
            }
            className="px-2.5 py-0.5 text-[11px]"
          >
            {isHost ? "Eres el anfitrión" : "Sala de espera"}
          </DrawablyBadge>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">
            {described.title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            {described.detail}
          </p>
        </div>

        <DrawablyDivider />

        <RoomCode code={lobby.code} />

        <p className="text-center text-xs leading-5 text-stone-500">
          {guestCount} de {guestSeats} invitados dentro. Los asientos vacíos los
          ocupan bots cuando empieza la partida.
        </p>

        {lobby.phase === "failed" && (
          <div className="flex flex-wrap gap-2">
            <DrawablyButton
              type="button"
              variant="solid"
              onClick={party.retry}
              className="select-none px-4 py-2 text-sm"
            >
              Volver a intentarlo
            </DrawablyButton>
          </div>
        )}
      </DrawablyCard>

      <DrawablyCard className="flex flex-col gap-4 rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Jugadores</h2>
          <p className="text-xs text-stone-500">
            Se actualiza en tiempo real.
          </p>
        </div>

        <ul className="flex flex-col gap-2">
          {seats.map((seatId) => (
            <LobbySeat
              key={seatId}
              seatId={seatId}
              mode={lobby.mode}
              isHost={seatId === "host"}
              player={playersById.get(seatId) ?? null}
            />
          ))}
        </ul>

        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          {isHost ? (
            <DrawablyButton
              type="button"
              variant="solid"
              stroke="var(--parchis-green)"
              onClick={onStart}
              disabled={lobby.phase === "failed"}
              className="flex-1 select-none px-6 py-2.5"
            >
              Iniciar la partida
            </DrawablyButton>
          ) : (
            <p className="flex-1 text-sm leading-6 text-stone-600">
              Solo el anfitrión puede iniciar la partida. Espera su señal:
              empezará en cuanto decida.
            </p>
          )}

          <DrawablyButton
            type="button"
            variant="outline"
            onClick={onLeave}
            className="select-none px-4 py-2.5 text-sm"
          >
            {isHost ? "Cancelar" : "Salir"}
          </DrawablyButton>
        </div>

        <p className="sr-only" aria-live="polite">
          En la sala están {name} y {guestCount} invitados.
        </p>
      </DrawablyCard>
    </div>
  );
}
