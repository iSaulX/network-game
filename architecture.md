# Architecture — Parchís Stars

> Living document. Every task must leave this file more accurate than it found it.

_Last updated: 2026-11-01 (Tasks 01–03 implemented; `/play` is a local four-player two-dice Parchís game with human-relative numbering from the bottom-left exit, compact textless drawably dice trays beside each player card, mobile seats above/below the board, Pixi chip interpolation, per-die chip popovers, automatic entry/pass and winner screen; briefs 04–07 pending)_

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
- **Game rendering:** **PixiJS** (`pixi.js` 8.22.0) — board, chips, board animations, legal-move highlights, and every board/game-state update
  - One Pixi `Application` mounted in a client component; React handles mounting plus the UI around it
  - Drawably controls cannot live inside the Pixi canvas
  - The `/play` board, chips, turn highlights and chip interpolation are PixiJS in `components/game/`; the reusable local/bot `GameStage` remains Task 06, but the board/dynamic-layer split is already in place
  - **Requested exception:** at the project owner's request the two-dice controls are DOM drawably cards placed above/below each player card, not Pixi sprites. They are the only game controls outside the canvas; all board/token rendering remains Pixi.
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
  play/           `/play` local game page: engine state + drawably panels around the square PixiJS board (implemented)
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
    parchis-board.tsx  Client component: mounts one square Pixi Application, loads chip textures, draws board/chips with view-relative numbers, interpolates chip movement, and reports token taps
    board-drawing.ts   Pixi drawing: one static BoardScene (walnut table, oak frame, grain, homes/flowers, corridors, player-relative numbers, goal X, free-hand borders) plus reusable destination/chip layers
    game-players.ts    Temporary local roster (names, avatars, artwork colours, engine colours); Bruno is the human and rolls first
    player-panel.tsx   Compact drawably profile card: avatar, name, colour, human marker, turn/winner badge; no count tiles
    dice-card.tsx      Minimal drawably dice tray per player: two tiles, active-seat colour border, barrier choice and bonus badge only when needed
public/
  fonts/          OpenRunde Regular/Medium/Semibold/Bold (woff/otf)
  icons/          PWA icons + Apple touch icon (placeholder artwork; a later icon task replaces it)
  pictures/       Avatar PFPs: dog, monkey, chicken, face, octupus, bee, unicorn, poop
  chips/          Supplied chip art; `chips/tokens/{color}.png` are the 256 px transparent game assets
  dices/          Supplied die art; `dices/faces/{1..6}.png` are the 256 px transparent game assets
  icon.png        Game icon used beside the Parchís Stars title
  sw.js           Generated service worker (gitignored, pending Task 05)
lib/
  parchis/        Pure Classic Parchís engine, two-dice variant + bun tests (implemented)
    board-geometry.ts  21×21 reference-board layout, 68-cell polygons, corridors, goal, yards, starts/entrances/safe marks, and physical/view-aware position helpers (implemented)
    board-geometry.test.ts  `bun test` coverage for the reference geometry, adjacency, positions, and player view
    presentation.ts    Pure engine→artwork bridge: colour mapping, chip layout/stacking, destinations, two-die views with used flags, board-percent anchors, Spanish progress labels
    presentation.test.ts  Colour mapping, safe-mark alignment, chip stacking, destination dedupe, two-die visibility/used flags, board anchors
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
| `/play` | Local four-player Parchís (pass-and-play) with a PixiJS board, human-relative view, drawably player cards and dice cards (implemented) | `GameState` in browser memory; placeholder profiles; no network or persistence |
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

## Playable game (`/play`, implemented)

