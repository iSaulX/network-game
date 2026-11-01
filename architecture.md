# Architecture — Parchís Stars

> Living document. Every task must leave this file more accurate than it found it.

_Last updated: 2026-10-31 (Tasks 01–03 implemented; `/play` rebuilt as the square 21×21 reference board with PixiJS, player-relative rotation and start-relative numbering; briefs 04–07 pending)_

## Purpose

Parchís Stars, a networked Parchís game built with Next.js and a hand-drawn UI. Work is split across multiple AI contributors: task briefs live in `tasks/`, and each contributor implements one task at a time.

## Stack

- **Framework:** Next.js 16.4.2 (App Router, Turbopack)
- **React:** 19.3.0
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4 (`app/globals.css`) with **OpenRunde** loaded via `next/font/local` from `public/fonts/` (400/500/600/700) and applied app-wide
- **UI chrome:** `drawably/react` 0.4.2 — real HTML controls with seeded SVG sketch chrome
  - Used for all non-game UI: homepage, menus, lobby, forms, buttons, dialogs, settings, pre-game/post-game screens
  - **Exception:** the homepage avatar picker popover uses **HeroUI** by explicit user request. The popover trigger and avatar option buttons are still drawably controls.
  - `drawably/style.css` is imported exactly once, in `app/layout.tsx`
  - Theme through custom properties: `--drawably-stroke`, `--drawably-fill`, `--drawably-paper`, `--drawably-width`
  - Do not restyle drawably's SVG paths or fake the look with CSS borders
- **Game rendering:** **PixiJS** (`pixi.js` 8.22.0) — board, tokens, dice, animations, in-game HUD, and every game-state update
  - The game is never rendered with DOM/SVG, CSS, or drawably
  - One Pixi `Application` mounted in a client component; React handles mounting plus the UI around it
  - Drawably controls cannot live inside the Pixi canvas
  - The `/play` reference board is implemented with PixiJS in `components/game/`; the reusable local/bot `GameStage` (tokens, dice, interactions) is still pending Task 06
  - PixiJS is imported dynamically inside the client effect so the canvas never runs during server rendering
- **Offline:** Serwist service worker (pending Task 05) — app-shell precache, offline fallback, versioned caches
- **HeroUI (popover exception):** `@heroui/react` v3.2.6 `Popover.Root`/`Trigger`/`Content`/`Dialog` for the homepage avatar picker only
  - Styles come from `@heroui/styles` (utilities, variants, default theme, popover component CSS) plus `tw-animate-css`, imported in `app/globals.css`
  - The app's paper theme overrides the HeroUI overlay tokens (`--overlay`, `--overlay-shadow`)
  - Do not use HeroUI for other controls unless a task explicitly asks
- **Unused for now:** `@heroui/react` / `@heroui/styles` outside the avatar popover; do not use them elsewhere unless a task explicitly asks
- **Realtime (pending Task 04):** custom Node server (`server.ts`) + `ws`; Next route handlers for HTTP; in-memory `PartyStore` on `globalThis`
- **Package manager:** bun 1.4.2

## Structure

