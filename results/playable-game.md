# Playable local game (`/play`) — completion summary

**Status:** Complete for the requested local version. `/alone` configures a **1 vs 1** or **all-vs-all** game with the human's chosen colour, name and avatar; `/play` runs it with the **two-dice classic variant** and the pure bot policy. The fixed colour turn order is **blue → red → yellow → green** (filtered for 1v1); the human may start or wait depending on the chosen colour. The human sits bottom-left and sees the board numbered **from their own exit as square 1**; only the human's chosen-colour chips are pointer-selectable. The board is PixiJS; player cards and dice trays are drawably DOM cards around it.

This was a direct request with no `tasks/NN-*.md` brief, so the summary filename is `results/playable-game.md`. The original one-die Task 03 brief is historical; the live rules and UI documented here were specified by the project owner.

## Rules in force

- **Dice:** two d6 are always thrown and displayed. Dice are separate, never summed. Each die is one movement; both dice must be used while each has a legal move.
- **Entry:** automatic and mandatory. A 5 die releases one token and is spent. A total of 5 (1+4, 2+3) releases one token and spends both. Double 5 releases two tokens when the start allows; otherwise the remaining 5 is a normal movement die.
- **Pass:** if no remaining die has a legal move, the turn passes automatically; there is no manual pass.
- **Own barriers:** both dice even and an own barrier force one die to break it by moving one of the two tokens. One breakable barrier is executed automatically; several give the player a barrier choice; none breakable skips the turn without spending the dice.
- **Doubles:** a double grants another roll. The third consecutive double is not used for movement; the last moved outer-track token returns to the yard (home column/goal exempt) and the turn passes.
- **Base classic rules:** captures, exact goal, private home column/goal, barriers, +20 capture bonus, +10 home bonus, and fourth goal wins immediately. A 6 moves 6; there is no 6→7 conversion, 6 extra roll, or three-sixes penalty.
- **Safe squares (corrected):** the four coloured starts are safe. The eight brown/dark marks around the map are the other safe squares at **start +7 and start +12**: board squares 12/17, 29/34, 46/51 and 63/68. The engine's safe set is `0, 7, 12, 17, 24, 29, 34, 41, 46, 51, 58, 63`; a home entrance (progress 63) is safe because it is another colour's start+12.

## Perspective, numbering, and seating

- `/alone` builds a `GameSetup` with a synthetic `human` profile chosen by the user and the bot profiles for the other colours. The fixed board-colour order is **blue → red → yellow → green**, filtered to the participants; the engine uses that order.
- Every non-human seat is labelled **Bot**; the human is **Tú**.
- The board uses `viewColor = setup.human.color`; the human's start is numbered 1 and all track numbers are view-relative. Blue is rotation 0; red/green/yellow rotate the play area.
- `getViewCorner` computes the seat corners for the human view; the page places the cards by those corners while the human stays bottom-left. In 1v1 the human is bottom-left and the opposite-corner bot top-right; the other two corners are empty.
- The board keeps numerals upright by counter-rotating each label against the play-area rotation.
- Move popovers, keyboard-move labels, and barrier labels all use the same view-relative numbering. A human move to progress 2 reads “Mover 2 a la casilla 3”. The visible event-narration line was removed with the old turn card.

## Human vs bots

- Only the human's chosen-colour chips are pointer-selectable. `ParchisBoard` receives `humanPlayerId` and clears `selectableTokenIds` on bot turns; keyboard targets and move popovers render only on a human turn. Human dice trays are the only visible roll buttons; bot trays are textless and automatic.
- `lib/bots/policy.ts` is pure, deterministic and one-ply. It only uses the public `GameState` and the engine's legal move lists. Scoring: capture **+1000**, exact goal **+800**, form a friendly barrier **+300**, safe landing **+150**, target progress **+1 per square**, risky non-safe landing within 1–6 of an opponent **−200**, break an owned barrier **−150** unless capturing or reaching the goal. Ties use higher target progress, then token id lexicographically.
- The bot chooses the highest-value legal bonus and, when several own barriers can be broken, simulates each engine break and picks the best resulting position. Every returned move is checked against the legal list; no cheating or hidden state.
- Bot pacing: **1 s wait**, then a **1 s** dice tumble, then another **1 s** wait before the bot move/bonus/barrier break; each new state clears the pending timer. The human roll remains 750 ms. Bot and human timers are cleared on reset/unmount, and a phase/player guard prevents duplicate bot actions.
- During bot turns the human roll button and DOM move targets are absent; the board has no selectable chips. The two header controls (restart/back) remain available.

