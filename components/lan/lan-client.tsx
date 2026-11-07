"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import {
  DrawablyButton,
  DrawablyCard,
  DrawablyDivider,
  DrawablyHighlight,
  DrawablyInput,
} from "drawably/react";
import { AvatarPicker } from "@/components/avatar-picker";
import { CameraScanner } from "@/components/lan/camera-scanner";
import { ConnectionStatus } from "@/components/lan/connection-status";
import { LanGameScreen } from "@/components/lan/lan-game-screen";
import { PairingCodeBox } from "@/components/lan/pairing-code-box";
import { QrCode } from "@/components/lan/qr-code";
import {
  DEFAULT_GUEST_INFO,
  DEFAULT_HOST_INFO,
  LAN_GUEST_COLOR,
  LAN_HOST_COLOR,
} from "@/components/lan/roster";
import { useGameFeedback } from "@/components/game/game-feedback";
import { useLanSession } from "@/lib/party/lan/use-lan-session";
import type { LanRole } from "@/lib/party/protocol";
import { joinPairingParts } from "@/lib/party/webrtc/signaling";
import { PAIRING_FAILURE_COPY } from "@/lib/party/webrtc/pairing";
import {
  getLanSupport,
  LAN_ROLE_LABEL,
  LAN_SUPPORT_COPY,
} from "@/lib/party/webrtc/support";

const AVATAR_OPTIONS = [
  { label: "perro", image: "/pictures/dog.png" },
  { label: "mono", image: "/pictures/monkey.png" },
  { label: "pollo", image: "/pictures/chicken.png" },
  { label: "cara", image: "/pictures/face.png" },
  { label: "pulpo", image: "/pictures/octupus.png" },
  { label: "abeja", image: "/pictures/bee.png" },
  { label: "unicornio", image: "/pictures/unicorn.png" },
  { label: "popó", image: "/pictures/poop.png" },
] as const;

function avatarIndex(image: string): number {
  const index = AVATAR_OPTIONS.findIndex((option) => option.image === image);
  return index === -1 ? 0 : index;
}

/** Rendered only after mount, so the secure-context check runs in the browser. */
export function LanClient() {
  const feedback = useGameFeedback();
  const support = useMemo(() => getLanSupport(), []);
  const lan = useLanSession(feedback);

  if (!support.ok) {
    return (
      <Shell>
        <DrawablyCard className="w-full max-w-lg rounded-xl bg-[var(--drawably-paper)] p-6 text-center sm:p-8">
          <h2 className="text-xl font-semibold tracking-tight">
            Este modo no está disponible
          </h2>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            {LAN_SUPPORT_COPY[support.reason]}
          </p>
          <form action="/" method="get" className="mt-5">
            <DrawablyButton
              type="submit"
              variant="solid"
              className="w-full select-none px-6 py-2.5"
            >
              Volver al inicio
            </DrawablyButton>
          </form>
        </DrawablyCard>
      </Shell>
    );
  }

  if (lan.session && lan.snapshot?.state && lan.roster) {
    return (
      <LanGameScreen
        key={lan.pairing.role ?? "host"}
        session={lan.session}
        snapshot={lan.snapshot}
        roster={lan.roster}
        role={lan.pairing.role ?? "host"}
        feedback={feedback}
        onLeave={lan.abort}
      />
    );
  }

  return <PairingScreen lan={lan} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-col items-center gap-2 text-center">
        <div className="flex items-center justify-center gap-3">
          <Image
            src="/icon.png"
            alt=""
            width={48}
            height={48}
            priority
            className="h-11 w-11 shrink-0 object-contain mix-blend-multiply"
          />
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            <DrawablyHighlight fill="var(--parchis-yellow)" boil={0.18}>
              Jugar en la misma red
            </DrawablyHighlight>
          </h1>
        </div>
        <p className="max-w-xl text-sm leading-6 text-stone-600">
          Dos dispositivos en la misma Wi‑Fi se conectan directamente, sin
          internet y sin cuentas.
        </p>
      </header>
      {children}
    </main>
  );
}