```
app/
  layout.tsx      Root layout: OpenRunde local font, drawably stylesheet import, globals, Spanish metadata + viewport
  page.tsx        Homepage (implemented; profile/join/create cards + avatar popover)
  manifest.ts     PWA web app manifest (implemented; fullscreen display + placeholder icons)
  globals.css     Tailwind import, HeroUI popover style prelude, paper theme, drawably variables, safe-area shell
  offline/        Offline fallback page (pending Task 05)
  play/           `/play` board page: drawably chrome + square PixiJS reference board (implemented)
  bots/           Local 1-human-vs-3-bots mode (pending Task 06)
  versus/         1v1 P2P lobby + game (pending Task 07, gated)
  sw.ts           Serwist service worker source (pending Task 05)
  api/
    parties/      Create/join/state route handlers (pending Task 04)
    p2p/          ICE server config route handler (pending Task 07, gated)
components/
  avatar-pfp.tsx  Large drawably-circled avatar with image/emoji and label
  avatar-visual.tsx  Shared next/image avatar with emoji fallback
  drawably-trigger-button.tsx  Ref-forwarding drawably button used as the HeroUI Popover trigger
  game/
    parchis-board.tsx  Client component: mounts one square Pixi Application and redraws it on resize
    board-drawing.ts   Framework-free Pixi drawing: walnut table, oak frame, wood grain, homes and flowers, corridors, numbered track, goal X, and free-hand borders
public/
  fonts/          OpenRunde Regular/Medium/Semibold/Bold (woff/otf)
  icons/          PWA icons + Apple touch icon (placeholder artwork; a later icon task replaces it)
  pictures/       Avatar PFPs: dog, monkey, chicken, face, octupus, bee, unicorn, poop
  icon.png        Game icon used beside the Parchís Stars title
  sw.js           Generated service worker (gitignored, pending Task 05)
lib/
  parchis/        Pure classic Parchís engine + bun tests (implemented, Task 03)
    board-geometry.ts  21×21 reference-board layout, 68-cell polygons, corridors, goal, yards, starts/entrances/safe marks, and physical/view-aware position helpers (implemented)
    board-geometry.test.ts  `bun test` coverage for the reference geometry, adjacency, positions, and player view
  party/          Shared protocol, transport/session abstractions, client API/WS/WebRTC
  server/party/   Server-only store, HTTP services, WS/signaling layer (pending Tasks 04/07)
  bots/           Pure local bot policy (pending Task 06)
  local-game/     Local controller + localStorage persistence (pending Task 06)
scripts/
  party-smoke.ts  End-to-end create/join/start/roll smoke test (pending Task 04)
results/
  NN-<name>.md    Per-task completion summaries, named after the task brief (see AGENTS.md)
server.ts         Custom Node server: Next + /api/ws upgrade (pending Task 04)
serwist.config.js Serwist precache/build config (pending Task 05)
tasks/
  01-homepage.md  Homepage UI brief (complete; see results/01-homepage.md)
  02-pwa.md       PWA shell brief (complete; see results/02-pwa.md)
  03-game-logic.md Parchís engine brief (complete; see results/03-game-logic.md)
  04-realtime-parties.md Party API + WebSocket brief (pending)
  05-offline-shell.md Offline app-shell/service-worker brief (pending)
  06-bot-mode.md  Local 1-human-vs-3-bots brief (pending)
  07-p2p-webrtc.md 1v1 WebRTC + transport-abstraction brief (pending, gated on 01–06)
architecture.md   This file
AGENTS.md         Project instructions (rewritten by `next dev`; do not edit)
```

## Routes

| Route | Purpose | Data |
| --- | --- | --- |
| `/` | Homepage / player entry: avatar picker, join party, create party | Local avatar state only; no network or persistence (implemented) |
| `/play` | Square PixiJS reference board with drawably page chrome (implemented) | Static board; no engine, tokens, or network yet |
| `/offline` | Offline fallback page, precached by the service worker (pending Task 05) | Static |
| `/bots` | Local game vs 3 bots, fully offline (pending Task 06) | Engine state in browser memory + `localStorage` |
| `/versus/[code]` | 1v1 P2P lobby and game over WebRTC (pending Task 07, gated) | Host-authoritative engine state; signaling via WS |
| `/manifest.webmanifest` | PWA manifest generated from `app/manifest.ts` | Static |
| `POST /api/parties` | Create a party (route handler, pending Task 04) | In-memory `PartyStore` |
| `GET /api/parties/[code]` | Public lobby info (route handler, pending Task 04) | In-memory `PartyStore` |
| `POST /api/parties/[code]/join` | Join a lobby (route handler, pending Task 04) | In-memory `PartyStore` |
| `GET /api/parties/[code]/state` | Authenticated reconnect snapshot (route handler, pending Task 04) | In-memory `PartyStore` |
| `GET /api/p2p/ice-servers` | Authenticated STUN/TURN config for P2P (pending Task 07, gated) | Server env, ephemeral TURN credentials |
| `/api/ws` | WebSocket upgrade endpoint — **not** a route handler (pending Task 04) | In-memory `PartyStore` + engine |

## Homepage (implemented)

