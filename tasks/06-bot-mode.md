# Task 06 — Offline bot mode (1 human + 3 bots)

**Read `AGENTS.md` before making any changes, and read and update `architecture.md` after making changes so the architecture is always current.**

## Outcome

Add a fully local, offline-playable mode at `/bots`: you play red against three computer players (blue, yellow, green). It uses the pure Parchís engine from Task 03 and a reusable PixiJS board, with **no API or WebSocket calls**. The mode must work from the Task 05 offline shell, survive a refresh, and be reachable from the homepage.

This task includes a minimum viable, reusable game stage: board geometry, tokens, dice, turn HUD, legal-move highlighting, basic animation, and accessibility. Visual polish, sounds, and advanced effects belong to later tasks.

## Dependencies

- Task 01 — homepage exists and is ready for the new "Jugar contra bots" entry.
- Task 03 — the Parchís engine is complete. Do not fork or reimplement the rules.
- Task 05 — offline shell/service worker exists.
- Task 04 is **not** required for this mode. Do not import or call the party store, API client, or WebSocket code. Online play keeps using those later.

If a dependency is missing, stop and flag it rather than inventing a parallel implementation.

## Architecture

```
/bots page (client)
  └── useLocalGame / LocalGameController
        ├── lib/parchis engine (pure, source of truth)
        ├── lib/bots/policy (pure legal-move chooser)
        ├── localStorage snapshot (resume)
        └── GameStage (PixiJS)
              └── drawably chrome around the canvas
```

- **Engine:** `lib/parchis` only. Every action goes through `roll`, `applyMove`, `applyBonusMove`, `pass`. Never mutate state; never compute rules in the UI.
- **Bots:** pure functions that receive public state + legal moves and return a legal move. They may not inspect hidden state (there is none) or call engine internals that bypass validation.
- **Local controller:** owns the current `GameState`, schedules bot turns, exposes human actions, persists snapshots. No network.
- **Rendering split (per `AGENTS.md`):** the board, tokens, dice, in-game HUD, legal-move highlights, and all game updates render in **PixiJS**. The page header, back/exit controls, instructions, confirmation dialogs, and game-over card use **drawably/react**. Drawably controls must not be placed inside the Pixi canvas.

## Game setup

- Four players in seat order:
  - seat 0: human, red, id `human`
  - seat 1: `bot-1`, blue, label "Ordenador 1"
  - seat 2: `bot-2`, yellow, label "Ordenador 2"
  - seat 3: `bot-3`, green, label "Ordenador 3"
- Create with the Task 03 engine: `createGame([{id:"human",color:"red"}, ...])`.
- Local dice: one d6 from a local RNG. Use `crypto.getRandomValues` in the browser (or a seeded PRNG for tests) and `rollDie`. Never fetch a die from the server.
- One local game per tab. Multiple tabs may each have their own save; keep the storage key stable and document last-write-wins.

## Local game flow

Mirror the authoritative behaviour defined by the engine and Task 04's server:

1. `awaiting-roll`: if the human is current, enable the Pixi roll control; if a bot is current, schedule its roll after a short delay.
2. `roll(state, value)`.
3. If `getLegalMoves(state)` is empty, call `pass(state)` immediately (this handles the 6 extra-roll case). Then continue with the new phase.
4. If moves exist:
   - human: highlight the legal tokens/cells and wait for a choice;
   - bot: choose with `lib/bots/policy` and apply after a delay.
5. If `awaiting-bonus`, repeat the same choice flow for `getLegalBonusMoves` (20 or 10). No skipping when a legal bonus exists.
6. After the action, if the phase is `awaiting-roll` again (extra roll), continue with the same player; otherwise advance.
7. On `finished`, stop all timers, persist nothing that can be resumed as active, and show the result.

Timing:

- Bot think/act delay: ~600–900 ms per step so turns are legible.
- If `prefers-reduced-motion` matches, use ~150 ms and no decorative animation.
- Every scheduled action must be cancellable: clear timers on state change, unmount, restart, or navigation. Guard against duplicate actions with a turn/phase check before applying.
- Do not block the main thread. Engine actions are cheap; only animations are time-based.
- Human controls are disabled while a bot is acting.

## Bot policy (`lib/bots/policy.ts`)

Pure, deterministic, one "normal" difficulty. No cheating: only the public `GameState` and `getLegalMoves`/`getLegalBonusMoves`.

```ts
chooseMove(state: GameState, playerId: string): Move | null
chooseBonusMove(state: GameState, playerId: string): BonusMove | null
```

Scoring guidance (constants exported and tunable):

- capture an opponent: strongly positive (e.g. +1000)
- reach the goal: +800
- enter a token from the yard: +500
- form a barrier with a friendly token: +300
- land on a safe square: +150
- progress: add the number of squares advanced (small weight)
- land where an opponent within 1–6 squares behind can capture next turn on a non-safe square: negative (e.g. −200); ignore this if the destination is safe or forms a barrier
- break an existing own barrier: −150 unless the move captures or reaches the goal
- prefer exact-goal moves and moves that use the full bonus
- ties: highest target progress, then token id lexicographic (deterministic)