## Dice and animation

- Dice are no longer drawn in the board corners. `components/game/dice-card.tsx` is a **minimal, textless dice tray** per player, placed on the inner side of that player's profile card:
  - top-half cards have their tray **below**;
  - bottom-half cards have their tray **above**.
- The tray has no title, player name, “Turno”, “Tira los dados”, “Esperando su turno”, latest-event copy, circular profile-style rings, or “?” inside the dice. Before a roll the two tiles are blank cream rectangles with the player-accent border; after a roll they show the die images. Used dice are dimmed. The active seat gets the full accent sketch border, accent die tiles, and a faint wash; inactive trays use a muted accent border.
- The human's active dice are the roll button (`Tirar tus dados`); tapping cycles both faces every 90 ms with a CSS tumble for ~750 ms. Bot turns use the same visual with a **1 s** tumble and no button; the human cannot roll for a bot. `prefers-reduced-motion: reduce` commits immediately.
- The drawably “Tirar dados” turn card was **removed**. Only the human's barrier-choice buttons and the small “Bono +20/+10” badge appear in the active tray when those phases need them; bot trays never expose controls. The generic prompt and latest event were removed. The explanatory footer under the page was also removed, and the profile cards no longer show Casa/Juego/Meta counters.
- Chip movement is interpolated in Pixi over 380 ms with ease-out cubic. Entering, moving, capturing, and reset positions animate; a new draw starts from the last painted position; reduced motion snaps. Destination markers and selectable glows still redraw immediately.

## Feedback and auto-play

- **Shared feedback hook:** `components/game/game-feedback.ts` uses `web-haptics` and a small Web Audio palette. The owner-supplied clips are used where requested: `/sounds/dice-roll.mp3` on the human dice tap (and quieter for bot/auto rolls) and `/sounds/click.mp3` on every actual chip movement (advance, bonus move, barrier break; captures/goals included), never on automatic entries. Both preload; audio stays silent before the first pointer/keyboard gesture and failures are swallowed.
- **Haptics:** selection for changed `/alone` options; light for secondary controls/auto checkbox; medium for the human's dice/move/barrier and mode start; heavy for a human capture; success for a human goal/win; warning when the human is captured, loses a token to three doubles, or a bot wins. Bot and auto actions are sounds only. One cue per state batch is selected by `game-feedback-cues.ts`: win → capture → goal → three doubles → barrier → move → entry → roll; passes are silent.
- **Sound settings:** the header **Sonido** button opens a drawably popover with a top **Silenciar todos los sonidos** checkbox and 10 category checkboxes (Interfaz, Dados, Movimiento, Entrada de ficha, Capturas, Barreras, Meta, Avisos, Victoria y derrota, Tu turno). Checked means muted; changes apply live, muting Dados/Movimiento pauses the supplied clips, haptics are unaffected, and Escape/backdrop/× close with focus restore. Settings are in-memory only. See `results/sound-settings.md`.
- **Auto-play:** a drawably **Modo automático** checkbox sits above the human dice tray. While checked, the same one-ply bot policy plays the human's seat at the 1 s bot pace; the human's dice, board chips, keyboard targets, popovers, barrier buttons and bonus badge are disabled, the panel shows **Tú (auto)**, and the active tray shows **Auto**. Haptics are suppressed for auto actions. Unchecking cancels an in-flight auto roll and the pending scheduler timer (with an `autoModeRef` race guard) and restores the human controls immediately when it is their turn. Auto mode is in-memory, survives “Nueva partida”, and is not persisted across navigation/reload.
- **Verification:** headless Chrome confirmed the human manual dice tap plays `dice-roll.mp3` at 0.6 with a medium haptic; auto-play uses 0.32 for dice and 0.28 for movement, with no extra vibrations; the auto checkbox sits above the human dice and unchecking during an auto roll returns the roll button. The 390×844 `/play` page is ~1004 px tall with no horizontal overflow; at 320×700 it is ~945 px. See `results/haptics-sounds.md` and `results/auto-mode.md`.

