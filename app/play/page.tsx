"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  DrawablyBadge,
  DrawablyButton,
  DrawablyCard,
  DrawablyCheckbox,
  DrawablyHighlight,
} from "drawably/react";
import { ParchisBoard } from "@/components/game/parchis-board";
import {
  createGameSetup,
  getGameSettingsFromSearchParams,
  type GamePlayerProfile,
} from "@/components/game/game-players";
import { DiceCard } from "@/components/game/dice-card";
import { GameResultOverlay } from "@/components/game/game-result-overlay";
import { useGameFeedback } from "@/components/game/game-feedback";
import { PlayerPanel } from "@/components/game/player-panel";
import { SoundSettingsPopover } from "@/components/game/sound-settings-popover";
import {
  chooseBonusMove as chooseBotBonusMove,
  chooseBarrier as chooseBotBarrier,
  chooseMove as chooseBotMove,
} from "@/lib/bots/policy";
import {
  getBoardFrameLayout,
  getViewCorner,
  type BoardCorner,
  type ParchisColor,
} from "@/lib/parchis/board-geometry";
import {
  applyBonusMove,
  applyMove,
  chooseBarrier,
  createGame,
  describeProgress,
  getBoardAnchorPercent,
  getDieViews,
  getLegalBonusMoves,
  getLegalMoves,
  getTokenViews,
  roll,
  rollDice,
  type BoardPercentAnchor,
  type PresentedToken,
} from "@/lib/parchis";
import type {
  BonusMove,
  DieValue,
  GameState,
  Move,
} from "@/lib/parchis/types";

const UNIT_PERCENT = getBoardFrameLayout(100).unit;

const SEAT_CLASS: Readonly<Record<BoardCorner, string>> = Object.freeze({
  "top-left":
    "col-start-1 order-1 justify-start lg:col-start-1 lg:row-start-1 lg:self-start",
  "top-right":
    "col-start-2 order-2 justify-start lg:col-start-3 lg:row-start-1 lg:self-start",
  "bottom-left":
    "col-start-1 order-4 justify-end lg:col-start-1 lg:row-start-2 lg:self-end",
  "bottom-right":
    "col-start-2 order-5 justify-end lg:col-start-3 lg:row-start-2 lg:self-end",
});

function HeaderIcon({ src }: { src: string }) {
  return (
    <Image
      src={src}
      alt=""
      width={1536}
      height={1024}
      sizes="36px"
      aria-hidden="true"
      className="h-6 w-9 shrink-0 object-contain"
    />
  );
}

function tokenNumber(tokenId: string): number {
  const suffix = Number(tokenId.slice(tokenId.lastIndexOf("-") + 1));
  return Number.isFinite(suffix) ? suffix + 1 : 1;
}

function moveKey(move: Move | BonusMove): string {
  return "kind" in move
    ? `${move.tokenId}-${move.kind}-${move.to}`
    : `${move.tokenId}-${move.die}-${move.to}`;
}

function destinationPhrase(
  profile: GamePlayerProfile,
  to: number,
  viewColor: ParchisColor,
): string {
  const destination = describeProgress(profile.color, to, viewColor);
  return destination.startsWith("el ")
    ? `al ${destination.slice(3)}`
    : `a ${destination}`;
}

function moveActionLabel(
  profile: GamePlayerProfile,
  move: Move | BonusMove,
  viewColor: ParchisColor,
): string {
  if ("kind" in move) {
    return `Bono +${move.kind === "capture-20" ? 20 : 10}: mover ${destinationPhrase(
      profile,
      move.to,
      viewColor,
    )}`;
  }

  return `Mover ${move.die} ${destinationPhrase(profile, move.to, viewColor)}`;
}

function moveAriaLabel(
  profile: GamePlayerProfile,
  move: Move | BonusMove,
  viewColor: ParchisColor,
): string {
  return `Ficha ${tokenNumber(move.tokenId)}: ${moveActionLabel(
    profile,
    move,
    viewColor,
  )}`;
}