- **Brand/icon:** **Parchís Stars** in the badge, `<h1>`, metadata title, and description. `public/icon.png` is rendered with `next/image` immediately left of the title (decorative `alt=""`, eager).
- **Route:** `/`, implemented in `app/page.tsx` as a client component because the random identity, controlled name, avatar selection, and popover use client state. The root layout remains a server component.
- **Random identity:** the name is prefilled with one random entry from 20 fun names ("Mono Galáctico", "Waffle Interestelar", etc.), and the avatar starts on a random one of the 8 options. All avatars are images from `public/pictures/`: perro (`dog.png`), mono (`monkey.png`), pollo (`chicken.png`), cara (`face.png`), pulpo (`octupus.png`), abeja (`bee.png`), unicornio (`unicorn.png`), popó (`poop.png`). Both defaults are generated client-side with `useSyncExternalStore` and stable server snapshots, avoiding hydration mismatches. The name is a controlled `DrawablyInput`; the avatar can be changed from the popover.
- **Components:** `DrawablyBadge`, `DrawablyButton`, `DrawablyCard`, `DrawablyHighlight`, and `DrawablyInput` from `drawably/react`; `AvatarPfp` (`components/avatar-pfp.tsx`) for the large hand-drawn avatar and `AvatarVisual` (`components/avatar-visual.tsx`) for the shared image rendering. The avatar popover shell uses **HeroUI** `Popover.Root`/`Trigger`/`Content`/`Dialog`; its trigger is a ref-forwarding drawably button (`components/drawably-trigger-button.tsx`), and its 8 option buttons are drawably.
- **drawably wiring:** `drawably/style.css` is imported exactly once in `app/layout.tsx`, before `globals.css`, so the theme and utility classes can override library defaults. No SVG paths or fake borders are restyled.
- **HeroUI wiring:** `app/globals.css` imports `tw-animate-css`, `@heroui/styles/utilities`, `@heroui/styles/variants`, the default theme, and `components/popover.css` before the app's theme overrides. The popover overlay tokens (`--overlay`, `--overlay-shadow`) are mapped to the paper palette.
- **Theme/fonts:** `app/globals.css` defines the warm paper palette, ink, muted text, and Parchís red/blue/yellow/green accents through `--drawably-*` variables. OpenRunde (`--font-open-runde`) is the body font and is also applied to drawably controls and the badge via higher-specificity overrides; the HeroUI popover inherits it. The page is pinned to the light paper theme and has a subtle paper-gradient background.
- **Layout:** compact header (badge, accent dots, icon + highlighted title, Spanish subtitle) above a **two-column** grid. Left column: the profile card with the large `AvatarPfp`, name input, and avatar-change trigger pinned to the bottom. Right column: join and create cards stacked and equal-height. Every card background uses `rounded-xl` so its corners do not overlap the hand-drawn border. The badge and popover heading use Title/sentence case, not all caps. Desktop is locked to `h-dvh` with no page scroll (verified at 1280×800 and 1440×900); mobile stacks the profile card and then the join/create cards, scrolling normally.
- **Profile card:** contains the large `AvatarPfp` (a drawably circle with the avatar image and its name), the controlled "Tu nombre" input (`maxLength={24}`, `autoComplete="name"`), and the "Cambiar avatar" drawably trigger pinned to the bottom. The picker does not show the full grid by default.
- **Avatar media:** `AvatarVisual` renders `next/image` for all eight PFPs as circular `object-cover` images. There are no emoji avatars. If an image fails to load, `onError` shows a neutral silhouette placeholder, never an emoji. The large avatar is prioritized; popover options load when opened. Images are decorative (`alt=""`); the surrounding labels/`aria-label`s name the avatar.
- **Avatar popover:** HeroUI's Popover handles positioning, overlay, focus scope, Escape, and outside pointer dismissal. The trigger exposes `aria-haspopup="dialog"` plus HeroUI's `aria-expanded`/`aria-controls`. The panel uses a paper background, ink text, and the HeroUI rounded/shadowed surface. The selected option uses `variant="solid"` with a Parchís accent fill; the rest use `variant="outline"`, and each shows its circular PFP. Selecting an option updates the `AvatarPfp` and trigger, closes the controlled popover, and returns focus to the trigger.
- **Join/create cards:** the join card has the party-code input (real label, `maxLength={6}`, `autoComplete="off"`, `spellCheck={false}`, uppercase styling) and the solid "Unirse a la partida" button. The create card has the outlined green "Crear una partida" button pinned to its bottom. Both right-column cards share the column height. Neither action has a handler.
- **Accessibility/copy:** all visible text, helpers, and `aria-label`s are Spanish with accents. All buttons, including the avatar trigger and popover options, include `select-none`; the name and party-code inputs stay selectable. The popover is keyboard-operable and dismissible through HeroUI/react-aria.
- **Boundary:** no network requests, API calls, routing, localStorage, or game logic. Backend and navigation arrive in later tasks.

## Play board (implemented)

