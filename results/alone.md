# Solo mode setup (`/alone`) — completion summary

**Status:** Complete for the direct request. `/alone` is the local mode-selection page for **1 vs 1** and **four-player all-vs-all** games against the existing bot policy. It collects the human's colour, name and avatar, then starts `/play` through a native GET form.

This was a direct request, so the descriptive filename `results/alone.md` is used. The full Task 06 `/bots` offline/persistence brief remains separate and pending.

## What the page does

- **Modes:** two large drawably mode buttons using the supplied `public/modes/1vs1.png` and `public/modes/all-for-all.png` artwork.
  - **1 vs 1:** the opponent is the opposite-corner colour — blue↔yellow and red↔green.
  - **Todos contra todos:** the human plus the other three colours as bots.
- **Profile:** choose one of the eight `public/pictures` avatars, edit the name (max 24; native input remains selectable), and choose blue/red/yellow/green. A live preview shows the avatar, name, colour and “Tú”. The mode descriptions update with the selected rival colour(s).
- **Start:** the two mode buttons are submit controls in a native `GET` form targeting `/play`; hidden fields carry colour, avatar and name. This performs a fresh document navigation. It avoids the Next 16 dev instant-validation 500 observed with client-router navigation away from `/alone`.
- **Validation in `/play`:** unknown mode/colour/avatar values fall back to all/blue/octopus; blank names fall back to `Bruno`; names are clamped to 24 characters; the avatar must be in the shared allowlist. The human gets the synthetic id `human`.
- **Turn order:** fixed **blue → red → yellow → green**, filtered to the participants. The human does not necessarily start (e.g. choosing yellow in 1v1 allows the blue bot to start); the page states the order.
- **Gameplay:** `/play` uses the same two-dice engine, PixiJS board, 1 s bot policy/pacing, human-relative numbers, drawably dice trays and winner flow. Only the human's chosen-colour chips are pointer-selectable. In 1v1 only the human bottom-left and opponent top-right seat cards are rendered; the other two board homes remain empty.
- **Navigation:** `/play` has “Cambiar modo” (native form to `/alone`), “Nueva partida” (same setup) and “Volver al inicio”. `/alone` has “Volver al inicio” (native form).
- **Feedback:** changing to a different colour/avatar plays a selection haptic and a short synthesized tick; repeating the current selection is a no-op. Starting a mode uses a medium haptic/start cue and the back control a light tap. The audio path stays silent before the first pointer/keyboard gesture. The shared hook lives in `components/game/game-feedback.ts`; see `results/haptics-sounds.md`.

## Files

| File | Change |
| --- | --- |
| `app/alone/page.tsx` | New drawably setup page: two mode buttons, avatar/name/colour selection, live preview, native GET form. |
| `components/game/game-players.ts` | Added avatar allowlist, colour order/accents, opposite-corner map, mode/settings types, `getGameSettingsFromSearchParams`, and `createGameSetup`; removed the fixed-blue human. |
| `components/game/game-players.test.ts` | New setup tests: all-vs-all seats, 1v1 opposite pairs/order, query validation/defaults. |
| `components/game/game-feedback.ts`, `components/game/game-feedback-cues.ts`, `components/game/game-feedback-cues.test.ts` | Shared haptic/sound feedback hook and tested event-cue classifier used by this page and `/play`. |
| `app/play/page.tsx` | Uses a Suspense-wrapped `useSearchParams`; builds the dynamic setup, profile map, chosen view/colour, human id, mode badge and “Cambiar modo”; seats render from the setup. |
| `public/modes/1vs1.png`, `public/modes/all-for-all.png` | Supplied mode art, now used by `/alone`. |
| `architecture.md` | Documented `/alone`, dynamic `/play`, 1v1/all modes, turn order, validation and test counts. |
| `results/playable-game.md`, `results/06-bot-mode.md` | Updated for the configurable modes. |
| `results/alone.md` | This summary. |

No source files were deleted. The user-supplied mode images are the only new assets in this pass.

## Commands and results

| Command | Result |
| --- | --- |
| `bun test` | **103 passed, 0 failed, 4,739 assertions** across 8 files (engine, rules, simulation, geometry, presentation, bot policy, local setup, feedback cues). |
| `npx tsc --noEmit` | Passed. |
| `npx eslint app components lib` | Passed with no output. |
| `npx next build` | Passed; `/`, `/_not-found`, `/alone`, `/manifest.webmanifest`, `/play` static. |
| Headless Chrome, 1360×1200 | `/alone` selected red + Abeja; all-vs-all produced four seats (human red bottom-left, bots blue/yellow/green), mode badge “Todos contra todos”, custom name/avatar; no console errors. 1v1 produced exactly two seats (human red bottom-left, green bot top-right), mode badge “1 vs 1”, new game with human first; no console errors. Instrumented feedback check: no initial context/vibration; each changed colour/avatar produced a selection `[2,6]` vibration and a running audio context; mode start produced medium `[14,6,4,1]`. |
| Headless Chrome, 390×844 | `/alone` selected red + Abeja; all-vs-all and 1v1 both `scrollWidth === 390`, human bottom-left, opponent top-right in 1v1, vertical scroll only. `/play` page height ~1004 px (auto checkbox included); `/alone` ~1402 px. |
| Headless Chrome, 320×700 | `scrollWidth === 320`; `/alone` ~1530 px and `/play` ~945 px (auto checkbox included); no horizontal overflow. |

## Deviations and follow-ups

- **Full Task 06 remains pending:** separate `/bots` route, offline precache, homepage/offline entry, localStorage resume and reusable `GameStage`. The Task 06 brief's one-die/human-red/pass assumptions are stale relative to the current two-dice game and were not applied.
- **No homepage link to `/alone` yet.** The page is reachable at `/alone` and from `/play` → “Cambiar modo”; the user did not ask to change the homepage.
- **The selected setup is not preserved when going back to `/alone`;** the page starts from its defaults (Jugador, blue, octopus). The current game can be restarted with the same setup from `/play`.
- **1 vs 1 uses the standard four-home board with two empty homes;** only two seat cards are shown. The turn order is filtered from the fixed colour order, so the human may not start depending on the chosen colour.
- **Mode start uses full document navigation** rather than SPA routing. This is a deliberate workaround for a Next 16 dev instant-validation error, not a gameplay limitation.
- **Bots remain a deterministic one-ply heuristic**, not a deep search or difficulty-tiered AI.