Rules:

- Return `null` only when there are no legal moves (the controller then calls `pass`).
- Never return an illegal move; validate against the legal list before returning (defensive).
- Bonus choice uses the same scoring with the 20/10 distance fixed.
- No random moves unless a seeded tie-break is injected; default must be deterministic for tests.
- Do not add difficulty levels; one policy is enough for this task.

Tests must cover: capture preference, goal preference, entry, safe landing, barrier formation, risky landing avoidance, barrier-breaking avoidance, deterministic tie-break, and never returning an illegal move.

## PixiJS game stage

Add `pixi.js` (v8+). Mount **one** `Application` manually in a client component; do not add `@pixi/react`. The board module must be reusable by the future online game screen.

### Board geometry

- Match the Task 03 constants exactly:
  - 68 outer squares, indices `0…67`;
  - starts at `0/17/34/51` (red/blue/yellow/green);
  - route progress `0…63` on the outer track, `64…70` in each private home column, `71` at the goal;
  - safe squares: the four starts plus `4, 11, 21, 28, 38, 45, 55, 62`;
  - four yards and a central goal.
- Put the 68 absolute cells on a rotationally symmetric cross-shaped path. Draw a clockwise/counterclockwise loop consistent with the engine's progress direction; the visual direction only needs to be consistent for all colours.
- Draw the four home columns and yards; mark starts and safe squares distinctly. The mapping functions (absolute index / progress / yard / goal → x,y) belong in a dedicated geometry module, not inside React components.
- Multiple tokens on one cell need small offsets so they remain visible (max 2 on the outer track; home columns may stack).
- The board must fit a square container and scale on resize; cap device pixel ratio at 2.

### Visual language

- Paper/cream background, dark ink lines, Parchís red/blue/yellow/green accents; slightly rough/hand-drawn strokes to sit next to drawably without introducing drawably inside the canvas.
- Tokens are simple drawn circles/pawns with a small colour mark; clear whose turn it is.
- Minimal, readable HUD in Pixi: current player, last roll and effective distance (6→7), roll control, "thinking" state for bots.
- Use the app's font once loaded (e.g. `document.fonts.ready`); fall back to a sensible system font. Do not load the Drawably Pen font.

### Interaction

- Roll control: Pixi-drawn button plus keyboard (`Space`/`Enter`/`R`) when it is the human's turn.
- Legal moves: highlight the specific tokens (and yard tokens for entry) that can move. Clicking/tapping a highlighted token applies its move; the destination is fixed by the die. If a token ever has multiple legal destinations, present a small Pixi chooser.
- Bonus phase: highlight tokens with legal 20/10 moves and use the same interaction.
- Disable input during bot turns, animations, and after the game ends.
- Capture and goal events get a brief visual emphasis; no elaborate effects.

### Animations and lifecycle

- Token movement, capture, and die reveal: ~200–300 ms. `prefers-reduced-motion` → instant or ≤80 ms, no pulsing.
- Use the Pixi ticker only for active tweens; do not re-render React state every frame.
- Create/destroy the `Application` in `useEffect`; append the canvas to a ref; use a `ResizeObserver`; destroy textures/graphics and the app on unmount. Handle React Strict Mode double-mount cleanly.
- Reusable `GameStage` props should include at least: `state`, `humanPlayerId`, `legalMoves`, `legalBonusMoves`, `phase`, `onRoll`, `onMove`, `onBonusMove`, `reducedMotion`. The online screen will reuse this API later.

### Accessibility

- The canvas alone is not enough. Add a visually hidden (or focus-revealed) DOM control panel in Spanish with real buttons for "Tirar dado" and each legal token move/bonus, wired to the same handlers.
- Add an `aria-live="polite"` status region announcing turn changes, rolls, captures, bonuses, and the winner in Spanish.
- The canvas gets a concise `aria-label` describing the game and current turn.
- Fully playable by keyboard; visible focus rings on DOM controls; do not trap focus.
- Respect reduced motion and do not auto-advance so fast that text cannot be read.

## Page and app chrome

- Route: `app/bots/page.tsx` (client). Spanish UI throughout.
  - Drawably header: back to home ("Volver"), title "Partida contra bots", badge "Sin conexión" or "Modo local".
  - Short instructions: "Tira el dado y elige una ficha iluminada."
  - The Pixi game stage fills the available square area.
  - Game-over drawably card: "¡Has ganado!" or "Ha ganado Ordenador 1", buttons "Jugar otra vez" and "Volver al inicio".
  - A drawably "Reiniciar" control with a confirmation dialog; exiting mid-game also confirms if a game is in progress.
- Homepage: add a drawably "Jugar contra bots" action with helper text "No necesitas conexión."; navigate to `/bots`. Keep the existing avatar/join/create UI intact.
- Offline page (Task 05): add a link to `/bots` so an offline user can enter the mode.
- Buttons use `select-none`; all labels, helper text, dialogs, and aria labels are Spanish with correct accents; no English UI copy.
- Do not modify the online party APIs, WebSocket layer, or engine rules.

