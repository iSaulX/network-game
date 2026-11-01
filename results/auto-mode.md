# Auto-play for the human seat (direct request)

**Status:** Complete for the direct request. `/play` now has a **Modo automático** checkbox above the human dice tray. Checking it lets the existing bot policy play the human's seat; unchecking it restores the human's controls. The control was first added in the header, then moved to a native drawably checkbox above the human dice at the owner's request.

## Behaviour

- **Control:** `DrawablyCheckbox` (`input[type="checkbox"]`) inside a visible Spanish `<label>` **Modo automático**, placed immediately above the human dice tray in the bottom-left human seat. The label carries `select-none`; the 22 px checkbox is keyboard-operable and implicitly labelled. It is not in the page header.
- **Checking:** sets `autoMode` immediately (and an `autoModeRef` used by the scheduler). The human seat is played by the same pure one-ply `lib/bots/policy.ts` policy as the other bots:
  - 1 s wait, 1 s dice tumble, 1 s wait before the chosen move/bonus/barrier break.
  - Human dice, board chips, keyboard move targets, move popovers, barrier buttons and bonus badge are disabled/hidden (`DiceCard.controllable=false`, `ParchisBoard.humanControlled=false`, `handleTokenSelect` guard).
  - `PlayerPanel` shows **Tú (auto)**; the active human dice tray shows an **Auto** badge and its screen-reader status says “Modo automático.”
  - The auto seat's actions are sounds only: `feedback.events(..., { haptics: false, automated: true })`; the auto dice roll uses the quieter bot-volume clip. The checkbox change itself is a light haptic/tap.
- **Unchecking:**
  - Updates `autoModeRef` synchronously before React state.
  - Cancels an in-flight auto roll (clears its interval/timeout and `rollingLock`) and closes any move menu.
  - The scheduler effect cleanup clears its pending 1 s timer; the bot action re-checks `autoModeRef` so a timer that fires in the same tick cannot act after deactivation.
  - If the human is the current player, controls return immediately; if a bot is currently playing, controls return at the human's next turn.
- **Persistence:** auto mode survives **Nueva partida** (same setup) but is browser-memory only; navigating away or reloading starts with it off. It is available only in `/play`.
- **Policy:** no new difficulty or separate AI; the human's auto seat uses the same deterministic heuristic, including captures, goals, friendly barriers, safe/risk scoring, bonus choice and multi-barrier simulation.

## Files

| File | Change |
| --- | --- |
| `app/play/page.tsx` | Added `autoMode`/`autoModeRef`, human-versus-auto control gating, the scheduler/auto roll source, cancellation and recovery guards, `feedback.events` haptics suppression, the drawably **Modo automático** checkbox above the human dice, and the **Tú (auto)** state. |
| `components/game/dice-card.tsx` | Added `controllable`; human controls and barrier/bonus UI are hidden when auto is active; added the **Auto** badge and auto status. |
| `components/game/player-panel.tsx` | Added the optional `auto` role label **Tú (auto)** and corresponding aria text. |
| `components/game/parchis-board.tsx` | Added `humanControlled`; no chips are selectable while auto-play owns the human seat. |
| `components/game/game-feedback.ts` | Event feedback accepts `haptics: false` and `automated: true`, suppressing auto haptics and lowering auto movement audio volume. |
| `architecture.md` | Documented auto-play, gating, cancellation, checkbox placement, sounds/haptics and verification. |
| `results/auto-mode.md` | This summary. |

No source files were deleted. No engine or bot-policy code changed.

## Commands and results

| Command | Result |
| --- | --- |
| `bun test` | **103 passed, 0 failed, 4,739 assertions** across 8 files. Auto-play is UI orchestration; existing policy/engine tests remain green. |
| `npx tsc --noEmit` | Passed. |
| `npx eslint app components lib` | Passed with no output. |
| `npx next build` | Passed; `/`, `/_not-found`, `/alone`, `/manifest.webmanifest` and `/play` static. |

Headless Chrome + SwiftShader, red human in all-vs-all:

- Initial human turn: checkbox unchecked; label **Modo automático**, `select-none` present; checkbox bounding box above the human dice tray; human roll button visible.
- Checked: roll button removed; role **Tú (auto)**; **Auto** badge; light `[6,9]` haptic; audio context running.
- After 1.3 s: auto dice roll in flight; `/sounds/dice-roll.mp3` played at 0.32; no additional vibrations.
- Unchecked during that roll: roll button returned immediately; role **Tú**; auto badge gone; checkbox unchecked. This proves control recovery.
- Rechecked and left running: auto-play continued; the dice clip played repeatedly at 0.32, and the movement clip was observed at 0.28 when chips moved later in the run. Vibration count stayed at the three checkbox changes during the 5.5 s auto span (no haptic spam from auto moves); the human seat showed **Tú (auto)** and the auto badge when active.
- Final uncheck: checkbox off, role **Tú**; the current player was a bot, so the roll button correctly remained absent until the human turn. No console errors, exceptions or log errors.

Responsive checks with the final checkbox: at 390×844 `scrollWidth === 390`, page height ~1004 px, checkbox 22 px above the human dice; at 320×700 `scrollWidth === 320`, page height ~945 px. The auto mode has no header button; the header keeps its navigation buttons (plus the later Sonido button).

## Deviations and follow-ups

- **No persistence:** auto mode is not stored across reloads/navigation.
- **Same policy:** no new AI difficulty or separate auto-strategy; it is the same one-ply heuristic used by bots.
- **Unchecking during a bot's turn** does not stop that bot; it only prevents/aborts the auto action for the human seat and restores controls when the human's turn arrives.
- **Unchecking during an auto roll cancels that roll** and leaves the human in `awaiting-roll` with the roll button; this is intentional so control returns immediately.
- **Sound settings are separate:** the header **Sonido** popover mutes sound categories; auto actions then stay silent, but haptics were already suppressed for auto. See `results/sound-settings.md`.
- Auto mode is only exposed in `/play`; `/alone` does not persist or preset it.
