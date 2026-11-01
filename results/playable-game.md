# Playable local game (`/play`) — completion summary

**Status:** Complete for the requested local version. `/play` is a four-player, pass-and-play Parchís game using the **two-dice classic variant**. The human is the **bottom-left player** (Bruno/blue), rolls first, and sees the board numbered **from their own exit as square 1**. The board is PixiJS; the player cards and the two-dice controls are drawably DOM cards around it.

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

- The human is `HUMAN_PROFILE` (Bruno/blue). `GAME_PLAYER_CONFIGS` puts the human first, so their bottom-left card is the active seat at load.
- The board uses `viewColor = HUMAN_PROFILE.color`; the human's start is numbered 1 and all track numbers are view-relative. The human's blue home is already bottom-left, so the board rotation is 0 today.
- `getViewCorner` computes the four seat corners for the human view; the page places the cards by those corners. If the human's colour changes, the board rotates and the cards follow while the human stays bottom-left.
- The board keeps numerals upright by counter-rotating each label against the play-area rotation.
- Move popovers, keyboard-move labels, and barrier labels all use the same view-relative numbering. A human move to progress 2 reads “Mover 2 a la casilla 3”. The visible event-narration line was removed with the old turn card.

## Dice and animation

- Dice are no longer drawn in the board corners. `components/game/dice-card.tsx` is a **minimal, textless dice tray** per player, placed on the inner side of that player's profile card:
  - top-half cards have their tray **below**;
  - bottom-half cards have their tray **above**.
- The tray has no title, player name, “Turno”, “Tira los dados”, “Esperando su turno”, latest-event copy, circular profile-style rings, or “?” inside the dice. Before a roll the two tiles are blank cream rectangles with the player-accent border; after a roll they show the die images. Used dice are dimmed. The active seat gets the full accent sketch border, accent die tiles, and a faint wash; inactive trays use a muted accent border.
- The active player's dice are the roll button (`Tirar tus dados` / `Tirar los dados de {name}`). Tapping cycles both faces every 90 ms with a CSS tumble for ~750 ms, then commits the engine roll. `prefers-reduced-motion: reduce` commits immediately.
- The drawably “Tirar dados” turn card was **removed**. Only the barrier-choice buttons and the small “Bono +20/+10” badge appear in the active tray when those phases need them; the generic prompt and latest event were removed. The explanatory footer under the page was also removed, and the profile cards no longer show Casa/Juego/Meta counters.
- Chip movement is interpolated in Pixi over 380 ms with ease-out cubic. Entering, moving, capturing, and reset positions animate; a new draw starts from the last painted position; reduced motion snaps. Destination markers and selectable glows still redraw immediately.

## Files created

| File | Why |
| --- | --- |
| `components/game/dice-card.tsx` | Minimal textless drawably dice tray per seat: two tiles, active accent border/wash, barrier choice and bonus badge only when needed. |
| `lib/parchis/presentation.ts` | Pure engine→artwork bridge: colour mapping, chip layout/stacking, destinations, two-die views, view-aware anchors, and Spanish progress labels. |
| `lib/parchis/presentation.test.ts` | Colour mapping, safe-mark alignment, token layouts, two-die views, anchors, view-relative labels, and Spanish labels. |
| `components/game/game-players.ts` | Temporary roster; Bruno/blue is the human and the human seat rolls first. |
| `components/game/player-panel.tsx` | Compact drawably profile card: avatar, name, colour, human marker, turn/winner badge; no count tiles. |
| `public/chips/tokens/{red,blue,yellow,green}.png` | 256 px alpha-cropped chip art (originals remain unused). |
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
| `app/play/page.tsx` | Human view and numbering, responsive seat grid by `getViewCorner`, minimal dice trays, removed `TurnPanel` and footer, compact profile cards, mobile seats above/below the board, view-relative labels, human starts. | Implements the requested perspective, dice placement, mobile layout, and removals. |
| `components/game/parchis-board.tsx` | Accepts `viewColor`; no dice or roll callback; chip-position map and 380 ms Pixi interpolation; view-aware static rebuild. | Board is human-relative and moves smoothly. |
| `components/game/board-drawing.ts` | Player-relative labels; removed dice drawing/layer; `TokenDrawTarget[]` return; upright labels. | Dice moved to DOM; smooth chip movement needs targets. |
| `components/game/player-panel.tsx` | Removed the Casa/Juego/Meta count tiles and the player argument; compact padding; human marker and narrow-card badge breakpoints. | The owner found the counters meaningless; the compact card leaves room for the mobile above/below layout. |
| `components/game/game-players.ts` | `HUMAN_PLAYER_ID`, `HUMAN_PROFILE`, human-first configs. | The human always sits bottom-left and rolls first. |
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
| `bun test` | **83 passed, 0 failed, 4,667 assertions** across 5 files; 500-game simulation: 176,423 actions, longest 639. |
| `npx tsc --noEmit` | Passed. |
| `npx eslint app components lib` | Passed with no output. |
| `npx next build` | Passed; `/`, `/not-found`, `/manifest.webmanifest`, and `/play` are statically prerendered. |
| Headless Chrome + SwiftShader, 1360×1200 | Compact profile cards with no Casa/Juego/Meta tiles or footer; textless dice trays with the active blue accent and muted player-accent borders on inactive trays; human bottom-left with “Tú”; human tray above the human panel; top trays below their panels; board numbers start at 1 on the blue exit; safe marks brown; dice tumble; no console errors. |
| Deterministic [5,2] UI run | One token auto-entered with the 5 used and the 2 remaining; legal target “Ficha 1: Mover 2 a la casilla 3”; move applied and turn passed; no console errors. |
| 390×844 emulation | Two seats above the board and two below; 358×358 board; human bottom-left; full names; `scrollWidth === 390`; no horizontal overflow; page height 894 px (was 1271 px). |
| 320×700 emulation | Two seats above and two below; 288×288 board; human bottom-left; full names; `scrollWidth === 320`; no horizontal overflow; page height 824 px (was 1237 px). |

## Deviations and follow-ups

- **Dice placement is a DOM exception.** The owner explicitly asked for the two dice above/below each player card and for the old roll card to be removed, so the dice live in drawably cards outside the Pixi canvas. Board/chips/interpolation remain PixiJS.
- **The human is fixed to the Bruno/blue seat.** There is no colour/seat selector yet. `getViewCorner` and `viewColor` already support another human colour rotating the board and cards.
- **Four local players, pass-and-play.** Placeholder names/avatars; no bots, network, persistence, reconnect, sound, ranking, or spectators. Tasks 04/06/07 remain future work.
- **The original large art** in `public/chips/*.png` and `public/dices/*.png` remains unused; the game loads only `chips/tokens` and `dices/faces`.
- **Mobile scroll is now small:** two seats sit above the board and two below; 390×844 needs ~50 px of vertical scroll and 320×700 needs ~124 px; horizontal overflow is zero.
- **Minimal dice guidance:** there is no visible “Tira los dados”/“Elige una ficha” prompt; the active tray's accent border/wash, the lit chips, and the dice themselves are the guidance. Screen readers still get the tray label and live status.
- **No View Transitions API.** Smooth movement uses Pixi interpolation as requested; the dice use a CSS tumble.
