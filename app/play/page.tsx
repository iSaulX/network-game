"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GameStage,
  type GameStageAutoControl,
} from "@/components/game/game-stage";
import {
  createGameSetup,
  getGameSettingsFromSearchParams,
  type GamePlayerProfile,
} from "@/components/game/game-players";
import { useGameFeedback } from "@/components/game/game-feedback";
import {
  chooseBonusMove as chooseBotBonusMove,
  chooseBarrier as chooseBotBarrier,
  chooseMove as chooseBotMove,
} from "@/lib/bots/policy";
import {
  applyBonusMove,
  applyMove,
  chooseBarrier,
  createGame,
  roll,
  rollDice,
} from "@/lib/parchis";
import type {
  BonusMove,
  DieValue,
  GameState,
  Move,
} from "@/lib/parchis/types";

function PlayLoading() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <p className="text-sm text-stone-500">Preparando la partida…</p>
    </main>
  );
}

export default function PlayPage() {
  return (
    <Suspense fallback={<PlayLoading />}>
      <PlayPageContent />
    </Suspense>
  );
}

function PlayPageContent() {
  const router = useRouter();
  const feedback = useGameFeedback();
  const searchParams = useSearchParams();
  const settings = useMemo(
    () => getGameSettingsFromSearchParams(searchParams),
    [searchParams],
  );
  const setup = useMemo(() => createGameSetup(settings), [settings]);
  const profilesById = useMemo(
    () =>
      new Map(
        setup.seats.map((profile) => [profile.id, profile] as const),
      ),
    [setup],
  );
  const viewColor = setup.human.color;

  const [game, setGame] = useState<GameState>(() =>
    createGame(setup.configs),
  );
  const [rolling, setRolling] = useState<{
    playerId: string;
    faces: [DieValue, DieValue];
  } | null>(null);
  const [autoMode, setAutoMode] = useState(false);

  const rollingLock = useRef(false);
  const rollTimeoutRef = useRef<number | null>(null);
  const rollIntervalRef = useRef<number | null>(null);
  const botActionRef = useRef<() => void>(() => {});
  const autoModeRef = useRef(autoMode);
  const previousLogLengthRef = useRef(0);
  const previousCurrentPlayerIdRef = useRef<string | null>(null);

  const currentPlayer = game.players[game.currentPlayerIndex];
  const currentProfile = currentPlayer
    ? profilesById.get(currentPlayer.id)
    : undefined;
  const isHumanTurn =
    game.phase !== "finished" && currentProfile?.id === setup.human.id;
  const humanControlled = isHumanTurn && !autoMode;

  const cancelRollAnimation = () => {
    if (rollTimeoutRef.current !== null) {
      window.clearTimeout(rollTimeoutRef.current);
      rollTimeoutRef.current = null;
    }
    if (rollIntervalRef.current !== null) {
      window.clearInterval(rollIntervalRef.current);
      rollIntervalRef.current = null;
    }
    rollingLock.current = false;
    setRolling(null);
  };

  useEffect(
    () => () => {
      if (rollTimeoutRef.current !== null) {
        window.clearTimeout(rollTimeoutRef.current);
      }
      if (rollIntervalRef.current !== null) {
        window.clearInterval(rollIntervalRef.current);
      }
    },
    [],
  );

  const handleRoll = useCallback(
    (
      durationMs = 750,
      source: "user" | "auto" = "user",
    ) => {
      if (rollingLock.current || game.phase !== "awaiting-roll") return;

      const rollDuration =
        typeof durationMs === "number" && Number.isFinite(durationMs)
          ? durationMs
          : 750;
      const faces = rollDice();
      const playerId = currentPlayer?.id;
      if (!playerId) return;

      feedback.roll(
        source === "user" && playerId === setup.human.id ? "human" : "bot",
      );

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setGame((current) =>
          current.phase === "awaiting-roll" ? roll(current, faces) : current,
        );
        return;
      }

      rollingLock.current = true;
      setRolling({ playerId, faces: rollDice() });

      rollIntervalRef.current = window.setInterval(() => {
        setRolling({ playerId, faces: rollDice() });
      }, 90);

      rollTimeoutRef.current = window.setTimeout(() => {
        if (rollIntervalRef.current !== null) {
          window.clearInterval(rollIntervalRef.current);
          rollIntervalRef.current = null;
        }
        rollTimeoutRef.current = null;
        rollingLock.current = false;
        setRolling(null);
        setGame((current) =>
          current.phase === "awaiting-roll" ? roll(current, faces) : current,
        );
      }, rollDuration);
    },
    [currentPlayer, feedback, game.phase, setup.human.id],
  );

  const handleChooseBarrier = useCallback((progress: number) => {
    setGame((current) =>
      current.phase === "awaiting-barrier"
        ? chooseBarrier(current, progress)
        : current,
    );
  }, []);

  const handleMove = useCallback((move: Move | BonusMove) => {
    setGame((current) => {
      try {
        if (current.phase === "awaiting-move" && !("kind" in move)) {
          return applyMove(current, move);
        }
        if (current.phase === "awaiting-bonus" && "kind" in move) {
          return applyBonusMove(current, move);
        }
      } catch (error) {
        console.error("Movimiento rechazado por el motor.", error);
      }
      return current;
    });
  }, []);

  const handleAutoChange = (next: boolean) => {
    if (next === autoMode) return;
    autoModeRef.current = next;
    if (!next) {
      // Regain the controls immediately: stop an in-flight auto roll. Any
      // pending scheduler timer is also stopped by the effect cleanup; the
      // bot action re-checks the ref so a timer firing in the same tick is safe.
      cancelRollAnimation();
    }
    setAutoMode(next);
    feedback.tap();
  };

  const handleReset = useCallback(() => {
    feedback.tap();
    cancelRollAnimation();
    setGame(createGame(setup.configs));
  }, [feedback, setup]);

  useEffect(() => {
    botActionRef.current = () => {
      const controlledByHuman =
        game.phase !== "finished" &&
        currentPlayer?.id === setup.human.id &&
        !autoModeRef.current;
      if (game.phase === "finished" || controlledByHuman || rolling) return;

      const playerId = currentPlayer?.id;
      if (!playerId) return;

      if (game.phase === "awaiting-roll") {
        handleRoll(1000, "auto");
        return;
      }

      if (game.phase === "awaiting-barrier") {
        const progress = chooseBotBarrier(game, playerId);
        if (progress !== null) handleChooseBarrier(progress);
        return;
      }

      if (game.phase === "awaiting-bonus") {
        const move = chooseBotBonusMove(game, playerId);
        if (move) handleMove(move);
        return;
      }

      if (game.phase === "awaiting-move") {
        const move = chooseBotMove(game, playerId);
        if (move) handleMove(move);
      }
    };
  }, [
    currentPlayer,
    game,
    handleChooseBarrier,
    handleMove,
    handleRoll,
    rolling,
    setup.human.id,
  ]);

  useEffect(() => {
    if (game.phase === "finished" || humanControlled || rolling !== null) return;

    const timer = window.setTimeout(() => botActionRef.current(), 1000);
    return () => window.clearTimeout(timer);
  }, [game, humanControlled, rolling]);

  useEffect(() => {
    const previousLogLength = previousLogLengthRef.current;
    previousLogLengthRef.current = game.log.length;

    const previousCurrentPlayerId = previousCurrentPlayerIdRef.current;
    const currentPlayerId =
      game.players[game.currentPlayerIndex]?.id ?? null;
    previousCurrentPlayerIdRef.current = currentPlayerId;

    if (game.log.length > previousLogLength) {
      feedback.events(game.log.slice(previousLogLength), setup.human.id, {
        haptics: !autoMode,
        automated: autoMode,
      });
    }

    if (
      !autoMode &&
      previousCurrentPlayerId !== null &&
      previousCurrentPlayerId !== setup.human.id &&
      currentPlayerId === setup.human.id &&
      game.phase !== "finished"
    ) {
      feedback.yourTurn();
    }
  }, [autoMode, feedback, game, setup.human.id]);

  const autoControl: GameStageAutoControl = {
    checked: autoMode,
    onChange: handleAutoChange,
  };

  const seats: readonly GamePlayerProfile[] = setup.seats;

  return (
    <GameStage
      state={game}
      viewColor={viewColor}
      humanPlayerId={setup.human.id}
      humanControlled={humanControlled}
      profiles={seats}
      modeLabel={setup.mode === "1v1" ? "1 vs 1" : "Todos contra todos"}
      rolling={rolling}
      feedback={feedback}
      onRoll={() => handleRoll()}
      onMove={handleMove}
      onChooseBarrier={handleChooseBarrier}
      onExit={() => router.push("/")}
      onNewGame={handleReset}
      onChangeMode={() => router.push("/")}
      autoControl={autoControl}
      playAgain={handleReset}
    />
  );
}