- **Route:** `/play`, implemented in `app/play/page.tsx` as a client component. The page keeps drawably chrome around the board: badge, highlighted title, the “Juegas como” colour selector, and a “Volver al inicio” button. The previous square-number explorer, start buttons, and legend were removed by direct request. The board is PixiJS.
- **Board geometry:** `lib/parchis/board-geometry.ts` is pure TypeScript (no React, PixiJS, Next.js, or DOM). It models the reference artwork on a **21×21 unit play surface**: four 7×7 homes, three-lane arms, three-row side strips, a 5×5 central goal split by its diagonals, and the 68-square track. All eight inner-corner cells (8, 9, 25, 26, 42, 43, 59, 60) are chamfered by the goal X; an independent pixel audit caught that the two top pairs were initially modelled as rectangles.
- **Track numbering:** 1–8 down the top-left lane, 9–16 leftward, 17 at the left tip, 18–25 rightward, 26–33 down the bottom-left lane, 34 at the bottom tip, 35–42 up the bottom-right lane, 43–50 rightward, 51 at the right tip, 52–59 leftward, 60–67 up the top-right lane, and 68 at the top tip. Numbers are rotated to face the player on each side (180°, 0°, 90°, −90°).
- **Player view:** `/play` has a “Juegas como” selector. The play area rotates as one Pixi container so the chosen colour's home is always in the **bottom-left** corner (blue 0°, green −90°, yellow 180°, red +90°); the table and oak frame stay fixed. Labels are player-relative: the colour's start is **1**, numbers continue in play order, the home entrance is **64**, and 65–68 are the four squares after the entrance. `getBoardView`, `getViewSquareNumber`, `getViewSquarePosition`, and `getViewBoardPositionsForCanvas` expose the same transform to token layers. The numerals keep the artwork's per-side orientation; after rotation, the current player's numbered side is the left edge.
- **Colour layout:** green top-left (start **5**, entrance **68**), yellow top-right (56/51), red bottom-right (39/34), blue bottom-left (22/17). Starts are painted with their corridor colour; the four `start + 7` squares (12/29/46/63) are brown safe marks; the four entrance tips are darker brown. Each colour has seven private corridor cells ordered from the entrance toward the goal; progress 64–70 maps to them and progress 71 to the colour's goal triangle.
- **Position API:** `getBoardPositions(playSize, originX, originY)` returns physical pixel polygons and centres for every track square, corridor, yard/slot, and goal. `getBoardPositionsForCanvas(canvasSize)` applies the shared frame composition (`getBoardFrameLayout`: 6.5 % table margin and 4.5 % frame per side) for a square canvas. Player-view lookups: `getBoardView(color)`, `getViewSquareNumber(color, square)`, `getViewSquarePosition(color, square, playSize, …)`, and `getViewBoardPositionsForCanvas(canvasSize, color, …)`. Single physical lookups: `squareToPoint`, `getSquarePosition`, `progressToSquare`, `getProgressAnchor`/`getProgressPoint`, `getYardSlotAnchor`, `getYardRect`, `wrapSquare`. Invalid input throws `RangeError`.
- **Rendering:** `components/game/parchis-board.tsx` dynamically imports PixiJS inside the client effect, mounts one square `Application`, observes the host with `ResizeObserver`, resizes, and redraws. `components/game/board-drawing.ts` draws the walnut table, oak frame and mitres, cream wood surface with procedural grain, homes with 16-petal flowers (alternating long/short petals), painted corridors and special cells, central triangles, and Open Runde numerals. No DOM/SVG or drawably element draws game pixels.
- **Free-hand borders:** every cell/home/corridor/frame border is a seeded rough polyline. Axis-aligned edges are merged into one stroke per shared line (shared cell edges are never stroked twice), while the two goal diagonals are single X strokes continuing to the home corners. The frame and goal X use slightly heavier strokes. The board is static; it does not boil or animate.
- **Page layout:** the board is capped at 860 CSS px and shown as a rounded, shadowed wooden card; the page scrolls vertically when the viewport is shorter. At 390 px the board is 358 px square with no horizontal overflow; the four colour buttons form a 2×2 grid. The selector is a local preview; future game state will pass the assigned colour to `ParchisBoard`. The page uses Spanish copy, a `role="img"` label that names the view colour, and `select-none` buttons.
- **Tests:** `bun test` covers all 68 unique cells, the closed loop and shared boundaries, the eight chamfered cells, starts/entrances/safe marks, corridor order/adjacency, yards/slots, progress anchors, pixel/frame/position helpers, player-view rotation and renumbering (start 1, entrance 64), and invalid input.
- **Follow-ups:** the artwork paints four brown `start + 7` safe squares, while the implemented engine's Classic rule uses `start + 4` and `start + 11`; reconcile this before wiring the board to the engine. The engine colour IDs also differ from the artwork's corner order and must be mapped explicitly. There are no tokens, dice, highlights, animations, networking, or persistence yet.

