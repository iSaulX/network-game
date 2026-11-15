# Turn cues, bot chip and empty seats

Direct request (no task brief). Three related changes to make the local game
readable at a glance: a clearer "this is your turn" signal on the dice, an
explicit bot marker on non-human seats, and the ability to leave rival colours
empty in the four-player table.

## Files

### Created

- `components/setup/seat-fill-picker.tsx` — one row of the **Huecos de la mesa**
  list. A drawably trigger states the current choice ("Con bot" / "Vacío") and
  opens a HeroUI `Popover` with two drawably actions: **Jugar con un bot** and
  **Dejarlo vacío**. The empty option is disabled while the table already has
  the minimum of two seats, with a short Spanish explanation.

### Changed

- `app/globals.css`
  - Imports `@heroui/styles/components/chip.css` into the components layer so the
    HeroUI `Chip` used for the bot marker is styled.
  - Adds `drawably-turn-glow` (1.8 s opacity/scale pulse) and `.turn-glow::before`
    (absolute, `inset: -0.4rem`, accent fill, `blur(12px)`) plus a static
    fallback under `prefers-reduced-motion: reduce`. The rule `.turn-glow > *`
    lifts the dice above the glow so the artwork stays crisp.
- `components/game/dice-card.tsx`
  - New `yourTurn` derived flag: the seat is active, human, controllable, not on
    auto-play and the game is not finished.
  - The dice row gets `turn-glow` and `data-turn-glow` only while that flag is
    true; the accent comes from the existing profile colour.
  - Adds a scribbled badge under the dice: **¡Tira!** while `awaiting-roll`,
    **Tu turno** for the other playable phases.
  - The tray `aria-label` and its live status announce "¡Es tu turno!…".
- `components/game/game-feedback.ts` — the synthesized `your-turn` cue is
  brighter (659 → 988 → 1319 Hz, slightly longer) so the change of control is
  audible over the dice clip.
- `app/play/page.tsx` — the local controller no longer requires a previous
  non-null current player, so the turn chime also plays when the human is first
  on turn at game start.
- `components/game/player-panel.tsx` — non-human, non-remote seats show a HeroUI
  `Chip` (`size="sm"`, `variant="soft"`, `color="default"`) reading **Bot**
  instead of the plain "· Bot" text. `bot-*` ids are also treated as bots so an
  online room with remote humans still marks its bot-filled seats.
- `components/game/game-players.ts`
  - `GameSettings` gains an optional `emptyColors` list; `DEFAULT_GAME_SETTINGS`
    sets it to `[]`.
  - `getGameSettingsFromSearchParams` parses `empty=blue,green` (comma separated,
    validated against the four board colours), drops the human's own colour,
    ignores the parameter for `1v1`, and clamps to two empty seats so a rival
    always remains.
  - `createGameSetup` filters the empty colours out of the roster, letting the
    engine seat 2–4 players; a defensive clamp keeps at least two seats when a
    settings object is built by hand.
- `components/game/game-players.test.ts` — updated the settings expectations for
  the new field and added a test for empty-seat parsing, roster shrinking, the
  human-colour and 1v1 exclusions and the two-empty-seat clamp.
- `components/setup/setup-flow.tsx`
  - Colour selection now uses `DrawablyButton` with the colour as its sketch
    stroke (previously a CSS-bordered `<button>`).
  - New `emptyColors` state, forwarded into `GameSettings` as the `empty` query
    parameter when the local all-vs-all mode starts.
  - **Huecos de la mesa** block inside the mode card, shown only for the
    "contra bots" branch: the human's own colour is displayed as a fixed
    **Tu asiento** row and each rival colour gets a `SeatFillPicker`.
- `architecture.md` — documented the turn glow, bot chip and empty-seat flow,
  updated the file tree and the current-status log.

## Behaviour

- The glow and the badge appear only while the human can actually act, so
  auto-play, bot turns, the finished phase and waiting states stay calm.
- The glow is decorative: the dice remain the roll control and all existing
  labels stay unchanged.
- Emptying a colour removes that seat from the roster; the board and the seat
  cards render only the seated players, and the engine's turn order skips the
  missing colour.

## Commands and results

- `npx tsc --noEmit` — clean.
- `npx eslint components app` — clean.
- `bun test` — 189 passing, 0 failing, 5,344 assertions across 19 files.
- `npx next build` — succeeded (Turbopack), static routes `/`, `/offline`,
  `/play`, dynamic `/api/versus`.

## Deviations and follow-ups

- No browser-based visual check was performed for this change; the verification
  above is type, lint, test and production-build only. The glow position and the
  chip/trigger sizes at 390 px were chosen from the existing layout but not
  screenshotted.
- Empty seats apply only to the local four-player table. Online rooms still fill
  every empty seat with a bot at start, so the host cannot choose to leave a
  colour unoccupied over the network.
- The **Huecos de la mesa** block is visible whenever the "contra bots" branch
  is selected; choosing **1 contra 1** simply ignores the empty colours.
