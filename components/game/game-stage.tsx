"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  DrawablyBadge,
  DrawablyButton,
  DrawablyCard,
  DrawablyCheckbox,
  DrawablyHighlight,
} from "drawably/react";
import { ParchisBoard } from "@/components/game/parchis-board";
import { DiceCard } from "@/components/game/dice-card";
import { GameResultOverlay } from "@/components/game/game-result-overlay";
import type { GameFeedback } from "@/components/game/game-feedback";
import { PlayerPanel } from "@/components/game/player-panel";
import { SoundSettingsPopover } from "@/components/game/sound-settings-popover";
import type { GamePlayerProfile } from "@/components/game/game-players";
import {
  getBoardFrameLayout,
  getViewCorner,
  type BoardCorner,
  type ParchisColor,
} from "@/lib/parchis/board-geometry";
import {
  describeProgress,
  getBoardAnchorPercent,
  getDieViews,
  getLegalBonusMoves,
  getLegalMoves,
  getTokenViews,
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

export interface GameStageRolling {
  readonly playerId: string;
  readonly faces: readonly [DieValue, DieValue];
}

export interface GameStageAutoControl {
  readonly checked: boolean;
  onChange(next: boolean): void;
}

export interface GameStageProps {
  readonly state: GameState;
  /** Square colour of the viewer; the board rotates so their exit is bottom-left. */
  readonly viewColor: ParchisColor;
  /** The seat controlled on this device (local human, or the LAN role). */
  readonly humanPlayerId: string;
  /** True when this device may act for the current seat right now. */
  readonly humanControlled: boolean;
  readonly profiles: readonly GamePlayerProfile[];
  /** Short mode label in the header badge ("1 vs 1", "Todos contra todos"…). */
  readonly modeLabel: string;
  readonly rolling: GameStageRolling | null;
  readonly feedback: GameFeedback;
  onRoll(): void;
  onMove(move: Move | BonusMove): void;
  onChooseBarrier(progress: number): void;
  /** Leaves the match (home, or back to pairing). */
  onExit(): void;
  onNewGame?(): void;
  onChangeMode?(): void;
  /** Shown only when set; LAN games have no auto-play. */
  readonly autoControl?: GameStageAutoControl;
  /** Extra status line above the board (connection warnings, roles…). */
  readonly banner?: ReactNode;
  /**
   * Enables the "Jugar de nuevo" result button. `null`/absent hides it
   * (a LAN guest cannot restart the match).
   */
  readonly playAgain?: (() => void) | null;
  /** Marks the non-human seats as remote rivals rather than bots. */
  readonly remoteHuman?: boolean;
}

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

/**
 * The whole in-game screen: header, seat panels, dice, board, move popover,
 * sound settings and the result overlay. It is purely state-driven and owns no
 * game rules, so both the solo `/play` page and the LAN screen can mount it.
 */
export function GameStage({
  state,
  viewColor,
  humanPlayerId,
  humanControlled,
  profiles,
  modeLabel,
  rolling,
  feedback,
  onRoll,
  onMove,
  onChooseBarrier,
  onExit,
  onNewGame,
  onChangeMode,
  autoControl,
  banner,
  playAgain = null,
  remoteHuman = false,
}: GameStageProps) {
  const [menuTokenId, setMenuTokenId] = useState<string | null>(null);
  const [soundMenuOpen, setSoundMenuOpen] = useState(false);

  const profilesById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile] as const)),
    [profiles],
  );

  const legalMoves = getLegalMoves(state);
  const legalBonusMoves = getLegalBonusMoves(state);
  const currentPlayer = state.players[state.currentPlayerIndex];
  const currentProfile = currentPlayer
    ? profilesById.get(currentPlayer.id)
    : undefined;
  const humanProfile = profilesById.get(humanPlayerId);
  const winnerProfile = state.winnerId
    ? profilesById.get(state.winnerId)
    : undefined;

  const tokenViews = getTokenViews(state);
  const dieViews = getDieViews(state);

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
  const menuGap = menuToken ? (menuToken.radius + 0.5) * UNIT_PERCENT : 0;

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

  const handleMove = useCallback(
    (move: Move | BonusMove) => {
      setMenuTokenId(null);
      onMove(move);
    },
    [onMove],
  );

  const handleChooseBarrier = useCallback(
    (progress: number) => {
      setMenuTokenId(null);
      onChooseBarrier(progress);
    },
    [onChooseBarrier],
  );

  const handleTokenSelect = (tokenId: string) => {
    if (!humanControlled) return;
    setMenuTokenId(tokenId);
  };

  const closeSoundMenu = useCallback(() => {
    setSoundMenuOpen(false);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>("[data-sound-trigger]")
        ?.focus();
    });
  }, []);

  const gameResult =
    state.phase === "finished" && winnerProfile
      ? {
          humanWon: state.winnerId === humanPlayerId,
          winnerName: winnerProfile.name,
        }
      : null;

  const renderSeat = (profile: GamePlayerProfile) => {
    const dieView = dieViews.find((die) => die.playerId === profile.id);
    const active =
      state.phase !== "finished" && currentPlayer?.id === profile.id;
    const isRolling = rolling?.playerId === profile.id;
    const corner = getViewCorner(profile.color, viewColor);
    const bottom = corner.startsWith("bottom");
    const human = profile.id === humanPlayerId;
    const values: readonly [DieValue | null, DieValue | null] =
      dieView?.values ?? [null, null];
    const used: readonly [boolean, boolean] = dieView?.used ?? [false, false];

    const panel = (
      <PlayerPanel
        profile={profile}
        active={active}
        winner={state.winnerId === profile.id}
        human={human}
        remote={remoteHuman && !human}
        auto={human && Boolean(autoControl?.checked)}
      />
    );

    const diceCard = (
      <DiceCard
        state={state}
        profile={profile}
        viewColor={viewColor}
        values={values}
        used={used}
        active={active}
        human={human}
        controllable={human && humanControlled}
        auto={human && Boolean(autoControl?.checked)}
        rolling={isRolling}
        rollingFaces={isRolling ? (rolling?.faces ?? null) : null}
        onRoll={onRoll}
        onChooseBarrier={handleChooseBarrier}
      />
    );

    const autoToggle =
      human && autoControl ? (
        <label className="mx-auto flex w-fit cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1 text-xs font-medium text-stone-700">
          <DrawablyCheckbox
            checked={autoControl.checked}
            onChange={(event) => autoControl.onChange(event.target.checked)}
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
        {autoToggle}
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
                stroke={humanProfile?.accent ?? "var(--drawably-stroke)"}
                className="px-2 py-0.5 text-[11px]"
              >
                {modeLabel}
              </DrawablyBadge>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onChangeMode && (
            <DrawablyButton
              type="button"
              variant="outline"
              onClick={onChangeMode}
              className="flex select-none items-center gap-2 px-4 py-2.5 text-sm"
            >
              <HeaderIcon src="/button-icons/change-mode.png" />
              <span>Cambiar modo</span>
            </DrawablyButton>
          )}
          {onNewGame && (
            <DrawablyButton
              type="button"
              variant="outline"
              onClick={onNewGame}
              className="flex select-none items-center gap-2 px-4 py-2.5 text-sm"
            >
              <HeaderIcon src="/button-icons/new-game.png" />
              <span>Nueva partida</span>
            </DrawablyButton>
          )}
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
              onExit();
            }}
            className="flex select-none items-center gap-2 px-4 py-2.5 text-sm"
          >
            <HeaderIcon src="/button-icons/house.png" />
            <span>Volver al inicio</span>
          </DrawablyButton>
        </div>
      </div>

      {banner && (
        <div
          aria-live="polite"
          className="mx-auto mt-4 w-full max-w-7xl text-sm text-stone-600"
        >
          {banner}
        </div>
      )}

      <div className="mx-auto mt-5 grid w-full max-w-7xl grid-cols-2 gap-3 lg:grid-cols-[210px_minmax(0,1fr)_210px] lg:grid-rows-[auto_1fr]">
        <div className="order-3 col-span-2 min-w-0 lg:col-span-1 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="relative w-full">
            <div className="w-full overflow-hidden rounded-2xl shadow-[0_18px_45px_rgba(55,32,16,0.28)]">
              <ParchisBoard
                state={state}
                viewColor={viewColor}
                humanPlayerId={humanPlayerId}
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

        {profiles.map(renderSeat)}
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
          onPlayAgain={playAgain ?? undefined}
          onGoHome={() => {
            feedback.tap();
            onExit();
          }}
        />
      )}
    </main>
  );
}