## PWA

- **Manifest route:** `app/manifest.ts` (Next.js metadata route) serves `/manifest.webmanifest`.
  - `name` / `short_name`: "Parchís Stars"; `description` in Spanish; `lang: "es"`, `dir: "ltr"`, `categories: ["games"]`.
  - `id`, `start_url`, and `scope` are all `/`.
  - `display: "fullscreen"` with `display_override: ["fullscreen", "standalone", "minimal-ui", "browser"]`.
  - `background_color` and `theme_color`: `#efe5cf`, the same value as the app's `--background` / body background. No separate palette.
- **Icons:** static PNGs in `public/icons/`:
  - `icon-192.png` (192×192, `any`)
  - `icon-512.png` (512×512, `any`)
  - `icon-maskable-512.png` (512×512, `maskable`; content inside the central ~60%, well within the 80% safe zone; full-bleed background)
  - `apple-touch-icon.png` (180×180, opaque, no transparency)
  - **Placeholder artwork:** cream `#efe5cf` background, a rough ink circle and four Parchís-colored dots. Generated once with a local Sharp script that was not committed; a later icon task replaces the files. Do not build UI around these images.
- **Metadata (`app/layout.tsx`, server component):** `applicationName`, Spanish `title`/`description`, `appleWebApp: { capable: true, title: "Parchís Stars", statusBarStyle: "black-translucent" }`, `icons.apple: "/icons/apple-touch-icon.png"`, and `formatDetection: { telephone: false }`.
  - Next 16 emits the standard `mobile-web-app-capable=yes` meta for `appleWebApp.capable`; it does not emit the legacy `apple-mobile-web-app-capable` tag.
- **Viewport (`app/layout.tsx`):** `themeColor: "#efe5cf"` through the `viewport` export (not the deprecated `metadata.themeColor`), `width: "device-width"`, `initialScale: 1`, `viewportFit: "cover"`. Pinch zoom stays enabled (`maximumScale` / `userScalable` are intentionally unset) for accessibility.
- **App-shell CSS (`app/globals.css`):**
  - `html` and `body` set `background-color: var(--background)` so the paper color reaches the screen edges and overscroll areas.
  - `body` sets `min-height: 100dvh` (the layout also uses `min-h-dvh`) and applies `env(safe-area-inset-top/right/bottom/left)` padding once at the shell level. DOM inside the shell must not add safe-area padding again.
  - `overscroll-behavior: none` on both `html` and `body` disables pull-to-refresh and scroll bounce.
  - `-webkit-tap-highlight-color: transparent` on `html`; text selection is not globally disabled and form fields remain selectable.
- **Display behavior:** no JavaScript fullscreen toggle and no custom install prompt. The installed app's `display` mode provides full screen.
- **Still absent:** service worker, offline caching, background sync, push notifications (Task 05).
- **Platform caveat:** iOS does not implement `display: fullscreen`; "Add to Home Screen" launches in the standalone-style WebKit view. `display_override` and `fullscreen` apply to Chromium. iOS uses `appleWebApp.title` and `apple-touch-icon` for the home-screen name and icon.

### Offline shell (planned Task 05)

- **Service worker:** Serwist, using its current Turbopack-compatible integration. Production-only registration; `bun dev` does not register a worker.
- **Precache:** build assets plus `/`, `/offline`, the manifest, and icons, with a build revision.
- **Runtime:** network-first navigations with a cached fallback to `/offline`; cache-first/stale-while-revalidate for hashed static assets and fonts.
- **Never cached:** `/api/*` (NetworkOnly), WebSocket traffic, tokens, or party data. No offline mutation queue or background sync.
- **Caches:** versioned per build; activation removes old caches.
- **Headers:** the service worker is served with `no-cache, no-store, must-revalidate`, `Service-Worker-Allowed: /`, and a JavaScript content type.
- **Offline indicator:** a small drawably "Sin conexión" badge driven by `online`/`offline` events.
- **Boundary:** Task 05 makes the shell load offline; offline gameplay arrives in Task 06.

## Game engine (implemented, Task 03)