- **Route and mode:** `app/play/page.tsx` is a local, pass-and-play Parchís game for four placeholder players (Ana/green, Bruno/blue, Carla/red, Diego/yellow). The bottom-left panel (Bruno/blue) is **you**: the human starts the game, the board is oriented to that colour's home, and the cards around it are placed by their view-relative corners. React owns the `GameState`; every action uses the pure engine (`roll`, `chooseBarrier`, `applyMove`, `applyBonusMove`). There is no network, persistence, bot, or authentication layer; reloading starts a new game. Names and avatars are temporary.
- **Current rules (two-dice variant):** two d6 are always thrown and never summed; each die is a separate move and both must be used while both have legal moves. A 5 die releases one token automatically and is spent; a total of 5 spends both dice and releases one token; double 5 releases two tokens when the start allows. Doubles grant an extra roll; the third consecutive double sends the last moved outer-track token to the yard. Both dice even must break an own barrier with one die (automatic when only one is breakable; player choice when there are several; skip when none can break). No legal move passes automatically. Captures, safe squares, exact goal, and the +20/+10 bonuses remain; the 6→7 conversion, 6 extra roll, and three-sixes penalty are gone.
- **Engine ↔ artwork mapping:** `lib/parchis/presentation.ts` renames the engine colours to the artwork colours (engine red→board green, blue→blue, yellow→red, green→yellow). The engine starts (0/17/34/51) and the artwork starts (zero-based 4/21/38/55) differ by a constant +4, so a token's engine progress (0–71) is used unchanged with the mapped artwork colour. `getBoardColor`, `getEngineColor`, `progressToSquare`, and the geometry helpers place every token; the previous colour/start mismatch is resolved.
- **Safe squares:** the four colour starts (5/22/39/56) are safe and keep their corridor paint. The eight brown/dark marks around the map are the engine's non-start safe squares at **start + 7** and **start + 12**: 12/17, 29/34, 46/51 and 63/68. Four of those marks are also the corridor entrance tips, painted darker brown. A `presentation.test.ts` case ties every painted mark back to `SAFE_SQUARES` through the colour mapping.
- **Board geometry:** `lib/parchis/board-geometry.ts` is pure TypeScript (no React, PixiJS, Next.js, or DOM). It models the reference artwork on a **21×21 unit play surface**: four 7×7 homes, three-lane arms, three-row side strips, a 5×5 central goal split by its diagonals, and the 68-square track. All eight inner-corner cells (8, 9, 25, 26, 42, 43, 59, 60) are chamfered by the goal X. `/play` uses the human-relative view: the human's colour is bottom-left, the play area rotates by `getBoardView(color).rotation`, labels are counter-rotated to stay upright, and the card corners come from `getViewCorner`. The human is blue today, so rotation is 0; another human colour would rotate the board and re-place the four panels.
- **Track numbering:** the physical artwork numbers 1–8 down the top-left lane, 9–16 leftward, 17 at the left tip, 18–25 rightward, 26–33 down the bottom-left lane, 34 at the bottom tip, 35–42 up the bottom-right lane, 43–50 rightward, 51 at the right tip, 52–59 leftward, 60–67 up the top-right lane, and 68 at the top tip. On screen, `/play` prints **view-relative** numbers from the human's exit: the human's start is always 1, and the home entrance is 64. The same numbering is used in move popovers, barrier labels, and event narration.
- **Colour layout:** green top-left (start **5**, entrance **68**), yellow top-right (56/51), red bottom-right (39/34), blue bottom-left (22/17). Each colour has seven private corridor cells ordered from the entrance toward the goal; progress 64–70 maps to them and progress 71 to the colour's goal triangle; the four entrance tips are darker brown and are safe (another colour's start+12).
- **Position API:** `getBoardPositions(playSize, originX, originY)` returns physical pixel polygons and centres for every track square, corridor, yard/slot, and goal. `getBoardPositionsForCanvas(canvasSize)` applies the shared frame composition (`getBoardFrameLayout`: 6.5 % table margin and 4.5 % frame per side). Single physical lookups: `squareToPoint`, `getSquarePosition`, `progressToSquare`, `getProgressAnchor`/`getProgressPoint`, `getYardSlotAnchor`, `getYardRect`, `wrapSquare`. `presentation.ts` adds the engine bridge and the token/stack/destination/dice layouts. Invalid input throws `RangeError`.
- **Rendering split:** `components/game/parchis-board.tsx` dynamically imports PixiJS, mounts one square `Application`, observes the host with `ResizeObserver`, loads the chip textures with `PIXI.Assets`, and calls `drawBoard`/`drawGameLayers`. `board-drawing.ts` builds one static `BoardScene` (walnut table, oak frame and mitres, cream wood surface with procedural grain, homes with 16-petal flowers, painted corridors/special cells, central triangles, player-relative numerals, free-hand borders) and keeps two empty dynamic layers (destination markers and chips). Rolls and moves clear/redraw only those layers; the hundreds of grain and ink strokes are not rebuilt. Dice are DOM cards, never Pixi.
- **Chips and interactions:** `lib/parchis/presentation.ts` places each engine token from `getTokenViews` — yard slots keep their original slot, track tokens fan out when two share a square, corridor tokens fan along the cell, and goal tokens cluster inside the colour triangle. Legal tokens get a coloured glow, a larger hit area, and a pointer tap that opens a move popover instead of moving immediately; destination cells still get a translucent marker. The popover is a drawably card anchored from `getBoardAnchorPercent(anchor, viewColor)` to the chip; it lists every legal move for that chip with its die and the **view-relative** square (“Mover 4 a la casilla 23”), has a close control, and closes on outside pointer-down or Escape. It sits above the chip, flipping below near the top edge. `getBoardAnchorPercent` rotates board-unit anchors by the same view rotation as the Pixi play area before mapping them to canvas percentages. The frame's free-hand borders are seeded polylines, with shared cell edges merged and the two goal diagonals drawn as full X strokes.
- **Chips animation:** after each state draw, `ParchisBoard` compares each chip's previous painted position with its new anchor. Moved chips are placed at the old position and interpolated to the new one over 380 ms with an ease-out cubic curve; enter/capture/reset moves animate too. A new draw cancels the previous frame and starts from the last painted position. `prefers-reduced-motion: reduce` snaps immediately. The animation updates Pixi containers only; React does not re-render the board.
- **Dice:** `public/dices/faces/{1..6}.png` are 256 px transparent, cropped versions of the supplied dice art (the originals in `public/dices/*.png` are large and unused). Dice left the Pixi canvas: `components/game/dice-card.tsx` is a **minimal, textless dice tray** per player, placed on the inner side of that player's profile card. A top-half card has its tray **below** it; a bottom-half card has its tray **above** it. The active seat's tray gets the full player-accent sketch border, accent border on the two die tiles, and a faint accent wash; inactive trays use a muted accent border. There are no titles, player names, “Turno”, “Tira los dados”, “Esperando su turno”, latest-event lines, circular profile-style rings, or “?” inside the dice. Before a roll the two tiles are blank cream rectangles with the coloured border; after a roll they show the die images, with used dice dimmed. The active dice are the roll button (accessible name “Tirar tus dados” / “Tirar los dados de {name}”). Barrier choices appear as buttons only in `awaiting-barrier`; the capture/home bonus appears as a small badge only in `awaiting-bonus`. The obsolete “Tirar dados” turn card was removed.
- **Roll animation:** tapping the active dice starts a ~750 ms cycle in which both faces change every 90 ms and the images tumble with the `drawably-dice-tumble` CSS animation; there is no visible “Tirando los dados…” copy. The tray's moving dice are the feedback, then the engine roll commits and reveals both results. `prefers-reduced-motion: reduce` disables the tumble and commits immediately. A synchronous lock prevents double rolls; reset/unmount cancels the timers.
- **Panels and controls:** `components/game/game-players.ts` holds the temporary roster, marks Bruno as the human (`HUMAN_PROFILE`) and puts the human first in `GAME_PLAYER_CONFIGS`. `player-panel.tsx` is now a compact card with avatar, name, colour, a “Tú” marker on the human, and Turno/Gana badges (hidden on narrow cards). **Casa/Juego/Meta counters and their tiles are gone**, as is the explanatory footer under the page. `dice-card.tsx` is a dice-only tray with barrier buttons and a bonus badge only in those phases; it no longer shows a prompt or event narration. **The move list no longer lives below the board**, there is no manual pass, and there is no separate roll/turn card; the engine passes automatically. The winner panel appears under the board with “¡{name} gana la partida!” and “Jugar de nuevo”. All copy is Spanish; every button carries `select-none`.
- **Layout:** one responsive grid. Desktop uses `210px / remaining / 210px` columns; the top-left and top-right seats sit in row 1, the human and the fourth seat in row 2, with the board spanning both rows in the centre. **On mobile the two top seats sit above the board and the two bottom seats below it** (each profile card with its dice tray on the inner side), so the board is not buried under a long column of cards. Seats are positioned by `getViewCorner(color, humanColor)`, so changing the human's colour rotates both the board and the card corners while the human stays bottom-left. At 390×844 the board is 358×358, `scrollWidth === 390`, and the full page is ~894 px (only a small scroll); at 320×700 the board is 288×288, `scrollWidth === 320`, and the page is ~824 px. The canvas uses `touch-action: manipulation` so page scrolling still works.
- **Accessibility:** the canvas has a Spanish `role="img"` label; each dice tray has a descriptive `aria-label` and a visually hidden live status; the active tray has a labelled roll button; the winner panel has `aria-live="assertive"`. Each legal move has an invisible focusable target positioned over its chip (`pointer-events: none`, so Pixi still handles pointer input), labelled “Ficha N: mover 4 a …”; tabbing shows a focus ring and Enter/Space applies that move directly. Barrier choices are drawably buttons in the active dice tray.
- **Verification:** headless Chrome with SwiftShader covered desktop and mobile. A deterministic [5,2] roll auto-entered one token with the 5 used and the 2 remaining; the legal target labelled “Ficha 1: Mover 2 a la casilla 3” (human-relative) moved the chip and passed the turn, with no console errors. The desktop screenshot confirms the compact textless dice trays, the human card bottom-left, its tray above it, the top seats' trays below, the board numbers starting at 1 on the blue exit, and the brown safe marks. The 390×844 mobile screenshot confirms two seats above the board and two below, the human bottom-left, full names, no horizontal overflow, and a page height of 894 px; the 320×700 pass reports a 288×288 board, `scrollWidth === 320`, and 824 px. There are no Casa/Juego/Meta tiles, no circular “?” dice, and no footer text. The 500-game engine simulation and the 83-test suite are green; the earlier 445-action UI script was not rerun after the safe/UI pass.
- **Tests:** `bun test` currently reports 83 tests / 4,667 assertions; the 500-game simulation runs 176,423 actions (longest 639). Coverage includes setup, automatic entries (5/sum 5/double 5), separate dice order/splitting, both dice must be used, auto-pass, own barriers (auto/choice/no-break skip), doubles and the three-doubles penalty, base Classic occupancy/safe/capture/exact-goal/bonuses/win, purity/JSON, chip stacking, destination dedupe, two-die views/used flags, board-percent anchors, safe-mark alignment, view corners, view-relative progress labels, and invalid input. See the command table in `results/playable-game.md`.
- **Follow-ups:** four fixed local players with placeholder identity; no bots, networking, persistence, sound, ranking, or spectator mode. The automatic barrier break uses a deterministic first legal move (token order, then die order) because the player chooses only the barrier. The reusable local/bot `GameStage`, bot policy, and networked sessions remain Tasks 06/07.

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

