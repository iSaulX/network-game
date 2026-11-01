"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  DrawablyBadge,
  DrawablyButton,
  DrawablyCard,
  DrawablyHighlight,
} from "drawably/react";
import { AvatarVisual } from "@/components/avatar-visual";
import { ParchisBoard } from "@/components/game/parchis-board";
import {
  GAME_PLAYERS,
  GAME_PLAYER_CONFIGS,
  HUMAN_PROFILE,
  getPlayerProfile,
  type GamePlayerProfile,
} from "@/components/game/game-players";
import { DiceCard } from "@/components/game/dice-card";
import { PlayerPanel } from "@/components/game/player-panel";
import {
  getBoardFrameLayout,
  getViewCorner,
  type BoardCorner,
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

/** The human always sits bottom-left; the board and the rest rotate around it. */
const VIEW_COLOR = HUMAN_PROFILE.color;

const SEAT_CLASS: Readonly<Record<BoardCorner, string>> = Object.freeze({
  "top-left":
    "order-1 justify-start lg:col-start-1 lg:row-start-1 lg:self-start",
  "top-right":
    "order-2 justify-start lg:col-start-3 lg:row-start-1 lg:self-start",
  "bottom-left":
    "order-4 justify-end lg:col-start-1 lg:row-start-2 lg:self-end",
  "bottom-right":
    "order-5 justify-end lg:col-start-3 lg:row-start-2 lg:self-end",
});

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
  viewColor: typeof VIEW_COLOR,
): string {
  const destination = describeProgress(profile.color, to, viewColor);
  return destination.startsWith("el ")
    ? `al ${destination.slice(3)}`
    : `a ${destination}`;
}

function moveActionLabel(
  profile: GamePlayerProfile,
  move: Move | BonusMove,
  viewColor: typeof VIEW_COLOR,
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
  viewColor: typeof VIEW_COLOR,
): string {
  return `Ficha ${tokenNumber(move.tokenId)}: ${moveActionLabel(
    profile,
    move,
    viewColor,
  )}`;
}