- **Location:** `lib/parchis/`, imported as `@/lib/parchis`. Pure TypeScript with zero imports from React, PixiJS, Next.js, the DOM, or the network. No runtime dependencies.
- **Modules:**
  - `constants.ts` — board geometry and rule numbers (the contract the PixiJS board must render).
  - `types.ts` — public JSON-safe types: `GameState`, `Player`, `Token`, `Move`, `BonusMove`, `GameEvent`, etc.
  - `errors.ts` — `GameError` with stable `code`s: `INVALID_PLAYERS`, `INVALID_ROLL`, `INVALID_POSITION`, `WRONG_PHASE`, `ILLEGAL_MOVE`, `MUST_MOVE`, `INVALID_BONUS`, `GAME_OVER`, `INVALID_STATE`.
  - `rules.ts` — pure read-only helpers: track mapping, occupancy, barriers, entry check, `checkAdvance`, `getLegalMoves`, `getLegalBonusMoves`, `validateState` (invariant checker).
  - `engine.ts` — actions: `createGame`, `rollDie`, `roll`, `applyMove`, `pass`, `applyBonusMove`, `isFinished`, `getWinnerId`.
  - `index.ts` — the only public entry point.
  - `test-helpers.ts`, `*.test.ts` — test-only (position builder, deep-freeze, seeded `mulberry32`); not re-exported.
  - `bun-test.d.ts` — minimal ambient types for `bun:test`; kept alongside `@types/bun` (added by the PixiJS board), and `tsc --noEmit` passes with both.
- **Ruleset:** Classic Parchís mode. One die; enter only on 5 (mandatory when possible, a complete move, never captures); 6 grants an extra roll; 6 counts as 7 when no token is in the yard (goal tokens count as out); capture +20 bonus; goal +10 bonus; barriers; three consecutive 6s penalty; exact roll to the goal.
- **Classic vs Spanish mode:** classic forbids two different colours resting on the same safety square (landing there is illegal, passing is allowed); Spanish mode is out of scope. Mixed-colour blockades cannot exist.
- **Board constants:** 68 outer squares; starts at 0/17/34/51 (red/blue/yellow/green); route progress 0–63 on the outer track (absolute index `(start + progress) % 68`), 64–70 in the private home column, 71 at the goal; 12 safe squares `0, 4, 11, 17, 21, 28, 34, 38, 45, 51, 55, 62`. No colour's home entrance (progress 63) is a safe square.
- **Visual counterpart:** `lib/parchis/board-geometry.ts` owns the 21×21 reference layout, chamfered inner corners, corridors, yard slots, and physical/view-aware positions. The artwork paints starts, each colour's `start + 7` brown mark, and entrance tips at 17/34/51/68 (five squares before each colour's start); these are not the engine's 12 safe squares. The engine's colour IDs (red 0, blue 17, yellow 34, green 51) must be mapped explicitly to the artwork's corner colours before connecting the board to the engine.
- **Occupancy:** max 2 tokens per outer square, same colour only. Two tokens form a barrier that blocks passing and landing for everyone (owner included). Home column and goal are private, unlimited and capture-free.
- **State:** JSON-safe and fully public (`schemaVersion: 1`, `mode: "classic"`), no `Map`/`Set`/`Date`/functions. The die value is supplied by the caller (`rollDie(random)` is a helper). Actions are taken implicitly by the current player; the caller authenticates the sender.
- **Purity:** every action validates first, then returns a new state built from copies; inputs (even deep-frozen) are never touched. On error the state is unchanged.
- **Phases:** `awaiting-roll` → `roll` → `awaiting-move` → `applyMove` or `pass` (only when no legal move; never automatic) → optional `awaiting-bonus` (`applyBonusMove`, mandatory; auto-forfeited and logged when no legal bonus) → extra roll on a 6 (same seat, same `turn`) or next seat (`turn + 1`, roll/sixes/last-moved/bonus reset) → `finished` when one player has all four tokens at the goal.
- **Three 6s:** handled inside `roll`; the third 6 never reaches `awaiting-move`. The token moved most recently this turn (normal or bonus move) returns to the yard only if it is on the outer track.
- **Event log:** append-only `log` of `roll`, `enter`, `advance`, `capture`, `bonus-move`, `bonus-forfeited`, `pass`, `three-sixes`, `win`; every event carries its `turn`. UI layers animate from it.
- **Tests:** `bun test` (49 tests: every edge case from the brief, plus 500 seeded random games with invariant checks after every action and a determinism replay check).
- **Boundary:** the engine owns rules only. PixiJS renders the board; React/drawably render app chrome; networking (Task 04) and the local controller (Task 06) call these functions.