## Game engine (implemented; Classic two-dice variant)

- **Location:** `lib/parchis/`, imported as `@/lib/parchis`. Pure TypeScript with zero imports from React, PixiJS, Next.js, the DOM, or the network. No runtime dependencies.
- **Modules:**
  - `constants.ts` — board geometry and rule numbers (the contract the PixiJS board must render): track/home/goal, safe squares, capture/home bonuses, `DOUBLES_PENALTY_COUNT`.
  - `types.ts` — public JSON-safe types: `GameState` with `schemaVersion: 2`, `dice: [DieState, DieState] | null`, `consecutiveDoubles`, `barrierChoice`, `Move` with a `die`, `BonusMove`, `GameEvent`, etc.
  - `errors.ts` — `GameError` with stable `code`s: `INVALID_PLAYERS`, `INVALID_ROLL`, `INVALID_POSITION`, `WRONG_PHASE`, `ILLEGAL_MOVE`, `MUST_MOVE`, `INVALID_BONUS`, `INVALID_BARRIER`, `GAME_OVER`, `INVALID_STATE`.
  - `rules.ts` — pure helpers: track mapping, occupancy, barriers, entry check, `checkAdvance`, `getRemainingDice`, per-die `getLegalMoves`, `getOwnBarriers`, `getEligibleOwnBarriers`, `getBarrierBreakMoves`, `pickAutoBarrierBreak`, `getLegalBonusMoves`, `validateState`.
  - `engine.ts` — actions: `createGame`, `rollDie`, `rollDice`, `roll`, `chooseBarrier`, `applyMove`, `applyBonusMove`, `isFinished`, `getWinnerId`. No manual pass.
  - `presentation.ts` — pure engine→artwork bridge used by the UI: colour mapping (engine red→board green, blue→blue, yellow→red, green→yellow), `getTokenViews` (yard/track/corridor/goal placement and stacking), destination views, two-die views with used flags, board-percentage anchors that rotate with a player view, and Spanish progress labels with optional view-relative numbering.
  - `index.ts` — the only public entry point.
  - `test-helpers.ts`, `*.test.ts` — test-only (position builder, deep-freeze, seeded `mulberry32`); not re-exported.