function WinnerPanel({
  profile,
  onReset,
}: {
  profile: GamePlayerProfile;
  onReset: () => void;
}) {
  const style = {
    "--drawably-stroke": profile.accent,
    background: `color-mix(in srgb, ${profile.accent} 12%, var(--drawably-paper))`,
  } as CSSProperties;

  return (
    <DrawablyCard
      className="mt-3 select-none p-5"
      style={style}
      aria-live="assertive"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="rounded-full p-0.5"
            style={{ border: `2px solid ${profile.accent}` }}
          >
            <AvatarVisual image={profile.avatar} size="sm" />
          </span>
          <div>
            <p className="text-sm font-semibold">
              ¡{profile.name} gana la partida!
            </p>
            <p className="text-xs text-stone-600">
              Sus cuatro fichas llegaron a la meta.
            </p>
          </div>
        </div>

        <DrawablyButton
          type="button"
          variant="solid"
          onClick={onReset}
          className="select-none px-4 py-2 text-sm"
        >
          Jugar de nuevo
        </DrawablyButton>
      </div>
    </DrawablyCard>
  );
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
  viewColor: typeof VIEW_COLOR;
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
  viewColor: typeof VIEW_COLOR;
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

export default function PlayPage() {
  const router = useRouter();
  const [game, setGame] = useState<GameState>(() =>
    createGame(GAME_PLAYER_CONFIGS),
  );
  const [menuTokenId, setMenuTokenId] = useState<string | null>(null);
  const [rolling, setRolling] = useState<{
    playerId: string;
    faces: [DieValue, DieValue];
  } | null>(null);

  const rollingLock = useRef(false);
  const rollTimeoutRef = useRef<number | null>(null);
  const rollIntervalRef = useRef<number | null>(null);

  const legalMoves = getLegalMoves(game);
  const legalBonusMoves = getLegalBonusMoves(game);
  const currentPlayer = game.players[game.currentPlayerIndex];
  const currentProfile = currentPlayer
    ? getPlayerProfile(currentPlayer.id)
    : undefined;
  const winnerProfile = game.winnerId
    ? getPlayerProfile(game.winnerId)
    : undefined;

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
    ? getBoardAnchorPercent(menuToken.anchor, VIEW_COLOR)
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

  const handleRoll = () => {
    if (rollingLock.current || game.phase !== "awaiting-roll") return;

    const faces = rollDice();
    const playerId = currentPlayer?.id;
    if (!playerId) return;

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
    }, 750);
  };

  const handleChooseBarrier = (progress: number) => {
    setMenuTokenId(null);
    setGame((current) =>
      current.phase === "awaiting-barrier"
        ? chooseBarrier(current, progress)
        : current,
    );
  };

  const handleMove = (move: Move | BonusMove) => {
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
  };

  const handleReset = () => {
    cancelRollAnimation();
    setMenuTokenId(null);
    setGame(createGame(GAME_PLAYER_CONFIGS));
  };

  const renderSeat = (profile: GamePlayerProfile) => {
    const dieView = dieViews.find((die) => die.playerId === profile.id);
    const active =
      game.phase !== "finished" && currentPlayer?.id === profile.id;
    const isRolling = rolling?.playerId === profile.id;
    const corner = getViewCorner(profile.color, VIEW_COLOR);
    const bottom = corner.startsWith("bottom");
    const human = profile.id === HUMAN_PROFILE.id;
    const values: readonly [DieValue | null, DieValue | null] =
      dieView?.values ?? [null, null];
    const used: readonly [boolean, boolean] = dieView?.used ?? [false, false];

    const panel = (
      <PlayerPanel
        profile={profile}
        active={active}
        winner={game.winnerId === profile.id}
        human={human}
      />
    );

    const diceCard = (
      <DiceCard
        state={game}
        profile={profile}
        viewColor={VIEW_COLOR}
        values={values}
        used={used}
        active={active}
        human={human}
        rolling={isRolling}
        rollingFaces={isRolling ? (rolling?.faces ?? null) : null}
        onRoll={handleRoll}
        onChooseBarrier={handleChooseBarrier}
      />
    );

    return (
      <div
        key={profile.id}
        data-seat={profile.id}
        data-corner={corner}
        className={`flex min-w-0 flex-col gap-2 ${SEAT_CLASS[corner]}`}
      >
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
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DrawablyButton
            type="button"
            variant="outline"
            onClick={handleReset}
            className="select-none px-4 py-2.5 text-sm"
          >
            Nueva partida
          </DrawablyButton>
          <DrawablyButton
            type="button"
            variant="outline"
            onClick={() => router.push("/")}
            className="select-none px-4 py-2.5 text-sm"
          >
            Volver al inicio
          </DrawablyButton>
        </div>
      </div>

      <div className="mx-auto mt-5 grid w-full max-w-7xl grid-cols-2 gap-3 lg:grid-cols-[210px_minmax(0,1fr)_210px] lg:grid-rows-[auto_1fr]">
        <div className="order-3 col-span-2 min-w-0 lg:col-span-1 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="relative w-full">
            <div className="w-full overflow-hidden rounded-2xl shadow-[0_18px_45px_rgba(55,32,16,0.28)]">
              <ParchisBoard
                state={game}
                viewColor={VIEW_COLOR}
                onTokenSelect={setMenuTokenId}
              />
            </div>

            {currentProfile && (
              <KeyboardMoveTargets
                profile={currentProfile}
                moves={allMoves}
                tokens={tokenViews}
                viewColor={VIEW_COLOR}
                onMove={handleMove}
              />
            )}

            {currentProfile &&
              menuToken &&
              menuAnchor &&
              menuMoves.length > 0 && (
                <MovePopover
                  profile={currentProfile}
                  tokenId={menuToken.id}
                  moves={menuMoves}
                  anchor={menuAnchor}
                  gapPercent={menuGap}
                  viewColor={VIEW_COLOR}
                  onMove={handleMove}
                  onClose={() => setMenuTokenId(null)}
                />
              )}
          </div>

          {winnerProfile && (
            <WinnerPanel profile={winnerProfile} onReset={handleReset} />
          )}
        </div>

        {GAME_PLAYERS.map(renderSeat)}
      </div>
    </main>
  );
}