function MovePopover({
  profile,
  tokenId,
  moves,
  anchor,
  gapPercent,
  viewColor,
  onMove,
  onClose,
}: {
  profile: GamePlayerProfile;
  tokenId: string;
  moves: readonly (Move | BonusMove)[];
  anchor: BoardPercentAnchor;
  gapPercent: number;
  viewColor: ParchisColor;
  onMove: (move: Move | BonusMove) => void;
  onClose: () => void;
}) {
  const above = anchor.top > 40;
  const top = above ? anchor.top - gapPercent : anchor.top + gapPercent;

  return (
    <div
      data-move-menu
      role="dialog"
      aria-label={`Movimientos de la ficha ${tokenNumber(tokenId)}`}
      className="pointer-events-auto absolute z-50 w-52"
      style={{
        left: `clamp(6.5rem, ${anchor.left}%, calc(100% - 6.5rem))`,
        top: `${top}%`,
        transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
      }}
    >
      <DrawablyCard
        className="select-none p-4 shadow-[0_12px_30px_rgba(45,28,12,0.28)]"
        style={
          {
            "--drawably-stroke": profile.accent,
            background: `color-mix(in srgb, ${profile.accent} 7%, var(--drawably-paper))`,
          } as CSSProperties
        }
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold">
            Ficha {tokenNumber(tokenId)}
          </p>
          <DrawablyButton
            type="button"
            variant="outline"
            onClick={onClose}
            aria-label="Cerrar movimientos"
            className="select-none px-2 py-0 text-[11px]"
          >
            ×
          </DrawablyButton>
        </div>

        <div className="mt-2 flex flex-col gap-1.5">
          {moves.map((move) => (
            <DrawablyButton
              key={moveKey(move)}
              type="button"
              variant="outline"
              onClick={() => onMove(move)}
              className="w-full select-none px-2 py-1.5 text-left text-xs"
            >
              {moveActionLabel(profile, move, viewColor)}
            </DrawablyButton>
          ))}
        </div>
      </DrawablyCard>
    </div>
  );
}

/**
 * Invisible focus targets over each legal chip. Pointer input is handled by
 * Pixi (the popover); keyboard and screen-reader users can tab to these and
 * activate the move directly.
 */
