/**
 * Sound categories exposed by the in-game sound settings popover.
 *
 * Checkbox state is "muted": checked means that category is silenced. The
 * default is all categories unmuted.
 */
export type SoundName =
  | "select"
  | "tap"
  | "start"
  | "roll"
  | "roll-bot"
  | "move"
  | "move-bot"
  | "capture"
  | "capture-bot"
  | "goal"
  | "goal-bot"
  | "barrier"
  | "barrier-bot"
  | "warning"
  | "warning-bot"
  | "entry"
  | "win"
  | "lose"
  | "your-turn";

export const SOUND_CATEGORIES = [
  "interface",
  "dice",
  "move",
  "entry",
  "capture",
  "barrier",
  "goal",
  "warning",
  "result",
  "turn",
] as const;

export type SoundCategory = (typeof SOUND_CATEGORIES)[number];

export const SOUND_CATEGORY_LABELS: Readonly<
  Record<SoundCategory, string>
> = {
  interface: "Interfaz",
  dice: "Dados",
  move: "Movimiento",
  entry: "Entrada de ficha",
  capture: "Capturas",
  barrier: "Barreras",
  goal: "Meta",
  warning: "Avisos",
  result: "Victoria y derrota",
  turn: "Tu turno",
};

export const SOUND_CATEGORY_BY_NAME: Readonly<
  Record<SoundName, SoundCategory>
> = {
  select: "interface",
  tap: "interface",
  start: "interface",
  roll: "dice",
  "roll-bot": "dice",
  move: "move",
  "move-bot": "move",
  entry: "entry",
  capture: "capture",
  "capture-bot": "capture",
  barrier: "barrier",
  "barrier-bot": "barrier",
  goal: "goal",
  "goal-bot": "goal",
  warning: "warning",
  "warning-bot": "warning",
  win: "result",
  lose: "result",
  "your-turn": "turn",
};

export type MutedSounds = Record<SoundCategory, boolean>;

export function createMutedSounds(muted = false): MutedSounds {
  return {
    interface: muted,
    dice: muted,
    move: muted,
    entry: muted,
    capture: muted,
    barrier: muted,
    goal: muted,
    warning: muted,
    result: muted,
    turn: muted,
  };
}

export function areAllSoundsMuted(
  muted: Readonly<Record<SoundCategory, boolean>>,
): boolean {
  return SOUND_CATEGORIES.every((category) => muted[category]);
}