## Files created

| File | Why |
| --- | --- |
| `lib/bots/policy.ts` | Pure deterministic bot policy: capture, goal, barrier, safety, risk, progress and own-barrier-break scoring; legal normal/bonus/barrier choices. |
| `lib/bots/policy.test.ts` | Policy tests for capture, barrier, goal, risk, barrier-break avoidance, determinism/legality, bonuses and barrier choices. |
| `components/game/dice-card.tsx` | Minimal textless drawably dice tray per seat: two tiles, active accent border/wash, human-only barrier choice and bonus badge when needed. |
| `lib/parchis/presentation.ts` | Pure engine→artwork bridge: colour mapping, chip layout/stacking, destinations, two-die views, view-aware anchors, and Spanish progress labels. |
| `lib/parchis/presentation.test.ts` | Colour mapping, safe-mark alignment, token layouts, two-die views, anchors, view-relative labels, and Spanish labels. |
| `components/game/game-players.ts` | Local setup: avatar allowlist, fixed colour order, opposite-corner pairs, validated URL settings, synthetic human + bot roster and engine configs. |
| `components/game/game-players.test.ts` | Setup tests for all-vs-all, 1v1 opposite pairs/order and URL validation/defaults. |
| `app/alone/page.tsx` | Mode/colour/name/avatar selection page using the supplied 1vs1/all-for-all art; native GET form to `/play`. |
| `components/game/player-panel.tsx` | Compact drawably profile card: avatar, name, colour, human marker, turn/winner badge; no count tiles; **Tú (auto)** role added later. |
| `components/game/game-feedback.ts` | Shared `useGameFeedback` hook: haptics plus owner-supplied dice/move clips and synthesized Web Audio cues. |
| `components/game/game-feedback-cues.ts` | Pure event → feedback-cue classifier and priority rules. |
| `components/game/game-feedback-cues.test.ts` | 8 tests / 16 assertions for cue coalescing and priorities. |
| `components/game/game-sound-settings.ts` | Sound categories, Spanish labels, name→category mapping and mute-state helpers. |
| `components/game/sound-settings-popover.tsx` | Header-opened sound settings dialog with master + 10 category mutes, backdrop/Escape/close and focus restore. |
| `public/chips/tokens/{red,blue,yellow,green}.png` | 256 px alpha-cropped chip art (originals remain unused). |
| `public/sounds/dice-roll.mp3`, `public/sounds/click.mp3` | Owner-supplied game audio (not authored in this pass). |
| `public/dices/faces/{1..6}.png` | 256 px alpha-cropped die art (originals remain unused). |
| `results/playable-game.md` | This summary. |

The two-dice engine itself was already implemented in this feature before the UI pass documented here: `lib/parchis/types.ts`, `engine.ts`, `errors.ts`, `index.ts`, `simulation.test.ts`, `test-helpers.ts`, and the historical notes `results/03-game-logic.md` / `results/play-board.md`. The latest pass changed only the safe-square constants/rules/tests and the UI files listed below.

## Files changed