## Realtime parties and networking (planned Task 04)

- **HTTP:** Next.js App Router route handlers under `app/api/parties/` create parties, join by code, expose public lobby info, and return authenticated reconnect snapshots.
- **WebSocket:** Next route handlers cannot perform an HTTP upgrade, and serverless hosts drop long-lived sockets. A custom Node server (`server.ts`) runs Next plus a `ws` server and handles `/api/ws`; all other upgrades (including dev HMR) are forwarded to `app.getUpgradeHandler()`.
- **Scripts:** `bun dev` / `bun start` run `tsx server.ts`, not `next dev` / `next start`.
- **Store:** a single in-memory `PartyStore` attached to `globalThis` so the custom server and Next route-handler bundles share it. The store is the only room source of truth and emits events that the WS layer broadcasts.
- **Rooms:** 6-character codes, up to 4 players, 2–4 to start, host is seat 0, colour assignment at start (2 → red/yellow, 3 → red/blue/yellow, 4 → all), versioned state.
- **Auth:** raw 32-byte player tokens are returned once; only SHA-256 hashes are stored. Tokens are sent in the AUTH message, never in URLs.
- **Protocol:** JSON messages over `/api/ws`, protocol version 1. Clients AUTH first, then send `START`, `ROLL`, `MOVE`, `BONUS_MOVE` with the last seen version. The server rolls the die, validates through the pure engine, increments the version, and broadcasts the authoritative state plus new events.
- **Reconnect:** a valid player token restores the full snapshot; one active socket per player (`4001 REPLACED` on replacement).
- **Transport abstraction (Task 04):** `lib/party/transport.ts` defines `GameTransport`; the abstract `GameSession` is the only game API the UI may use. `WebSocketGameSession` is the first implementation; Task 07 adds WebRTC host/guest sessions without changing callers. `lib/party/authority.ts` holds shared, browser-safe action validation/auto-pass used by the server and the future P2P host.
- **Deployment:** requires a long-lived Node process (or a managed WS service). Vercel/serverless functions are unsupported for this layer. Rooms are lost on restart and the store is single-instance; horizontal scaling needs an external store/pub-sub.
- **Boundary:** `lib/party/` is shared protocol/client; `lib/server/party/` is server-only. Route handlers must not import `ws` or browser code.

## Local bot mode (planned Task 06)

- **Route:** `/bots` — one human (red) vs three bots (blue, yellow, green), fully local and offline.
- **Rules:** the same `lib/parchis` engine; the local controller uses `roll`, `applyMove`, `pass`, and bonus actions exactly like the server, including auto-pass and extra rolls.
- **Bots:** pure deterministic policy in `lib/bots/` that chooses only from legal moves. No cheating, no network.
- **Rendering:** a reusable PixiJS `GameStage` in `components/game/` draws the board, tokens, dice, HUD, highlights, and basic animations. Drawably renders the page chrome, instructions, dialogs, and game-over card. No drawably inside the canvas.
- **Persistence:** versioned `localStorage` snapshot; auto-resume unfinished games, discard corrupt/finished saves.
- **Offline:** zero `fetch`/WebSocket calls; `/bots` is added to the Task 05 precache so a cold offline reload can play.
- **Reuse:** the `GameStage` API is designed so the future online game screen can share it.

## P2P 1v1 (planned Task 07 — gated)

> **Gate:** Task 07 must only be started after Tasks 01–06 are complete and their `results/` summaries exist.

- **Topology:** two players in a `p2p-1v1` room. The existing WebSocket server handles only signaling/presence; all gameplay messages travel over a reliable, ordered WebRTC `RTCDataChannel`.
- **Authority:** the host peer owns the engine state, version, dice, and validation; the guest sends actions and adopts snapshots. This mirrors Task 04 and reuses the shared, browser-safe `lib/party/authority.ts`. The guest trusts the host; no anti-cheat or ranked play.
- **Session API:** the UI/`GameStage` depends only on the abstract `GameSession` from Task 04. `WebSocketGameSession`, `WebRTCPeerHostSession`, and `WebRTCPeerGuestSession` expose identical calls (`start`, `roll`, `move`, `bonusMove`, subscribe/dispose); `createGameSession(...)` selects the implementation from the room mode/role.
- **Signaling:** authenticated WS messages relay SDP offers/answers and ICE candidates only to the other player. Signaling payloads are size-capped, never persisted or logged; P2P rooms reject game actions over WS with `WRONG_TRANSPORT`.
- **ICE/TURN:** `GET /api/p2p/ice-servers` returns authenticated STUN/TURN config. TURN is needed for some NATs; credentials must be ephemeral and never committed.
- **Rules/UI:** host = red, guest = yellow, 2-player engine rules. Route `/versus/[code]`; the lobby uses drawably chrome and the game reuses Task 06's Pixi `GameStage`.
- **Lifecycle:** signalling reconnects independently; a dropped data channel pauses play and the host attempts an ICE restart and resends a full state snapshot. No host migration; a host reload ends the match. No silent fallback to WebSocket gameplay.
- **Out of scope:** 3–4 player P2P mesh, host migration, ranked/anti-cheat, matchmaking, rematches, and offline P2P (WebRTC needs network).

