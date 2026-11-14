"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DrawablyAlert } from "drawably/react";
import { GameStage } from "@/components/game/game-stage";
import type { GameFeedback } from "@/components/game/game-feedback";
import { partyProfiles } from "@/components/party/party-profiles";
import {
  chooseBarrier,
  chooseBonusMove,
  chooseMove,
} from "@/lib/bots/policy";
import type { BonusMove, DieValue, Move } from "@/lib/parchis/types";
import type { GameSession, SessionSnapshot } from "@/lib/party/session";

const ROLL_ANIMATION_MS = 750;
/** Delay between two auto-play actions, matching the local bot pacing. */
const AUTO_STEP_MS = 900;
/** After this long without a reply the banner explains the wait. */
const SLOW_CONNECTION_MS = 4000;

export interface PartyGameScreenProps {
  readonly session: GameSession;
  readonly snapshot: SessionSnapshot;
  readonly viewerId: string;
  readonly feedback: GameFeedback;
  onLeave(): void;
}

/**
 * The in-game online screen. It reuses `GameStage` verbatim and only supplies
 * the session's state, the full roster (humans and bots) and the connection
 * banner.
 *
 * The dice tumble is presentational: it echoes the committed faces from the
 * newest `roll` event for every device, so no value is ever invented locally.
 */
export function PartyGameScreen({
  session,
  snapshot,
  viewerId,
  feedback,
  onLeave,
}: PartyGameScreenProps) {
  const state = snapshot.state;
  const profiles = useMemo(
    () =>
      snapshot.roster
        ? partyProfiles(snapshot.roster, snapshot.mode)
        : [],
    [snapshot.mode, snapshot.roster],
  );
  const viewer = profiles.find((item) => item.id === viewerId) ?? profiles[0];
  const opponent = profiles.find(
    (item) =>
      item.id !== viewerId &&
      !item.id.startsWith("bot-") &&
      !snapshot.disconnected.includes(item.id),
  );

  const [rolling, setRolling] = useState<{
    playerId: string;
    faces: [DieValue, DieValue];
  } | null>(null);
  const [slow, setSlow] = useState(false);
  const [autoMode, setAutoMode] = useState(false);

  const rollTimeoutRef = useRef<number | null>(null);
  const slowTimeoutRef = useRef<number | null>(null);
  const autoTimeoutRef = useRef<number | null>(null);
  const autoModeRef = useRef(autoMode);

  const canAct =
    state !== null &&
    state.phase !== "finished" &&
    state.players[state.currentPlayerIndex]?.id === viewerId &&
    snapshot.status === "connected";
  // Auto-play temporarily hands the viewer's seat to the same policy the
  // local bots use; the session still validates every action on the host.
  const myTurn = canAct && !autoMode;

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
      if (autoTimeoutRef.current !== null) {
        window.clearTimeout(autoTimeoutRef.current);
        autoTimeoutRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    autoModeRef.current = autoMode;
  }, [autoMode]);

  // Narrate new events and the turn change, mirroring the local mode.
  const previousLogLength = useRef(state?.log.length ?? 0);
  const previousCurrentPlayer = useRef<string | null>(null);

  const reactToSnapshot = useCallback(
    (next: SessionSnapshot) => {
      if (!next.state) return;

      const seen = previousLogLength.current;
      previousLogLength.current = next.state.log.length;

      if (next.state.log.length > seen) {
        feedback.events(next.state.log.slice(seen), viewerId);
      }

      const currentId =
        next.state.players[next.state.currentPlayerIndex]?.id ?? null;
      if (
        previousCurrentPlayer.current !== null &&
        previousCurrentPlayer.current !== viewerId &&
        currentId === viewerId &&
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
    [feedback, viewerId],
  );

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

  // Auto-play: one policy action per tick while the viewer's seat is current.
  useEffect(() => {
    if (!autoMode || !canAct || !state || !viewer) {
      return;
    }

    const playStep = () => {
      autoTimeoutRef.current = null;

      if (!autoModeRef.current) {
        return;
      }

      switch (state.phase) {
        case "awaiting-roll":
          feedback.roll("human");
          startSlowNotice();
          session.roll();
          return;
        case "awaiting-move": {
          const move = chooseMove(state, viewerId);
          if (move) session.move(move);
          return;
        }
        case "awaiting-bonus": {
          const move = chooseBonusMove(state, viewerId);
          if (move) session.bonusMove(move);
          return;
        }
        case "awaiting-barrier": {
          const progress = chooseBarrier(state, viewerId);
          if (progress !== null) session.chooseBarrier(progress);
          return;
        }
        default:
          return;
      }
    };

    autoTimeoutRef.current = window.setTimeout(playStep, AUTO_STEP_MS);

    return () => {
      if (autoTimeoutRef.current !== null) {
        window.clearTimeout(autoTimeoutRef.current);
        autoTimeoutRef.current = null;
      }
    };
  }, [autoMode, canAct, feedback, session, state, viewer, viewerId]);

  const handleAutoChange = useCallback(
    (next: boolean) => {
      feedback.tap();
      setAutoMode(next);
    },
    [feedback],
  );

  const connectionCopy =
    snapshot.status === "failed"
      ? "Se ha perdido la conexión."
      : snapshot.status === "disconnected"
        ? "La conexión se ha cerrado. La partida ha terminado."
        : null;

  if (!state || !viewer) {
    return null;
  }

  const isHost = viewerId === "host";

  return (
    <>
      <GameStage
        state={state}
        viewColor={viewer.color}
        humanPlayerId={viewerId}
        humanControlled={myTurn}
        autoControl={{ checked: autoMode, onChange: handleAutoChange }}
        remoteHuman
        profiles={profiles}
        modeLabel={
          snapshot.mode === "1v1"
            ? "1 contra 1 · en línea"
            : "Todos contra todos · en línea"
        }
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
              {opponent
                ? `La conexión va lenta… esperando a ${opponent.name}.`
                : "La conexión va lenta…"}
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
          {connectionCopy ?? "La conexión se ha interrumpido."}
        </p>
      )}
      {isHost && snapshot.status !== "connected" ? (
        <p className="sr-only" aria-live="polite">
          Algunos jugadores se han desconectado; sus fichas las mueve la
          máquina.
        </p>
      ) : null}
    </>
  );
}