## Persistence

- Key: `parchis:local:v1`. Store a versioned snapshot:

```ts
{
  schemaVersion: 1;
  state: GameState;
  humanPlayerId: "human";
  botIds: ["bot-1", "bot-2", "bot-3"];
  createdAt: number;
  updatedAt: number;
}
```

- Save after every accepted action (and after a roll/pass) with a small debounce if needed. Do not store React nodes, Pixi objects, timers, or functions.
- On mount: load, validate the schema and state invariants, and auto-resume an unfinished game. If it is a bot's turn, continue the turn loop.
- Discard corrupt, unknown-version, or `finished` snapshots and start a new game.
- Clear the snapshot on win and on "Jugar otra vez".
- `localStorage` can fail (private mode/quota); catch and continue without persistence. Never block gameplay on storage.
- No tokens or personal data are stored.

## Offline integration

- Bot mode must make **zero** `fetch`, XHR, or WebSocket calls. Do not import `lib/party` client code, `lib/server/*`, or Task 04 modules. A test should stub `fetch` and `WebSocket` to throw and still complete a game.
- Update the Task 05 service-worker precache to include `/bots` (Serwist `additionalPrecacheEntries` with the build revision, or the equivalent). The route's chunks are included by the build manifest; verify.
- After an online visit/build with the SW installed, a cold offline reload of `/bots` must render and be playable.
- The homepage entry must work offline (homepage cached, `/bots` precached).
- If the service worker is updating, do not break a running local game.

## Files

Suggested layout:

```
app/bots/page.tsx
components/game/GameStage.tsx
components/game/geometry.ts
components/game/board.ts
components/game/tokens.ts
components/game/hud.ts
components/game/accessible-controls.tsx
lib/bots/policy.ts
lib/bots/policy.test.ts
lib/local-game/controller.ts
lib/local-game/controller.test.ts
lib/local-game/storage.ts
lib/local-game/storage.test.ts
lib/local-game/types.ts
```

- Do not fork the engine; fix engine issues only if a real bug is found, and report them.
- Keep Pixi scene code out of React render functions; mount once and update imperatively on state changes.
- Keep bot/controller logic free of DOM/Pixi imports so it is testable in Bun.

## Testing

Automated (`bun test`, no new test dependencies):

- Bot policy scenarios listed above; every returned move is legal; determinism; `null` only when no moves exist.
- Controller: full 4-player simulated games (human auto-played randomly, bots using the policy) terminate under a cap and satisfy engine invariants; 6 extra rolls, auto-pass, bonuses, and wins behave correctly.
- Persistence: save/load round-trip, corrupt/unknown data discarded, finished games not resumed, storage failures do not throw.
- No-network test: stub `fetch`/`WebSocket` to throw; the local flow still plays a full game.
- `bun run lint`, `bunx tsc --noEmit`.

Manual:

- Play a complete game vs 3 bots: entry on 5, 6 extra roll, 6=7, capture + 20, goal + 10, barrier block, safe-square sharing rules, exact goal, three-six penalty (force with a test seed if needed), win.
- Human cannot act on a bot turn; bots never act twice; timers stop on unmount/restart.
- Resize/mobile layout; keyboard-only game; screen-reader status announcements; reduced motion.
- Production build (`bun run build && bun start`): load `/bots` online, DevTools Offline, hard-reload `/bots`, play; launch the installed PWA offline and enter from home.
- No regressions on `/`, online party APIs, or `/api/ws`.

## Acceptance criteria

- `/bots` is reachable from the homepage and the offline page.
- A complete 1-human-vs-3-bots game is playable, with the engine as the only rules authority and bots restricted to legal moves.
- No network calls occur in bot mode; the mode works on a cold offline reload after the Task 05 shell has been installed.
- The PixiJS board matches the engine geometry and renders tokens, dice, turns, legal moves, captures, goals, and the winner.
- PixiJS renders the game; drawably renders the surrounding chrome; no drawably inside the canvas; all copy is Spanish.
- The game resumes after refresh, and saves are validated/cleared correctly.
- Keyboard and screen-reader access work; reduced motion is respected.
- `bun run lint`, `bunx tsc --noEmit`, and `bun test` pass.
- No online party/WS behavior is changed.
- `architecture.md` is updated.

## Out of scope

- Online multiplayer, matchmaking, invites, or syncing a local game to a server.
- Bot difficulty levels, learning, or personality; only the normal deterministic policy.
- Sound, voice, advanced particle effects, final art, or animated avatars.
- Spectators, chat, rematches beyond restarting a new local game.
- Server persistence, accounts, rankings, or global stats.
- Final icon/PWA artwork.

## Definition of done

- Update `architecture.md` with: `/bots` route, local controller and bot policy modules, Pixi `GameStage` reuse boundary, persistence key/schema, offline SW precache change, and the explicit no-network rule for local play.
- Report files added, packages/versions, test results, manual playtest notes, offline test results (including iOS if available), and any deviations or engine bugs found.
- Flag ambiguities instead of inventing rules outside Task 03.
