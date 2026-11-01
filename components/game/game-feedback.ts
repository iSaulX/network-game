"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import {
  getFeedbackCue,
  type FeedbackActor,
  type FeedbackEvent,
} from "./game-feedback-cues";
import {
  SOUND_CATEGORIES,
  SOUND_CATEGORY_BY_NAME,
  createMutedSounds,
  type SoundCategory,
  type SoundName,
} from "./game-sound-settings";

type SampleName = "dice-roll" | "click";

/** The two supplied MP3s replace the synthesized dice/movement cues. */
const SAMPLE_SOUNDS: Partial<
  Record<SoundName, { name: SampleName; volume: number }>
> = {
  roll: { name: "dice-roll", volume: 0.6 },
  "roll-bot": { name: "dice-roll", volume: 0.32 },
  move: { name: "click", volume: 0.55 },
  "move-bot": { name: "click", volume: 0.28 },
};

/**
 * Game sound palette: the owner-supplied dice/movement MP3s plus short Web
 * Audio envelopes for the remaining events. No network requests beyond the two
 * static `/sounds` files; unsupported/blocked audio never affects the game.
 */
class GameSoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private samples: Map<SampleName, HTMLAudioElement> | null = null;
  private mutedSounds = new Set<SoundCategory>();
  private unlocked = false;

  /** Load the two small clips while the page starts, so a tap is immediate. */
  preload(): void {
    if (typeof window === "undefined" || this.samples) return;

    try {
      const samples = new Map<SampleName, HTMLAudioElement>();
      for (const name of ["dice-roll", "click"] as const) {
        const audio = new Audio(`/sounds/${name}.mp3`);
        audio.preload = "auto";
        audio.load();
        samples.set(name, audio);
      }
      this.samples = samples;
    } catch {
      // The synthesized palette still works if the clips cannot be created.
      this.samples = null;
    }
  }

  /** Apply the popover's per-category mute choices. */
  setMutedSounds(muted: Readonly<Record<SoundCategory, boolean>>): void {
    this.mutedSounds = new Set(
      SOUND_CATEGORIES.filter((category) => muted[category]),
    );

    try {
      if (this.mutedSounds.has("dice")) {
        this.samples?.get("dice-roll")?.pause();
      }
      if (this.mutedSounds.has("move")) {
        this.samples?.get("click")?.pause();
      }
    } catch {
      // Sound is optional; muting must never interfere with the game.
    }
  }

  /** Called from the first pointer/keyboard gesture; keeps bots silent before it. */
  unlock(): void {
    this.unlocked = true;
    const context = this.ensure();
    if (!context) return;
    if (context.state === "suspended") {
      void context.resume().catch(() => {});
    }
  }

  play(name: SoundName): void {
    // Never schedule before a gesture: mobile browsers would queue sounds and
    // replay a burst on the first interaction.
    if (!this.unlocked || this.mutedSounds.has(SOUND_CATEGORY_BY_NAME[name])) {
      return;
    }

    const sample = SAMPLE_SOUNDS[name];
    if (sample) {
      this.playSample(sample.name, sample.volume);
      return;
    }

    const context = this.ensure();
    const master = this.master;
    if (!context || !master) return;

    if (context.state === "suspended") {
      void context.resume().catch(() => {});
    }

    switch (name) {
      case "select":
        this.tone(880, 0, 0.03, "triangle", 0.035);
        break;
      case "tap":
        this.tone(520, 0, 0.045, "sine", 0.04);
        break;
      case "start":
        this.tone(392, 0, 0.07, "triangle", 0.045);
        this.tone(587, 0.075, 0.1, "triangle", 0.04);
        break;
      case "capture":
        this.noise(0, 0.12, 0.08, 900);
        this.tone(150, 0.01, 0.16, "sawtooth", 0.045, 70);
        break;
      case "capture-bot":
        this.noise(0, 0.1, 0.045, 900);
        this.tone(150, 0.01, 0.13, "sawtooth", 0.025, 70);
        break;
      case "goal":
        this.tone(523, 0, 0.1, "triangle", 0.045);
        this.tone(659, 0.09, 0.12, "triangle", 0.045);
        this.tone(784, 0.19, 0.18, "triangle", 0.045);
        break;
      case "goal-bot":
        this.tone(523, 0, 0.08, "triangle", 0.022);
        this.tone(659, 0.08, 0.1, "triangle", 0.022);
        break;
      case "barrier":
        this.tone(120, 0, 0.14, "sine", 0.055, 90);
        this.noise(0.02, 0.06, 0.035, 600);
        break;
      case "barrier-bot":
        this.tone(120, 0, 0.12, "sine", 0.025, 90);
        break;
      case "warning":
        this.tone(300, 0, 0.1, "triangle", 0.045);
        this.tone(220, 0.12, 0.16, "triangle", 0.04);
        break;
      case "warning-bot":
        this.tone(300, 0, 0.08, "triangle", 0.022);
        break;
      case "entry":
        this.tone(660, 0, 0.055, "sine", 0.03);
        break;
      case "win":
        this.tone(523, 0, 0.18, "triangle", 0.06);
        this.tone(659, 0.1, 0.18, "triangle", 0.06);
        this.tone(784, 0.2, 0.2, "triangle", 0.06);
        this.tone(1047, 0.32, 0.35, "triangle", 0.055);
        break;
      case "lose":
        this.tone(330, 0, 0.14, "triangle", 0.04);
        this.tone(262, 0.12, 0.16, "triangle", 0.035);
        this.tone(196, 0.25, 0.25, "triangle", 0.03);
        break;
      case "your-turn":
        this.tone(659, 0, 0.075, "sine", 0.03);
        this.tone(880, 0.085, 0.12, "sine", 0.025);
        break;
    }
  }

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;

    if (!this.context) {
      const AudioContextClass =
        window.AudioContext ??
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;

      if (!AudioContextClass) return null;

      try {
        const context = new AudioContextClass();
        const master = context.createGain();
        master.gain.value = 0.28;
        master.connect(context.destination);
        this.context = context;
        this.master = master;
      } catch {
        // Audio is an enhancement; keep the game silent if it is unavailable.
        return null;
      }
    }

    return this.context;
  }

  private playSample(name: SampleName, volume: number): void {
    const audio = this.samples?.get(name);
    if (!audio) return;

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = volume;
      void audio.play().catch(() => {});
    } catch {
      // Media playback is optional and can be blocked by the browser.
    }
  }

  private tone(
    frequency: number,
    at: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    endFrequency?: number,
  ): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;

    const start = context.currentTime + at;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, endFrequency),
        start + duration,
      );
    }

    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  private noise(
    at: number,
    duration: number,
    gain: number,
    filterFrequency: number,
  ): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;

    if (!this.noiseBuffer) {
      const length = Math.floor(context.sampleRate * 0.5);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < length; index += 1) {
        data[index] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }

    const start = context.currentTime + at;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();

    source.buffer = this.noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.value = filterFrequency;
    filter.Q.value = 0.8;

    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(master);
    source.start(start);
    source.stop(start + duration + 0.02);
  }
}

