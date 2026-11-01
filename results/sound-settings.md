# Sound settings popover (direct request)

**Status:** Complete for the direct request. `/play` now has a header **Sonido** button that opens a drawably sound-settings popover with a top **Silenciar todos los sonidos** checkbox and a list of 10 individual sound-category checkboxes.

## Behaviour

- **Trigger:** a drawably **Sonido** button in the `/play` header (alongside Cambiar modo, Nueva partida and Volver al inicio). It has `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls`; `select-none`.
- **Panel:** a fixed drawably dialog over a dimmed backdrop, titled **Ajustes de sonido**, with the helper **Marca los sonidos que quieras silenciar.** The close × button, backdrop click and Escape all dismiss it. Focus moves to the first checkbox on open and returns to the Sonido trigger on close.
- **Master:** **Silenciar todos los sonidos** is the first control. Checked means every category is muted; unchecking it unchecks every category. Its state is derived from the 10 individual categories, so manually muting every category also checks the master.
- **Individual categories (checked = muted):**
  1. Interfaz — selection tick, UI tap, mode start
  2. Dados — `/sounds/dice-roll.mp3` for human, bot and auto rolls
  3. Movimiento — `/sounds/click.mp3` for advances, bonus moves and barrier breaks
  4. Entrada de ficha
  5. Capturas
  6. Barreras
  7. Meta
  8. Avisos (being captured / three doubles)
  9. Victoria y derrota
  10. Tu turno
- **Live application:** `game-sound-settings.ts` maps every internal `SoundName` to one of those categories. `useGameFeedback` keeps the mute record, configures the sound engine, and the engine skips a cue whose category is muted. Muting Dados or Movimiento also pauses any supplied clip already playing. Haptics are independent and have no on/off UI.
- **Visual correctness:** Drawably checkboxes only repaint their mask on a native change event. The popover adds a state-driven effect that mirrors every controlled checkbox's `data-checked` state, so checking the master visually checks all 10 rows and individual changes update the master too. This was caught and fixed during browser verification.
- **Persistence:** settings are browser-memory only; they survive **Nueva partida** (same page) but reset on navigation/reload. They are available only in `/play`; `/alone` has no settings trigger.

## Files

| File | Change |
| --- | --- |
| `components/game/game-sound-settings.ts` | New pure sound categories, Spanish labels, `SoundName` → category mapping, `createMutedSounds` and `areAllSoundsMuted`. |
| `components/game/sound-settings-popover.tsx` | New fixed drawably dialog with the master and 10 category checkboxes, backdrop/×/Escape closing, initial focus and `data-checked` mirroring. |
| `components/game/game-feedback.ts` | Added `soundMuted`, `setSoundMuted`, `setAllSoundsMuted`; category-aware sound suppression; pausing samples on mute. Haptics unchanged. |
| `app/play/page.tsx` | Added the header **Sonido** button, popover open state, close/focus restoration and the popover render. |
| `architecture.md` | Documented the settings UI, categories, live application, accessibility and verification. |
| `results/haptics-sounds.md`, `results/playable-game.md`, `results/auto-mode.md` | Updated to reflect the settings control and remove the old “no mute” follow-up. |
| `results/sound-settings.md` | This summary. |

No source files were deleted. The two audio clips and `web-haptics` already existed from the previous feedback pass.

## Commands and results

| Command | Result |
| --- | --- |
| `bun test` | **103 passed, 0 failed, 4,739 assertions** across 8 files. Sound-settings UI is covered by browser checks; the pure category mapping is typed exhaustively. |
| `npx tsc --noEmit` | Passed. |
| `npx eslint app components lib` | Passed with no output. |
| `npx next build` | Passed; `/`, `/_not-found`, `/alone`, `/manifest.webmanifest`, `/play` static. |

Headless Chrome + SwiftShader:

- Opened the dialog from the Sonido button: 11 checkboxes; labels exactly “Silenciar todos los sonidos”, Interfaz, Dados, Movimiento, Entrada de ficha, Capturas, Barreras, Meta, Avisos, Victoria y derrota, Tu turno; master above the list; focus on the master; body `scrollWidth` unchanged.
- Checking the master set all 11 native `checked` states **and** all 11 drawn checkmarks. The subsequent dice roll produced **no media playback** (sounds muted); the human dice haptic still fired.
- Unchecking the master restored all 10 categories; a later human movement played `/sounds/click.mp3` at **0.55**, confirming sound resumed.
- Muting only **Dados** left the master unchecked, showed only Dados checked (native and drawn), and kept the other nine unmuted.
- Escape closed the dialog, set `aria-expanded="false"`, and returned focus to the Sonido trigger.
- At 390×844 the dialog was **359 × 498 px** at `top: 80px`, inside the viewport with `scrollWidth === 390`. The header's fourth button fit in the existing two rows; page height remained ~1004 px.
- No console errors, exceptions or error-level logs.

## Deviations and follow-ups

- **Not persisted.** Mute choices reset on navigation/reload. A versioned `localStorage` preference is the natural follow-up.
- **Category granularity.** The list groups human/bot variants and related cues (for example Dados covers both human and bot dice rolls); it is not one checkbox per raw internal cue.
- **No haptics toggle.** The request was specifically about sounds; haptics still follow the existing human-only rules.
- **Master semantics.** “Silenciar todos” is a convenience checkbox derived from all categories; it is not a separate override that disables the individual controls. This keeps all 10 rows consistent and lets a user unmute one category while others stay muted.
- **Only `/play` exposes the settings.** `/alone` keeps its default sound behaviour; the settings state does not persist across the native `/alone` → `/play` navigation.