function KeyboardMoveTargets({
  profile,
  moves,
  tokens,
  viewColor,
  onMove,
}: {
  profile: GamePlayerProfile;
  moves: readonly (Move | BonusMove)[];
  tokens: readonly PresentedToken[];
  viewColor: ParchisColor;
  onMove: (move: Move | BonusMove) => void;
}) {
  if (moves.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Movimientos disponibles"
      className="pointer-events-none absolute inset-0"
    >
      {moves.map((move) => {
        const token = tokens.find((item) => item.id === move.tokenId);
        if (!token) return null;
        const anchor = getBoardAnchorPercent(token.anchor, viewColor);

        return (
          <button
            key={moveKey(move)}
            type="button"
            onClick={() => onMove(move)}
            aria-label={moveAriaLabel(profile, move, viewColor)}
            className="pointer-events-none absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 select-none rounded-full focus:ring-2 focus:ring-stone-800 focus:ring-offset-2"
            style={{ left: `${anchor.left}%`, top: `${anchor.top}%` }}
          />
        );
      })}
    </div>
  );
}

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
  const [menuTokenId, setMenuTokenId] = useState<string | null>(null);
  const [rolling, setRolling] = useState<{
    playerId: string;
    faces: [DieValue, DieValue];
  } | null>(null);
  const [autoMode, setAutoMode] = useState(false);
  const [soundMenuOpen, setSoundMenuOpen] = useState(false);

  const rollingLock = useRef(false);
  const rollTimeoutRef = useRef<number | null>(null);
  const rollIntervalRef = useRef<number | null>(null);
  const botActionRef = useRef<() => void>(() => {});
  const autoModeRef = useRef(autoMode);
  const previousLogLengthRef = useRef(0);
  const previousCurrentPlayerIdRef = useRef<string | null>(null);

  const legalMoves = getLegalMoves(game);
  const legalBonusMoves = getLegalBonusMoves(game);
  const currentPlayer = game.players[game.currentPlayerIndex];
  const currentProfile = currentPlayer
    ? profilesById.get(currentPlayer.id)
    : undefined;
  const isHumanTurn =
    game.phase !== "finished" && currentProfile?.id === setup.human.id;
  const humanControlled = isHumanTurn && !autoMode;
  const winnerProfile = game.winnerId
    ? profilesById.get(game.winnerId)
    : undefined;
  const gameResult =
    game.phase === "finished"
      ? {
          humanWon: game.winnerId === setup.human.id,
          winnerName: winnerProfile?.name ?? "",
        }
      : null;

  const tokenViews = getTokenViews(game);
  const dieViews = getDieViews(game);

  const allMoves = [...legalMoves, ...legalBonusMoves];
  const menuMoves = menuTokenId
    ? allMoves.filter((move) => move.tokenId === menuTokenId)
    : [];
  const menuToken = menuTokenId
    ? tokenViews.find((token) => token.id === menuTokenId)
    : undefined;
  const menuAnchor = menuToken
    ? getBoardAnchorPercent(menuToken.anchor, viewColor)
    : null;
  const menuGap = menuToken
    ? (menuToken.radius + 0.5) * UNIT_PERCENT
    : 0;

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

  useEffect(() => {
    if (!menuTokenId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuTokenId(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-move-menu]")) return;
      setMenuTokenId(null);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuTokenId]);

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
      setMenuTokenId(null);

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
    setMenuTokenId(null);
    setGame((current) =>
      current.phase === "awaiting-barrier"
        ? chooseBarrier(current, progress)
        : current,
    );
  }, []);

  const handleMove = useCallback((move: Move | BonusMove) => {
    setMenuTokenId(null);
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

  const closeSoundMenu = useCallback(() => {
    setSoundMenuOpen(false);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>("[data-sound-trigger]")
        ?.focus();
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
    setMenuTokenId(null);
    setAutoMode(next);
    feedback.tap();
  };

  const handleReset = () => {
    feedback.tap();
    cancelRollAnimation();
    setMenuTokenId(null);
    setSoundMenuOpen(false);
    setGame(createGame(setup.configs));
  };

  const handleTokenSelect = (tokenId: string) => {
    if (!humanControlled) return;
    setMenuTokenId(tokenId);
  };

  useEffect(() => {
    botActionRef.current = () => {
      const controlledByHuman =
        game.phase !== "finished" &&
        currentPlayer?.id === setup.human.id &&
        !autoModeRef.current;
      if (game.phase === "finished" || controlledByHuman || rolling) return;

      const playerId = currentPlayer?.id;
      if (!playerId) return;

      setMenuTokenId(null);

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
    humanControlled,
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

  const renderSeat = (profile: GamePlayerProfile) => {
    const dieView = dieViews.find((die) => die.playerId === profile.id);
    const active =
      game.phase !== "finished" && currentPlayer?.id === profile.id;
    const isRolling = rolling?.playerId === profile.id;
    const corner = getViewCorner(profile.color, viewColor);
    const bottom = corner.startsWith("bottom");
    const human = profile.id === setup.human.id;
    const values: readonly [DieValue | null, DieValue | null] =
      dieView?.values ?? [null, null];
    const used: readonly [boolean, boolean] = dieView?.used ?? [false, false];

    const panel = (
      <PlayerPanel
        profile={profile}
        active={active}
        winner={game.winnerId === profile.id}
        human={human}
        auto={human && autoMode}
      />
    );

    const diceCard = (
      <DiceCard
        state={game}
        profile={profile}
        viewColor={viewColor}
        values={values}
        used={used}
        active={active}
        human={human}
        controllable={human && !autoMode}
        rolling={isRolling}
        rollingFaces={isRolling ? (rolling?.faces ?? null) : null}
        onRoll={handleRoll}
        onChooseBarrier={handleChooseBarrier}
      />
    );

    const autoControl = human ? (
      <label className="mx-auto flex w-fit cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1 text-xs font-medium text-stone-700">
        <DrawablyCheckbox
          checked={autoMode}
          onChange={(event) => handleAutoChange(event.target.checked)}
          className="shrink-0"
        />
        <span>Modo automático</span>
      </label>
    ) : null;

    return (
      <div
        key={profile.id}
        data-seat={profile.id}
        data-corner={corner}
        className={`flex min-w-0 flex-col gap-2 ${SEAT_CLASS[corner]}`}
      >
        {human && autoControl}
        {bottom ? diceCard : panel}
        {bottom ? panel : diceCard}
      </div>
    );
  };

  return (
    <main className="flex min-h-dvh flex-col px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Image
            src="/icon.png"
            alt=""
            width={48}
            height={48}
            priority
            className="h-11 w-11 object-contain mix-blend-multiply sm:h-12 sm:w-12"
          />
          <div>
            <DrawablyBadge
              stroke="var(--parchis-red)"
              className="px-2.5 py-0.5 text-xs"
            >
              Parchís Stars
            </DrawablyBadge>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              <DrawablyHighlight fill="var(--parchis-yellow)" boil={0.18}>
                Tablero de Parchís
              </DrawablyHighlight>
            </h1>
            <div className="mt-1">
              <DrawablyBadge
                stroke={setup.human.accent}
                className="px-2 py-0.5 text-[11px]"
              >
                {setup.mode === "1v1" ? "1 vs 1" : "Todos contra todos"}
              </DrawablyBadge>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form action="/alone" method="get">
            <DrawablyButton
              type="submit"
              variant="outline"
              onClick={() => feedback.tap()}
              className="flex select-none items-center gap-2 px-4 py-2.5 text-sm"
            >
              <HeaderIcon src="/button-icons/change-mode.png" />
              <span>Cambiar modo</span>
            </DrawablyButton>
          </form>
          <DrawablyButton
            type="button"
            variant="outline"
            onClick={handleReset}
            className="flex select-none items-center gap-2 px-4 py-2.5 text-sm"
          >
            <HeaderIcon src="/button-icons/new-game.png" />
            <span>Nueva partida</span>
          </DrawablyButton>
          <DrawablyButton
            type="button"
            variant="outline"
            data-sound-trigger
            aria-label="Ajustes de sonido"
            aria-haspopup="dialog"
            aria-expanded={soundMenuOpen}
            aria-controls="sound-settings-dialog"
            onClick={() => {
              setSoundMenuOpen(true);
              feedback.tap();
            }}
            className="flex select-none items-center gap-2 px-4 py-2.5 text-sm"
          >
            <HeaderIcon src="/button-icons/sound.png" />
            <span>Sonido</span>
          </DrawablyButton>
          <DrawablyButton
            type="button"
            variant="outline"
            onClick={() => {
              feedback.tap();
              router.push("/");
            }}
            className="flex select-none items-center gap-2 px-4 py-2.5 text-sm"
          >
            <HeaderIcon src="/button-icons/house.png" />
            <span>Volver al inicio</span>
          </DrawablyButton>
        </div>
      </div>

      <div className="mx-auto mt-5 grid w-full max-w-7xl grid-cols-2 gap-3 lg:grid-cols-[210px_minmax(0,1fr)_210px] lg:grid-rows-[auto_1fr]">
        <div className="order-3 col-span-2 min-w-0 lg:col-span-1 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="relative w-full">
            <div className="w-full overflow-hidden rounded-2xl shadow-[0_18px_45px_rgba(55,32,16,0.28)]">
              <ParchisBoard
                state={game}
                viewColor={viewColor}
                humanPlayerId={setup.human.id}
                humanControlled={humanControlled}
                onTokenSelect={handleTokenSelect}
              />
            </div>

            {humanControlled && currentProfile && (
              <KeyboardMoveTargets
                profile={currentProfile}
                moves={allMoves}
                tokens={tokenViews}
                viewColor={viewColor}
                onMove={handleMove}
              />
            )}

            {humanControlled &&
              currentProfile &&
              menuToken &&
              menuAnchor &&
              menuMoves.length > 0 && (
                <MovePopover
                  profile={currentProfile}
                  tokenId={menuToken.id}
                  moves={menuMoves}
                  anchor={menuAnchor}
                  gapPercent={menuGap}
                  viewColor={viewColor}
                  onMove={handleMove}
                  onClose={() => setMenuTokenId(null)}
                />
              )}
          </div>
        </div>

        {setup.seats.map(renderSeat)}
      </div>

      {soundMenuOpen && !gameResult && (
        <SoundSettingsPopover
          muted={feedback.soundMuted}
          onToggle={feedback.setSoundMuted}
          onToggleAll={feedback.setAllSoundsMuted}
          onClose={closeSoundMenu}
        />
      )}

      {gameResult && (
        <GameResultOverlay
          humanWon={gameResult.humanWon}
          winnerName={gameResult.winnerName}
          onPlayAgain={handleReset}
          onGoHome={() => {
            feedback.tap();
            router.push("/");
          }}
        />
      )}
    </main>
  );
}
