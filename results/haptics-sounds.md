# Game feedback — haptics + sounds (direct request)

**Status:** Complete for the direct request. The game now uses optional Web Vibration haptics plus the two owner-supplied MP3s (`/sounds/dice-roll.mp3` for dice and `/sounds/click.mp3` for chip movement), with synthesized cues for the remaining events. A separate auto-play request is documented in `results/auto-mode.md`.

## What changed

- **Shared hook:** `components/game/game-feedback.ts` exports `useGameFeedback()`. It pairs `web-haptics` with a small Web Audio palette and two preloaded `HTMLAudioElement`s. The hook is used by `/alone` and `/play`.
- **Owner-supplied clips (used as requested):**
  - `/sounds/dice-roll.mp3` (1.584 s) plays when the human taps the active dice (volume 0.6); bot/auto rolls use the same clip at 0.32. Each roll restarts the clip, so overlapping dice throws do not stack.
  - `/sounds/click.mp3` (0.048 s) plays on every actual chip movement — normal advance, bonus move and own-barrier break, including capture and goal moves, for human and bot/auto seats. Human moves use 0.55; bot/auto moves use 0.28.
  - Automatic entries, automatic passes and the three-doubles return do not play the movement clip. They keep their synthesized cues (entry ping / warning).
  - Both clips are preloaded on mount. Audio stays silent until the first pointerdown/keydown; playback after that is allowed by the browser. A failed or blocked `play()` is swallowed.
- **Haptics (human only, via `useWebHaptics`):**
  - `selection` for changing colour/avatar on `/alone` (clicking the current option is a no-op);
  - `light` for secondary actions — header/new-game/back taps, the auto checkbox;
  - `medium` for starting a mode, the human's dice throw and the human's chip moves/barrier break;
  - `heavy` when the human captures an opponent;
  - `success` for a human goal or win;
  - `warning` when the human's token is captured or returned by three doubles, and when a bot wins.
  - Bots never get haptics. Auto-play passes `haptics: false`, so a bot playing the human's seat does not vibrate the device; sounds continue. Haptic trigger failures are caught so they cannot block the game.
- **State-event coalescing:** `components/game/game-feedback-cues.ts` reduces one `game.log` batch to a single meaningful cue: **win → capture → goal → three doubles → barrier → move → entry → roll**; a pass produces no cue. This prevents a single move with an advance + capture + bonus from stacking haptics. The move clip is played separately from the cue, once per movement event.
- **Synthesized palette:** selection tick, secondary tap, mode start, capture, goal, barrier, entry, warning, win/loss fanfare and the human's turn chime. These remain asset-free Web Audio envelopes.
- **Per-category sound settings:** a header **Sonido** button opens a drawably popover with a top **Silenciar todos los sonidos** checkbox and 10 category checkboxes (Interfaz, Dados, Movimiento, Entrada de ficha, Capturas, Barreras, Meta, Avisos, Victoria y derrota, Tu turno). Checked means muted; changes apply live; muting Dados or Movimiento pauses the corresponding supplied clip. Haptics are not affected. The settings are in-memory only. See `results/sound-settings.md`.
- **No page-load feedback:** initial render is silent, and bots before the first human gesture produce no queued audio. The first gesture unlocks both the vibration path and sound.

## Files

| File | Change |
| --- | --- |
| `components/game/game-feedback.ts` | New shared hook and sound engine: `web-haptics`, preloaded MP3 playback, synthesized Web Audio cues, first-gesture unlock, safe failures, and category mutes. |
| `components/game/game-feedback-cues.ts` | New pure event → cue classifier with the priority order above. |
| `components/game/game-feedback-cues.test.ts` | New 8 tests / 16 assertions for empty batches, roll/entry, move actors, capture outcomes, goals, three doubles, barriers, victory priority and pass silence. |
| `components/game/game-sound-settings.ts`, `components/game/sound-settings-popover.tsx` | New per-category mute model and sound settings dialog added after the initial feedback pass. |
| `app/alone/page.tsx` | Selection haptics/tick sounds for changed colour/avatar; mode-start and back feedback. |
| `app/play/page.tsx` | Human dice/roll feedback, coalesced game-event feedback, movement clip, automatic-mode haptic suppression, navigation/restart feedback. |
| `public/sounds/dice-roll.mp3`, `public/sounds/click.mp3` | Owner-supplied audio assets used by the hook (not authored in this pass). |
| `architecture.md` | Documented the feedback system, assets, cue priority, auto suppression and verification. |
| `results/haptics-sounds.md` | This summary. |

No source files were deleted. `web-haptics` ^0.0.6 was already present in `package.json`; no dependency change was needed.

## Commands and results

| Command | Result |
| --- | --- |
| `bun test` | **103 passed, 0 failed, 4,739 assertions** across 8 files (engine, rules, simulation, geometry, presentation, bot policy, local setup, feedback cues). |
| `npx tsc --noEmit` | Passed. |
| `npx eslint app components lib` | Passed with no output. |
| `npx next build` | Passed; `/`, `/_not-found`, `/alone`, `/manifest.webmanifest` and `/play` static. |

Headless Chrome with SwiftShader (instrumented `AudioContext`, `OscillatorNode`, `AudioBufferSourceNode`, `HTMLMediaElement.play` and `navigator.vibrate`):

- `/alone`: initial render had 0 vibrations, 0 contexts, 0 media plays. Selecting Rojo then Abeja produced one `[2,6]` selection vibration per change, one running `AudioContext`, and oscillator ticks. Starting all-vs-all logged the medium `[14,6,4,1]` mode-start vibration. No console errors.
- `/play`, before the first gesture: bot turns produced no audio context, vibration or media play.
- Manual human dice click: medium `[14,6,4,1]` haptic, running context, `/sounds/dice-roll.mp3` played at **0.6**. The roll auto-passed (no moves) and the next bot roll used the same clip at **0.32**. No console errors.
- Auto-play (separate test): enabling the checkbox, auto / dice and movement events played `/sounds/dice-roll.mp3` at **0.32** and `/sounds/click.mp3` at **0.28**, with no additional vibrations during the automated actions. Unchecking returned the human roll button. No console errors.
- No game-state or engine code was modified; feedback is presentation-only.

## Deviations and follow-ups

- **Mute settings are in-memory.** The header **Sonido** popover can silence categories or everything, but choices reset on navigation/reload; there is no persisted preference.
- **Haptics are device-dependent.** Desktop/unsupported browsers silently no-op; the game remains fully usable. Sound mutes do not affect haptics.
- **Only clicks that cause a real movement use `click.mp3`.** Automatic entries and the three-doubles return have their own synthesized cues instead.
- **The two MP3s are used as supplied** (1.584 s dice roll and 48 ms click). No trimming, conversion or loudness normalization was applied beyond per-cue `volume` values.
- **Auto-play is documented separately**; this summary covers feedback only.