function PairingScreen({
  lan,
}: {
  lan: ReturnType<typeof useLanSession>;
}) {
  const { pairing } = lan;
  const role = pairing.role;

  if (role === null) {
    return (
      <Shell>
        <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
          <RoleCard
            role="host"
            title="Crear partida"
            description="Tú serás el anfitrión. La partida empieza en tu dispositivo y tú mueves primero."
            onChoose={() => lan.chooseRole("host")}
          />
          <RoleCard
            role="guest"
            title="Unirse a una partida"
            description="Escanea o pega el código del anfitrión para entrar."
            onChoose={() => lan.chooseRole("guest")}
          />
        </div>
      </Shell>
    );
  }

  const showingOutgoing =
    pairing.phase === "host-showing-offer" ||
    pairing.phase === "guest-showing-answer";
  const joined = joinPairingParts(pairing.incoming);
  const complete = joined.status === "complete";
  const missing =
    joined.status === "incomplete" ? joined.missing.length : 0;
  const failed = pairing.failure !== null;

  return (
    <Shell>
      <div className="grid w-full max-w-4xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <DrawablyCard className="flex flex-col gap-4 rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6">
          <div>
            <p className="text-sm text-stone-500">Tu papel</p>
            <h2 className="text-xl font-semibold tracking-tight">
              {LAN_ROLE_LABEL[role]}
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              {role === "host"
                ? "Tú mueves primero y la partida se calcula en tu dispositivo."
                : "Espera el código del anfitrión y conéctate."}
            </p>
          </div>

          {!lan.snapshot && (
            <ProfileFields lan={lan} role={role} />
          )}

          <div className="flex flex-wrap gap-2">
            <DrawablyButton
              type="button"
              variant="outline"
              onClick={lan.abort}
              className="select-none px-4 py-2 text-sm"
            >
              Cancelar
            </DrawablyButton>
            {failed && (
              <DrawablyButton
                type="button"
                variant="solid"
                onClick={lan.retry}
                className="select-none px-4 py-2 text-sm"
              >
                Volver a intentarlo
              </DrawablyButton>
            )}
          </div>
        </DrawablyCard>

        <DrawablyCard className="flex flex-col gap-4 rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6">
          <ConnectionStatus pairing={pairing} />

          {failed ? (
            <p className="text-center text-sm leading-6 text-stone-600">
              La cámara y el pegado de texto siguen disponibles cuando vuelvas
              a intentarlo.
            </p>
          ) : (
            <PairingSteps lan={lan} complete={complete} missing={missing} />
          )}

          {showingOutgoing && !failed && lan.outgoingText && (
            <>
              <DrawablyDivider />
              <div className="flex flex-col items-center gap-3">
                <QrCode
                  value={lan.outgoingText}
                  index={pairing.outgoingIndex}
                  total={pairing.outgoing.length}
                  onPrevious={lan.showPreviousPart}
                  onNext={lan.showNextPart}
                />
              </div>
            </>
          )}

          {!failed && (
            <>
              <DrawablyDivider />
              <MiniScanner lan={lan} />
            </>
          )}
        </DrawablyCard>
      </div>
    </Shell>
  );
}

function RoleCard({
  role,
  title,
  description,
  onChoose,
}: {
  role: LanRole;
  title: string;
  description: string;
  onChoose(): void;
}) {
  const accent = role === "host" ? "var(--parchis-red)" : "var(--parchis-yellow)";

  return (
    <DrawablyCard className="flex flex-col rounded-xl bg-[var(--drawably-paper)] p-5 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 flex-1 text-sm leading-6 text-stone-600">
        {description}
      </p>
      <div className="mt-4">
        <DrawablyButton
          type="button"
          variant="solid"
          stroke={accent}
          onClick={onChoose}
          className="w-full select-none px-6 py-2.5"
        >
          {title}
        </DrawablyButton>
      </div>
    </DrawablyCard>
  );
}

function ProfileFields({
  lan,
  role,
}: {
  lan: ReturnType<typeof useLanSession>;
  role: LanRole;
}) {
  const fallback = role === "host" ? DEFAULT_HOST_INFO : DEFAULT_GUEST_INFO;
  const [name, setName] = useState(fallback.name);
  const [index, setIndex] = useState(avatarIndex(fallback.avatar));
  const accent = role === "host" ? LAN_HOST_COLOR : LAN_GUEST_COLOR;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label
          htmlFor="lan-name"
          className="mb-1.5 block text-sm font-medium text-stone-700"
        >
          Tu nombre
        </label>
        <DrawablyInput
          id="lan-name"
          value={name}
          maxLength={24}
          autoComplete="name"
          onChange={(event) => {
            setName(event.target.value);
            lan.setProfile(role, {
              name: event.target.value,
              avatar: AVATAR_OPTIONS[index]!.image,
            });
          }}
          className="block w-full text-base"
        />
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium text-stone-700">Tu avatar</p>
        <AvatarPicker
          options={AVATAR_OPTIONS}
          selectedIndex={index}
          accent={`var(--parchis-${accent})`}
          onSelect={(next) => {
            setIndex(next);
            lan.setProfile(role, {
              name,
              avatar: AVATAR_OPTIONS[next]!.image,
            });
          }}
        />
      </div>
    </div>
  );
}

function PairingSteps({
  lan,
  complete,
  missing,
}: {
  lan: ReturnType<typeof useLanSession>;
  complete: boolean;
  missing: number;
}) {
  const { pairing } = lan;
  const gathered = pairing.incoming;

  // The paste field is always available: a guest has to paste the offer before
  // it can answer, so hiding this step would deadlock the pairing.
  return (
    <div className="flex flex-col gap-3">
      <PairingCodeBox
        parts={pairing.outgoing}
        label={
          pairing.role === "host"
            ? "Código para el invitado"
            : "Respuesta para el anfitrión"
        }
        onAddPart={lan.addIncomingParts}
        gathered={gathered}
        missingCount={missing}
        showOutgoing={lan.outgoingText !== null}
      />

      <DrawablyButton
        type="button"
        variant="solid"
        disabled={!complete || pairing.phase === "connecting"}
        onClick={lan.connect}
        className="w-full select-none px-6 py-2.5"
      >
        {pairing.phase === "connecting" ? "Conectando…" : "Conectar"}
      </DrawablyButton>
    </div>
  );
}

function MiniScanner({ lan }: { lan: ReturnType<typeof useLanSession> }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-center text-xs leading-5 text-stone-500">
        También puedes escanearlo con la cámara.
      </p>
      <CameraScanner
        onPart={lan.addIncomingParts}
        onFailure={(failure) => {
          // Keep the paste field available; surface the reason in place.
          console.warn(PAIRING_FAILURE_COPY[failure]);
        }}
      />
    </div>
  );
}