- **Ruleset (Classic two-dice variant):** two d6, **always separate, never summed**. Each die is one movement; both dice must be used while each has a legal move. A 6 moves 6 (no 6→7). Entry is automatic and mandatory: a 5 die releases one token and is spent; a total of 5 (1+4, 2+3) releases one token and spends both dice; double 5 releases two tokens when the start allows. Doubles grant another roll. The third consecutive double is not used for movement and sends the last moved outer-track token back to the yard (home column/goal exempt). Both dice even trigger the own-barrier rule. Base Classic rules are preserved: capture +20 bonus, goal +10 bonus, exact goal, safe squares, barriers, private home column/goal. No 6 extra roll and no three-sixes penalty; no legal move auto-passes.
- **Own barriers with two even dice:** one die must break an own barrier by moving one of its two tokens. If exactly one own barrier is breakable, the engine picks the first legal break (token order, then die order) and executes it automatically. If two or more are breakable, the state enters `awaiting-barrier` and the player chooses the barrier; the engine then executes the same deterministic break. If an own barrier exists but neither die can break one, the turn is skipped automatically without spending the dice.
- **Classic vs Spanish mode:** classic forbids two different colours resting on the same safety square (landing there is illegal, passing is allowed); Spanish mode is out of scope. Mixed-colour blockades cannot exist.
- **Board constants:** 68 outer squares; starts at 0/17/34/51 (red/blue/yellow/green); route progress 0–63 on the outer track (absolute index `(start + progress) % 68`), 64–70 in the private home column, 71 at the goal; 12 safe squares `0, 7, 12, 17, 24, 29, 34, 41, 46, 51, 58, 63`. Each colour's home entrance (progress 63) is safe because it is another colour's start+12.
- **Visual counterpart:** `lib/parchis/board-geometry.ts` owns the 21×21 reference layout, chamfered inner corners, corridors, yard slots, and physical/view-aware positions. The artwork's starts (5/22/39/56) and the engine's starts (0/17/34/51) differ by a constant +4, so `presentation.ts` maps engine red→board green, blue→blue, yellow→red, green→yellow and reuses the token's engine progress unchanged. The board paints the starts in their corridor colour and the eight brown/dark safe marks at start +7/+12: 12/17, 29/34, 46/51, 63/68. Four of those are also entrance tips (17/34/51/68) and are safe. `getViewCorner` rotates the four home corners for the human's perspective.
- **Occupancy:** max 2 tokens per outer square, same colour only. Two tokens form a barrier that blocks passing and landing for everyone (owner included), except the both-even own-barrier break above. Home column and goal are private, unlimited and capture-free.
- **State:** JSON-safe and fully public (`schemaVersion: 2`, `mode: "classic"`), no `Map`/`Set`/`Date`/functions. The two die values are supplied by the caller (`rollDice(random)` is a helper); each `DieState` carries a `used` flag. Actions are taken implicitly by the current player; the caller authenticates the sender.
- **Purity:** every action validates first, then returns a new state built from copies; inputs (even deep-frozen) are never touched. On error the state is unchanged.
- **Phases:** `awaiting-roll` → `roll` (automatic entries and barrier resolution) → `awaiting-barrier` when the player must choose one of several breakable own barriers → `awaiting-move` (one die per move, in any order, on one or two tokens) → optional `awaiting-bonus` (`applyBonusMove`, mandatory; auto-forfeited and logged when no legal bonus; the bonus spends no die) → automatic pass if no remaining die has a legal move → extra roll on a double (same seat, same `turn`) or next seat (`turn + 1`, rolls/doubles/last-moved/bonus/barrier reset) → `finished` when one player has all four tokens at the goal.
- **Doubles:** a double grants another roll after all dice/bonuses resolve; the third consecutive double is handled inside `roll` and never reaches a move phase. A no-move double still grants its extra roll. A no-legal-barrier-break skip does not grant the extra roll.
- **Event log:** append-only `log` of `roll` (dice pair), `enter` (die or null for sum 5), `advance` (die), `barrier-break` (die, square, automatic), `capture`, `bonus-move`, `bonus-forfeited`, `pass`, `three-doubles`, `win`; every event carries its `turn`. UI layers narrate/animate from it.
- **Tests:** `bun test` (83 tests across engine, rules, simulation, geometry and presentation: setup, automatic entries (5/sum 5/double 5), separate dice/order/splitting, auto-pass, both-even own barriers (auto, choice, blocked skip), doubles/three-doubles, base Classic captures/safe/barriers/bonuses/win, purity/JSON, view corners and view-relative labels, plus 500 seeded two-dice games with invariant checks and a determinism replay). The simulation ran 176,423 actions (longest 639). The original Task 03 audit found no deviations in the one-die base rules; the two-dice variant is specified by the project owner and covered by this suite.
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
- Use PixiJS for the game board, tokens, board animations, and all board/game-state updates. Use drawably/react for the UI around the game; the current `/play` dice cards are a direct owner-requested exception. Keep the two layers separate.
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
- **Play board (`/play`, direct request, no task brief):** complete — square 21×21 reference board with free-hand PixiJS borders, home flowers, corridors, goal, and position APIs. See `results/play-board.md`.
- **Playable local game (`/play`, direct request, no task brief):** complete — the reference board is a local four-player pass-and-play Parchís game using the two-dice classic variant, with human-relative numbering from the bottom-left exit, drawably dice cards beside each player card, Pixi chip interpolation, automatic entries/pass, own-barrier breaks, per-die chip popovers, bonuses, doubles/three-doubles, and a winner screen. See `results/playable-game.md`.
- **Task 04 — Realtime parties (API routes + WebSockets):** pending.
- **Task 05 — Offline app shell (service worker + cache):** pending.
- **Task 06 — Offline bot mode (1 human + 3 bots, PixiJS board):** pending.
- **Task 07 — P2P 1v1 (WebRTC) + transport-agnostic sessions:** pending — **take only after Tasks 01–06 are complete and their results summaries exist.**