const sounds = new GameSoundEngine();

export interface GameFeedback {
  /** A discrete colour/avatar/tab choice. */
  select: () => void;
  /** A secondary navigation/restart action. */
  tap: () => void;
  /** Starting a mode/game. */
  start: () => void;
  /** A dice throw; humans get the haptic, bots only the quieter clip. */
  roll: (actor: FeedbackActor) => void;
  /** Coalesced state-event feedback; automation can suppress haptics. */
  events: (
    newEvents: readonly FeedbackEvent[],
    humanId: string,
    options?: { haptics?: boolean; automated?: boolean },
  ) => void;
  /** Soft chime when it becomes the human's turn. */
  yourTurn: () => void;
  /** Per-category sound mute flags; checked UI state means muted. */
  soundMuted: Readonly<Record<SoundCategory, boolean>>;
  setSoundMuted: (category: SoundCategory, muted: boolean) => void;
  setAllSoundsMuted: (muted: boolean) => void;
}

/**
 * Shared game feedback hook. Haptics supplement the visual state change and
 * are reserved for human actions or meaningful consequences to the human;
 * bots contribute sounds only. The supplied dice/move clips and the
 * synthesized cues are optional; the game works with no audio at all.
 */
export function useGameFeedback(): GameFeedback {
  const { trigger } = useWebHaptics();
  const [soundMuted, setSoundMutedState] = useState<
    Record<SoundCategory, boolean>
  >(() => createMutedSounds());

  const setSoundMuted = useCallback(
    (category: SoundCategory, muted: boolean) => {
      setSoundMutedState((current) =>
        current[category] === muted
          ? current
          : { ...current, [category]: muted },
      );
    },
    [],
  );

  const setAllSoundsMuted = useCallback((muted: boolean) => {
    setSoundMutedState((current) =>
      SOUND_CATEGORIES.every((category) => current[category] === muted)
        ? current
        : createMutedSounds(muted),
    );
  }, []);

  useEffect(() => {
    sounds.setMutedSounds(soundMuted);
  }, [soundMuted]);

  useEffect(() => {
    sounds.preload();
    const unlock = () => sounds.unlock();
    window.addEventListener("pointerdown", unlock, {
      once: true,
      capture: true,
    });
    window.addEventListener("keydown", unlock, {
      once: true,
      capture: true,
    });

    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, []);

  return useMemo(() => {
    // Haptics are optional: a rejected/unsupported vibration must never stop
    // the game action that triggered it.
    const fire = (input: string) => {
      try {
        const result = trigger(input);
        if (result) void result.catch(() => {});
      } catch {
        // No Vibration API, or the browser rejected the pattern.
      }
    };

    return {
      select() {
        fire("selection");
        sounds.play("select");
      },
      tap() {
        fire("light");
        sounds.play("tap");
      },
      start() {
        fire("medium");
        sounds.play("start");
      },
      roll(actor: FeedbackActor) {
        if (actor === "human") {
          fire("medium");
          sounds.play("roll");
        } else {
          sounds.play("roll-bot");
        }
      },
      events(
        newEvents: readonly FeedbackEvent[],
        humanId: string,
        options: { haptics?: boolean; automated?: boolean } = {},
      ) {
        const haptics = options.haptics ?? true;
        const automated = options.automated ?? false;
        const haptic = (input: string) => {
          if (haptics) fire(input);
        };

        // Any actual chip movement gets the supplied click clip, including
        // captures, goals and barrier breaks. Automatic entries do not.
        const movement = newEvents.find(
          (event) =>
            event.type === "advance" ||
            event.type === "bonus-move" ||
            event.type === "barrier-break",
        );
        if (movement) {
          sounds.play(
            automated
              ? "move-bot"
              : movement.playerId === humanId
                ? "move"
                : "move-bot",
          );
        }

        const cue = getFeedbackCue(newEvents, humanId);
        if (!cue) return;

        switch (cue.type) {
          case "win":
            if (cue.actor === "human") {
              haptic("success");
              sounds.play("win");
            } else {
              haptic("warning");
              sounds.play("lose");
            }
            return;
          case "capture":
            if (cue.outcome === "victim") {
              haptic("warning");
              sounds.play("warning");
            } else if (cue.outcome === "human") {
              haptic("heavy");
              sounds.play("capture");
            } else {
              sounds.play("capture-bot");
            }
            return;
          case "goal":
            if (cue.actor === "human") {
              haptic("success");
              sounds.play("goal");
            } else {
              sounds.play("goal-bot");
            }
            return;
          case "three-doubles":
            if (cue.actor === "human") {
              haptic("warning");
              sounds.play("warning");
            } else {
              sounds.play("warning-bot");
            }
            return;
          case "barrier":
            if (cue.actor === "human") {
              haptic("medium");
              sounds.play("barrier");
            } else {
              sounds.play("barrier-bot");
            }
            return;
          case "move":
            if (cue.actor === "human") {
              haptic("medium");
            }
            return;
          case "entry":
            sounds.play("entry");
            return;
          case "roll":
            return;
        }
      },
      yourTurn() {
        sounds.play("your-turn");
      },
      soundMuted,
      setSoundMuted,
      setAllSoundsMuted,
    };
  }, [setAllSoundsMuted, setSoundMuted, soundMuted, trigger]);
}
