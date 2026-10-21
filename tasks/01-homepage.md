# Task 01 — Homepage (UI only)

**Read `AGENTS.md` before making any changes, and read and update `architecture.md` after making changes so the architecture is always current.**

## Outcome

Build the **Parchís Stars** homepage at `/` as a full-screen desktop shell. It is a visual shell only: the player gets a random display name and a random avatar, can edit the name and change the avatar from a popover, type a party code, and see "Join party" and "Create party" actions. Nothing needs to connect to a server, route anywhere, or persist. Avatar selection and popover open/close use local state; the name field is controlled.

## Stack and constraints

- Next.js 16 App Router, React 19, TypeScript.
- Use `drawably/react` for every control and container, with one explicit exception: the avatar picker popover shell must use **HeroUI's Popover** as requested below. The popover trigger and every avatar option remain drawably buttons. Do not hand-roll sketch styling with CSS borders or shadows.
- Import `drawably/style.css` **once**, in `app/layout.tsx`.
- Use `@heroui/react` (`Popover.Root`, `Popover.Trigger`, `Popover.Content`, `Popover.Dialog`) for the avatar popover. Import the required HeroUI style prelude in `app/globals.css` (`tw-animate-css`, `@heroui/styles/utilities`, `@heroui/styles/variants`, the default theme, and the popover component CSS). Do not use HeroUI for any other control.
- No backend, websocket, API route, database, routing, localStorage, or game logic.
- The only allowed new dependencies are the already-present `@heroui/react` / `@heroui/styles` and `tw-animate-css` (required by HeroUI's popover CSS). Do not add others.
- Load **OpenRunde** from `public/fonts/` with `next/font/local` in the root layout (Regular 400, Medium 500, Semibold 600, Bold 700). Expose `--font-open-runde` and apply it to the whole app: body text, drawably controls, the badge, and the HeroUI popover. Do not load Geist.
- Use Title case / sentence case for labels; do not render all-caps labels. The badge is "Parchís Stars" and the popover heading is "Elige tu avatar" with no uppercase transform. (The party-code input may still visually uppercase its value.)
- Give every `DrawablyCard` a `rounded-xl` background so the paper corners do not overlap the hand-drawn border.
- Read the relevant Next.js guides in `node_modules/next/dist/docs/` before writing code, per `AGENTS.md`.
- Leave `AGENTS.md` alone (`next dev` rewrites it).
- All user-facing copy is **Spanish** (per `AGENTS.md`), even though this brief is written in English. Keep the page accessible: real labels, focus states, keyboard usable.
- Every `DrawablyButton` (avatar trigger, popover options, Join, Create) must include `className="select-none"` so mobile long-press/double-tap cannot select the label. Do not apply it to the name or party-code inputs.

## Setup

1. Install drawably with the project's package manager: `bun add drawably`. `@heroui/react` and `@heroui/styles` are already present; add `tw-animate-css` for HeroUI's popover animations.
2. In `app/layout.tsx`, import `drawably/style.css` exactly once and update `metadata` to the Parchís Stars title/description.
3. In `app/globals.css`, add the HeroUI style prelude and the popover component CSS (with `tw-animate-css`) after `@import "tailwindcss"`, then keep the app's paper theme overrides.
4. `app/page.tsx` can be a client component (`"use client"`) because the random identity, controlled name, avatar selection, and popover use local state. Keep the root layout a server component.

## Page layout

A warm paper background with the game's ink strokes.

- **Header** (above the containers)
  - A small `DrawablyBadge` eyebrow such as "Parchís Stars".
  - A row with the game icon and the title: load `public/icon.png` with `next/image` and place it immediately to the left of the "Parchís Stars" title. The icon is decorative (`alt=""`), uses the paper/ink look, and must be loaded eagerly.
  - Large title: "Parchís Stars", with one word decorated using `DrawablyUnderline` or `DrawablyHighlight`.
  - One short subtitle line, e.g. "Elige tu avatar, consigue un código y llama a tus amigos a la mesa."
- **Desktop (lg and up):** the entire homepage must fit exactly one viewport with **no page scrolling** (verify at 1280×800 and 1440×900). Use a **two-column** grid:
  1. **Left column:** the profile container. It holds the large `AvatarPfp`, the name field, and the avatar-change trigger pinned to the **bottom** of the column.
  2. **Right column:** the join and create containers stacked vertically; the two cards share the column height.
- **Mobile:** stack the profile column and then the join/create cards vertically; normal page scrolling is expected and fine.
- Containers are separate cards, not sections separated by dividers. Use a compact content width (e.g. `max-w-4xl`) and spacing so desktop has no scroll.

## 1. User profile (AvatarPfp + name + avatar popover)

- One `DrawablyCard` titled "Tu perfil" forming the left column on desktop. It must stretch to the height of the right column, with the avatar-change trigger pinned to the bottom edge.
- Create an **`AvatarPfp`** display component for the large profile picture: a large avatar image inside a hand-drawn `DrawablyCircle` (roughly 128–144px), with the avatar name (e.g. "Perro") below it. Render the image with `next/image` as a circular image (`object-cover`). The component must redraw when the avatar changes.
- A shared `AvatarVisual` component should handle the image rendering for both the large `AvatarPfp` and the small popover options. Images are decorative (`alt=""`) because the surrounding label/`aria-label` names the avatar. If an image fails to load (`onError`), render a neutral silhouette/placeholder — **do not fall back to an emoji**.
- A controlled `DrawablyInput` labeled "Tu nombre", placeholder "Jugador", `maxLength={24}`, `autoComplete="name"`. It is prefilled on the client with one random name from a collection of 20 fun Spanish names (include "Mono Galáctico" and "Waffle Interestelar"; the rest can be similar random/fun names). Do not generate the random value in a way that causes a hydration mismatch. No persistence or validation logic.
- The avatar picker must **not** show the full grid by default. The large `AvatarPfp` displays the current avatar, and a `DrawablyButton` labeled "Cambiar avatar" triggers the popover. Pin that trigger to the **bottom** of the profile column (full width), under the name field. Pick a **random avatar by default** from the 8 options, using the same hydration-safe client-only technique as the name.
- Pressing the trigger opens a **HeroUI Popover** (`Popover.Root` / `Popover.Trigger` / `Popover.Content` / `Popover.Dialog`) with **8 avatar options** in a 4×2 grid. All eight are images from `public/pictures/`; do not render emojis in the avatar picker or `AvatarPfp`:
  - `dog.png` → perro
  - `monkey.png` → mono
  - `chicken.png` → pollo
  - `face.png` → cara
  - `octupus.png` → pulpo
  - `bee.png` → abeja
  - `unicorn.png` → unicornio
  - `poop.png` → popó
  - Render all eight with `next/image` in both the large `AvatarPfp` and the popover options. If an image fails, show the neutral silhouette fallback, not an emoji.
- Trigger requirements: a real drawably-rendered button that forwards its ref (HeroUI/react-aria needs it), `aria-haspopup="dialog"`, a Spanish visible label, and an `aria-label` that includes the current avatar name. Let HeroUI/react-aria manage `aria-expanded`, `aria-controls`, focus return, Escape, and outside-click dismissal.
- Popover requirements:
  - Use HeroUI's Popover component and styles; do not build a second custom popover wrapper or hand-position it.
  - Give the popover panel the paper background and ink text so it sits with the app theme. The HeroUI shadow/rounded surface is expected.
  - Use `Popover.Heading` for the Spanish "Elige tu avatar" title.
  - Each option is a real `DrawablyButton` with an `aria-label` ("Elegir avatar perro"), `aria-pressed`, `variant="solid"` when selected and `"outline"` when not. Its visual content is the circular PFP image.
  - Selecting an option updates the `AvatarPfp`, the trigger label, and the avatar label; closes the popover (controlled `isOpen`); and returns focus to the trigger.
  - Opening/dismissal/focus behavior comes from HeroUI/react-aria; keep it keyboard operable.
- Do **not** add new avatar asset files. Use only the eight existing images in `public/pictures/`. The game icon is `public/icon.png`.
- Add a short helper line such as "Elige cómo te verán los demás."

## 2. Join a party (own container)

- Its own `DrawablyCard` titled "Unirse a una partida", placed next to the create container in row 2 on desktop.
- A `DrawablyInput` with a visible label ("Código de partida") and a placeholder like "ABC123".
- Constrain the input visually: `maxLength={6}`, uppercase-styled text, `autoComplete="off"`, `spellCheck={false}`. No validation logic and no error states are required.
- A `DrawablyButton` labeled "Unirse a la partida" (`variant="solid"`). It needs no `onClick`; if one is added it must be a harmless no-op.
- Optional helper text: "Pídele el código al anfitrión."

## 3. Create a party (own container)

- Its own `DrawablyCard` titled "Crear una partida", placed next to the join container in row 2 on desktop.
- One `DrawablyButton` labeled "Crear una partida" (use `variant="scribble"` or `"outline"` so it is visually distinct from Join, but still prominent). No handler needed.
- Optional one-line helper: "Abre una mesa y comparte el código con tus amigos." The button should sit at the bottom of the card when the two row-2 cards have equal heights.

## Visual direction

- Theme via drawably's custom properties (`--drawably-stroke`, `--drawably-fill`, `--drawably-paper`, `--drawably-width`) rather than restyling the SVG paths.
- Warm paper background (cream/off-white), dark ink strokes, and Parchís accent colors (red, blue, yellow, green) used sparingly — for example in the badge or active avatar.
- A page title set with the app's own fonts is fine. Do not apply the Drawably Pen font unless it is already part of the design.
- The page may be pinned to the light paper theme; dark-mode support can wait for a later task, but text must remain readable.

## Acceptance criteria

- `bun dev` renders `/` with no console errors and no hydration warnings.
- `bun run lint` passes.
- Every control is drawably except the HeroUI avatar popover shell; no CSS-drawn fake borders.
- Every button-like control, including the avatar trigger and popover options, includes `select-none`; both the name and party-code inputs remain selectable.
- All visible UI text, placeholders, helper lines, and `aria-label`s are in Spanish, with correct accents.
- The game brand is **Parchís Stars**: metadata title/description, badge ("Parchís Stars"), and page title all use it.
- OpenRunde is loaded with `next/font/local` and applied app-wide; computed fonts for body text, drawably controls, the badge, and the popover include OpenRunde.
- Labels use Title/sentence case, not all caps: the badge reads "Parchís Stars" and the popover heading reads "Elige tu avatar" with `text-transform: none`.
- Each of the three `DrawablyCard` backgrounds has `rounded-xl` (12px) so its corners do not overlap the hand-drawn border.
- `public/icon.png` is rendered with `next/image` immediately to the left of the title, loads successfully, and is decorative (`alt=""`).
- The profile, join, and create areas are separate `DrawablyCard` containers. On desktop they form two columns: profile on the left; join and create stacked on the right. The profile card contains the large `AvatarPfp`, the controlled "Tu nombre" input, and the avatar trigger pinned to the bottom.
- On the client, the name is prefilled with one of 20 fun default names and the avatar starts on a random option; the large `AvatarPfp` shows that avatar, both are editable/changeable, and neither causes a hydration warning.
- All eight avatar options use their `public/pictures/` images with `next/image` in both the large `AvatarPfp` and the popover options; no emojis appear in the avatar picker or `AvatarPfp`. An image that fails to load shows a neutral silhouette, not an emoji.
- The avatar popover is closed by default and uses HeroUI (`Popover.Root`/`Trigger`/`Content`/`Dialog`). It opens on the drawably trigger, displays 8 drawably image options with exactly one selected, updates the `AvatarPfp` and trigger on selection, and closes after selection.
- Popover accessibility works through HeroUI/react-aria: `aria-haspopup`/`aria-expanded`/`aria-controls`, Escape closes and returns focus to the trigger, and a real outside pointer click closes it.
- Join and Create are visible, focusable, and clickable, and do nothing observable.
- No network requests, navigation, or persistence are introduced.
- Desktop fits exactly one viewport with **no page scrolling** at 1280×800 and 1440×900, using the two-column layout with equal-height columns. Mobile stacks the profile and then the join/create cards, scrolling normally at 375px with no horizontal overflow.
- `drawably/style.css` is imported exactly once, in the root layout. HeroUI's required style prelude and popover CSS are imported in `app/globals.css`, and no other HeroUI components are used.
- `AGENTS.md` is unchanged.

## Definition of done

- Update `architecture.md` with: the homepage route, the Parchís Stars brand, the game icon, the two-column full-screen desktop layout, the profile column with image-only `AvatarPfp` and bottom-pinned avatar trigger, the random name/avatar defaults, the HeroUI avatar popover (trigger + styles), the `AvatarVisual` image-only rendering and neutral fallback, which drawably components are used, how drawably is wired (style import, theme variables), and the fact that homepage state is local-only.
- Write/update `results/01-homepage.md` per `AGENTS.md` with the files changed, rationale, commands/tests, and deviations.
- Report back with the files changed, the commands run, and any deviations from this brief.