| File | Change | Why |
| --- | --- | --- |
| `lib/parchis/constants.ts` | Safe offsets changed to start+7/start+12; 12 safe squares. | The image marks brown/dark safe squares at 12/17/29/34/46/51/63/68; the rules now match the artwork. |
| `lib/parchis/rules.ts` | Safe-square comment updated. | Keep the rule contract accurate. |
| `lib/parchis/rules.test.ts`, `lib/parchis/engine.test.ts` | Safe/capture scenarios updated. | Scenarios now use the corrected safe squares. |
| `lib/parchis/board-geometry.ts` | Brown marks restored to `12, 17, 29, 34, 46, 51, 63, 68`; added `getViewCorner`; `MARKED_SAFE_SQUARES` includes the entrance tips. | Match the supplied reference and support rotated card corners. |
| `lib/parchis/board-geometry.test.ts` | Safe-mark expectations and view-corner mapping tests. | Verify the new artwork/rule alignment. |
| `lib/parchis/presentation.ts` | `getBoardAnchorPercent(anchor, viewColor?)` rotates DOM anchors; `describeProgress(color, progress, viewColor?)` prints view-relative square numbers. | Popovers and move labels stay aligned with the human view. |
| `lib/parchis/presentation.test.ts` | Added view-relative progress tests. | Lock the “exit is 1” UX. |
| `app/play/page.tsx` | Suspense-wrapped query settings, dynamic roster/profiles, chosen view/colour, mode badge, “Cambiar modo”, human-only selection/targets/popovers, bot scheduler/pacing, auto-play checkbox/ref guards, feedback calls, responsive seats. | Runs the `/alone` 1v1/all-vs-all setup against the bots with optional auto-play and audio/haptic feedback. |
| `components/game/parchis-board.tsx` | Added `humanPlayerId` and `humanControlled`; `selectableTokenIds` is empty on bot turns and during auto-play. | Only the human's chips can be touched when the human controls their turn. |
| `components/game/game-players.ts` | Dynamic setup replaces the fixed-blue roster. | Allows any human colour, 1v1, and custom name/avatar. |
| `components/game/player-panel.tsx` | Human “Tú” / non-human “Bot” labels; **Tú (auto)** during auto-play. | Makes the bot and auto seats identifiable. |
| `components/game/dice-card.tsx` | Roll/barrier/bonus controls are human-only; `controllable` hides them during auto-play; **Auto** badge; bot trays stay automatic. | Prevents the human controlling a bot or an auto seat. |
| `components/game/parchis-board.tsx` | Accepts `viewColor` and `humanControlled`; no dice or roll callback; chip-position map and 380 ms Pixi interpolation; view-aware static rebuild. | Board is human-relative, moves smoothly, and disables taps during auto-play. |
| `components/game/board-drawing.ts` | Player-relative labels; removed dice drawing/layer; `TokenDrawTarget[]` return; upright labels. | Dice moved to DOM; smooth chip movement needs targets. |
| `components/game/player-panel.tsx` | Removed the Casa/Juego/Meta count tiles and the player argument; compact padding; human marker and narrow-card badge breakpoints. | The owner found the counters meaningless; the compact card leaves room for the mobile above/below layout. |
| `components/game/game-players.ts` | `HUMAN_PLAYER_ID`, `HUMAN_PROFILE`, human-first configs removed in the later `/alone` pass. | The human colour/seat is now selected. |
| `app/globals.css` | `drawably-dice-tumble` keyframes and reduced-motion override. | Dice visibly spin when tapped. |
| `architecture.md` | Updated the live rules, safe squares, perspective, dice cards, chip animation, layout, tests, and verification. | The living document now matches the code. |
| `results/playable-game.md` | This summary. | Task completion record. |

## Files deleted

| File | Why |
| --- | --- |
| `components/game/turn-panel.tsx` | The owner removed the standalone roll/turn card; only the still-required barrier controls and bonus badge live in the active dice tray. |

## Engine ↔ board integration

- Engine starts remain red 0, blue 17, yellow 34, green 51. Artwork starts remain green 5, blue 22, red 39, yellow 56; the constant +4 offset keeps the pure colour renaming (engine red→board green, blue→blue, yellow→red, green→yellow).
- The engine's progress 0–71 is used unchanged with the mapped artwork colour for track, corridor, and goal placement.
- New safe marks map to board start+7/+12: green 12/17, blue 29/34, red 46/51, yellow 63/68. The four entrance tips are brown and safe.
- The board's static scene rebuilds when the size or `viewColor` changes; game-state changes only rebuild destinations and chips.
- `getViewCorner(color, viewColor)` is the shared source for the responsive card placement; the viewer's own home is always bottom-left.

## Commands and results