## Data and networking

- Game rules live in the pure engine (`lib/parchis/`); it has no UI, network, or persistence dependencies.
- Party and game state are in-memory only for now. No database, accounts, persistence across restarts, or multi-instance coordination yet.
- The full game state is public (no hidden information) and JSON-safe, so the server can broadcast it to every player.

## Conventions

- Read the relevant guide in `node_modules/next/dist/docs/` before writing code (per `AGENTS.md`).
- Prefer `drawably/react` for every control and container.
- Use PixiJS for the game board, tokens, dice, animations, in-game HUD, and all game-state updates. Use drawably/react for everything around the game. Keep the two layers separate.
- Every button or button-like control uses `select-none` (Tailwind) to prevent text selection on mobile long-press/double-tap. Native inputs and textareas stay selectable.
- All user-facing copy is in **Spanish**, even when briefs and code are in English: headings, buttons, labels, placeholders, helper/error text, metadata, manifest strings, and accessibility labels. Code identifiers, comments, and technical docs stay in English.
- Keep interactive pages as small client components; keep the root layout a server component.
- Keep server-only code in `lib/server/`; never import it from client components. Shared protocol/types live in `lib/party/protocol.ts` and must stay dependency-free.
- The server is authoritative: dice rolls, turn order, legal moves, and party membership are validated server-side. Clients never send die values or game state mutations that bypass the engine.
- Never log or put player tokens in URLs; store only token hashes server-side.
- Local/bot mode must make no network calls and must not import `lib/party` client code or `lib/server/*`. The engine + local controller are the only sources of truth there.
- The service worker is production-only and must never cache `/api/*`, WebSocket traffic, tokens, or party data.
- UI/game components depend only on the `GameSession` surface, never on a concrete transport. WebSocket and WebRTC sessions must expose the same calls; do not add transport checks to `GameStage` or screens.
- Accessibility is part of the UI: real labels, keyboard support, visible focus, `aria-pressed` / `aria-selected` where relevant.
- Respect `prefers-reduced-motion`; drawably already freezes boil and hover re-sketches. Do not add extra motion.
- Never edit `AGENTS.md` as part of a task.
- Each task file starts with the instruction to read `AGENTS.md` before changes and to update this document after.

## Task workflow

1. A task brief is written in `tasks/NN-<name>.md`.
2. The implementing AI reads `AGENTS.md`, then the task, then the relevant Next.js docs.
3. The implementing AI builds the scope exactly; no opportunistic features.
4. The implementing AI updates `architecture.md` to match reality.
5. The implementing AI writes a completion summary to `results/<same-name-as-the-task>.md` covering files, rationale, commands/tests, and deviations.
6. The task is reviewed against its acceptance criteria.

## Current status

- **Task 01 — Homepage (UI only):** complete. See `results/01-homepage.md`.
- **Task 02 — PWA shell (installable, full screen, placeholder icon):** complete. See `results/02-pwa.md`.
- **Task 03 — Parchís game engine (Classic mode):** complete. See `results/03-game-logic.md`.
- **Play board (`/play`, direct request, no task brief):** complete — square 21×21 reference board with free-hand PixiJS borders, home flowers, corridors, goal, position APIs, and a player-relative view (home always bottom-left, start always 1). See `results/play-board.md`.
- **Task 04 — Realtime parties (API routes + WebSockets):** pending.
- **Task 05 — Offline app shell (service worker + cache):** pending.
- **Task 06 — Offline bot mode (1 human + 3 bots, PixiJS board):** pending.
- **Task 07 — P2P 1v1 (WebRTC) + transport-agnostic sessions:** pending — **take only after Tasks 01–06 are complete and their results summaries exist.**
