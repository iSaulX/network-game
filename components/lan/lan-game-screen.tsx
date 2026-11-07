"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DrawablyAlert } from "drawably/react";
import { GameStage } from "@/components/game/game-stage";
import type { GameFeedback } from "@/components/game/game-feedback";
import { createLanProfiles } from "@/components/lan/roster";
import type { BonusMove, DieValue, Move } from "@/lib/parchis/types";
import type { GameSession, SessionSnapshot } from "@/lib/party/session";
import type { LanRole, LanRoster } from "@/lib/party/protocol";
import { PAIRING_FAILURE_COPY } from "@/lib/party/webrtc/pairing";

const ROLL_ANIMATION_MS = 750;
/** After this long without a reply the banner explains the wait. */
const SLOW_CONNECTION_MS = 4000;

export interface LanGameScreenProps {
  readonly session: GameSession;
  readonly snapshot: SessionSnapshot;
  readonly roster: LanRoster;
  readonly role: LanRole;
  readonly feedback: GameFeedback;
  onLeave(): void;
}

/**
 * The in-game LAN screen. It reuses `GameStage` verbatim and only supplies the
 * session's state, the LAN roster and the connection banner.
 *
 * The dice tumble is presentational: it echoes the committed faces from the
 * newest `roll` event for both devices, so no value is ever invented locally.
 */
export function LanGameScreen({
  session,
  snapshot,
  roster,
  role,
  feedback,
  onLeave,
}: LanGameScreenProps) {
  const state = snapshot.state;
  const profiles = createLanProfiles(roster);
  const profile = profiles.find((item) => item.id === role) ?? profiles[0]!;
  const opponent = roster[role === "host" ? "guest" : "host"];

  const [rolling, setRolling] = useState<{
    playerId: string;
    faces: [DieValue, DieValue];
  } | null>(null);
  const [slow, setSlow] = useState(false);

  const rollTimeoutRef = useRef<number | null>(null);
  const slowTimeoutRef = useRef<number | null>(null);

  const myTurn =
    state !== null &&
    state.phase !== "finished" &&
    state.players[state.currentPlayerIndex]?.id === role &&
    snapshot.status === "connected";

  // Timers must never outlive the screen.
  useEffect(
    () => () => {
      if (rollTimeoutRef.current !== null) {
        window.clearTimeout(rollTimeoutRef.current);
        rollTimeoutRef.current = null;
      }
      if (slowTimeoutRef.current !== null) {
        window.clearTimeout(slowTimeoutRef.current);
        slowTimeoutRef.current = null;
      }
    },
    [],
  );

  // Narrate new events and the turn change, mirroring `GameStage`'s local mode.
  const previousLogLength = useRef(state?.log.length ?? 0);
  const previousCurrentPlayer = useRef<string | null>(null);

  const reactToSnapshot = useCallback(
    (next: SessionSnapshot) => {
      if (!next.state) return;

      const seen = previousLogLength.current;
      previousLogLength.current = next.state.log.length;

      if (next.state.log.length > seen) {
        feedback.events(next.state.log.slice(seen), role);
      }

      const currentId =
        next.state.players[next.state.currentPlayerIndex]?.id ?? null;
      if (
        previousCurrentPlayer.current !== null &&
        previousCurrentPlayer.current !== role &&
        currentId === role &&
        next.state.phase !== "finished"
      ) {
        feedback.yourTurn();
      }
      previousCurrentPlayer.current = currentId;

      if (next.events.length === 0) {
        return;
      }

      // A reply arrived: the connection is not slow after all.
      if (slowTimeoutRef.current !== null) {
        window.clearTimeout(slowTimeoutRef.current);
        slowTimeoutRef.current = null;
      }
      setSlow(false);

      const rollEvent = [...next.events]
        .reverse()
        .find((event) => event.type === "roll");
      if (!rollEvent || rollEvent.type !== "roll") return;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      setRolling({
        playerId: rollEvent.playerId,
        faces: [rollEvent.dice[0], rollEvent.dice[1]],
      });

      if (rollTimeoutRef.current !== null) {
        window.clearTimeout(rollTimeoutRef.current);
      }
      rollTimeoutRef.current = window.setTimeout(() => {
        rollTimeoutRef.current = null;
        setRolling(null);
      }, ROLL_ANIMATION_MS);
    },
    [feedback, role],
  );

  // A snapshot is an external event stream, so reacting to it in an effect is
  // the intended pattern; the mirror state (rolling / slow) is presentational.
  const previousVersion = useRef(snapshot.version);
  useEffect(() => {
    if (previousVersion.current === snapshot.version) return;
    previousVersion.current = snapshot.version;
    reactToSnapshot(snapshot);
  }, [reactToSnapshot, snapshot]);

  const startSlowNotice = () => {
    if (slowTimeoutRef.current !== null) {
      window.clearTimeout(slowTimeoutRef.current);
    }
    slowTimeoutRef.current = window.setTimeout(() => {
      slowTimeoutRef.current = null;
      setSlow(true);
    }, SLOW_CONNECTION_MS);
  };

  const handleRoll = useCallback(() => {
    if (!myTurn) return;
    feedback.roll("human");
    startSlowNotice();
    session.roll();
  }, [feedback, myTurn, session]);

  const handleMove = useCallback(
    (move: Move | BonusMove) => {
      if (!myTurn) return;
      if ("kind" in move) {
        session.bonusMove(move);
      } else {
        session.move(move);
      }
    },
    [myTurn, session],
  );

  const handleChooseBarrier = useCallback(
    (progress: number) => {
      if (!myTurn) return;
      session.chooseBarrier(progress);
    },
    [myTurn, session],
  );

  const connectionCopy =
    snapshot.status === "failed"
      ? "Se ha perdido la conexión con el otro dispositivo."
      : snapshot.status === "disconnected"
        ? "La conexión se ha cerrado. La partida ha terminado."
        : null;

  return (
    <>
      <GameStage
        state={state!}
        viewColor={profile.color}
        humanPlayerId={role}
        humanControlled={myTurn}
        remoteHuman
        profiles={profiles}
        modeLabel={`1 vs 1 en red · ${role === "host" ? "anfitrión" : "invitado"}`}
        rolling={rolling}
        feedback={feedback}
        onRoll={handleRoll}
        onMove={handleMove}
        onChooseBarrier={handleChooseBarrier}
        onExit={onLeave}
        banner={
          connectionCopy ? (
            <DrawablyAlert className="mx-auto w-full max-w-2xl p-3 text-sm">
              {connectionCopy}
            </DrawablyAlert>
          ) : slow ? (
            <p className="text-center text-sm text-stone-600">
              La conexión va lenta… esperando a {opponent.name}.
            </p>
          ) : snapshot.error ? (
            <p className="text-center text-sm text-stone-600">
              {snapshot.error.code === "RATE_LIMITED"
                ? "Ve más despacio: demasiadas acciones seguidas."
                : snapshot.error.code === "STALE_VERSION"
                  ? "El estado se ha actualizado. Inténtalo de nuevo."
                  : "No se pudo aplicar la acción. Espera al estado nuevo."}
            </p>
          ) : undefined
        }
        playAgain={null}
      />
      {snapshot.status !== "connected" && (
        <p className="sr-only" aria-live="assertive">
          {connectionCopy ?? PAIRING_FAILURE_COPY["peer-left"]}
        </p>
      )}
    </>
  );
}