| Command | Result |
| --- | --- |
| `bun test` | **103 passed, 0 failed, 4,739 assertions** across 8 files; 500-game simulation: 176,423 actions, longest 639; 9 bot-policy tests + 3 setup tests + 8 feedback-cue tests. |
| `npx tsc --noEmit` | Passed. |
| `npx eslint app components lib` | Passed with no output. |
| `npx next build` | Passed; `/`, `/not-found`, `/alone`, `/manifest.webmanifest`, and `/play` are statically prerendered. |
| Headless Chrome + SwiftShader, 1360×1200 | `/alone` red + Abeja: all-vs-all produced four seats (human red bottom-left, bots blue/yellow/green); 1v1 produced two seats (human red bottom-left, green bot top-right). Both `/play` pages showed the custom name/avatar, mode badge, human-only roll button, compact textless trays and brown safe marks; no console errors. |
| Deterministic [5,2] UI run | One token auto-entered with the 5 used and the 2 remaining; legal target “Ficha 1: Mover 2 a la casilla 3”; move applied; next active player was **Carla/red**, then the bot sequence continued; no console errors. |
| Bot observation | Active sequence **Carla/red → Diego/yellow → Ana/green → Bruno/blue**. Each bot: ~1 s idle, 1 s `dice-rolling`, ~1 s, then the next bot. During every bot turn: roll buttons 0 and DOM move targets 0; on Bruno's return the human roll button reappeared. |
| 390×844 emulation | `/alone` ~1402 px tall and `/play` ~1004 px (auto checkbox included); 358×358 board; human bottom-left (opponent top-right in 1v1); `scrollWidth === 390`; vertical scroll only. |
| 320×700 emulation | `/alone` ~1530 px and `/play` ~945 px (auto checkbox included); 288×288 board; human bottom-left; `scrollWidth === 320`; vertical scroll only. |
| Auto/sounds instrumentation | Manual dice tap: medium haptic, running context, `dice-roll.mp3` at 0.6. Auto checkbox checked: human roll hidden, **Tú (auto)**/Auto, auto dice at 0.32; unchecking during an auto roll returned the roll button. Auto movement used `click.mp3` at 0.28 with no extra vibrations. No console errors. |

## Deviations and follow-ups

- **Dice placement is a DOM exception.** The owner explicitly asked for the two dice above/below each player card and for the old roll card to be removed, so the dice live in drawably cards outside the Pixi canvas. Board/chips/interpolation remain PixiJS.
- **The human colour is selected in `/alone`.** The player can choose blue/red/yellow/green and a custom name/avatar; the board and seat cards rotate around that colour. The fixed colour order means choosing yellow/green can make a bot start.
- **No homepage link to `/alone` yet.** The page is reachable at `/alone` and from `/play` → “Cambiar modo”; the user did not ask to change the homepage.
- **The solo setup is not persisted.** Returning to `/alone` starts from Jugador/blue/octopus; the current game can be restarted with the same setup from `/play`.
- **The three non-human seats are bots; no pass-and-play.** Bots use the pure `lib/bots/policy.ts`; the old Task 06 `/bots` route, offline precache, localStorage resume, homepage/offline entry and reusable `GameStage` remain pending. The Task 06 brief's one-die/human-red/pass assumptions are stale relative to the current two-dice game and were not applied.
- **No network in play:** `/play` makes no API/WebSocket calls, but the `/bots` route, service-worker precache and cold-offline verification are still Task 06. No persistence, reconnect, ranking, spectators or networking (Tasks 04/07). Audio/haptics are optional and browser-local; auto mode and the per-sound mute choices are in-memory only, and haptics have no on/off UI.
- **The original large art** in `public/chips/*.png` and `public/dices/*.png` remains unused; the game loads only `chips/tokens` and `dices/faces`.
- **Mobile layout:** seats are above/below the board; `/alone` and `/play` scroll vertically at 390 px with no horizontal overflow. The new `/alone` page is tall on phones.
- **Minimal dice guidance:** there is no visible “Tira los dados”/“Elige una ficha” prompt; the active tray's accent border/wash, the lit chips, and the dice themselves are the guidance. Screen readers still get the tray label and live status.
- **No View Transitions API.** Smooth movement uses Pixi interpolation as requested; the dice use a CSS tumble.
