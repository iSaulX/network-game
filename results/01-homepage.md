# Task 01 — Homepage (UI only): completion summary

**Status:** Complete (Parchís Stars brand, OpenRunde app-wide, Title-case labels, image-only PFPs with neutral load fallback, rounded card backgrounds, HeroUI avatar popover, game icon, full-screen two-column desktop layout with a large `AvatarPfp`).

## Files changed

| File | Change | Why |
| --- | --- | --- |
| `package.json` | Added `drawably@^0.4.2` and `tw-animate-css@^1.4.0`; the existing `@heroui/react` / `@heroui/styles` are used | Drawably renders all sketch controls; HeroUI supplies the requested popover; `tw-animate-css` is required by HeroUI's popover CSS. |
| `bun.lock` | Updated by `bun add` | Lockfile for the dependencies. |
| `app/layout.tsx` | Imported `drawably/style.css` once; `lang="es"`; loaded OpenRunde from `public/fonts` with `next/font/local`; metadata now says "Parchís Stars" and has a Spanish description | Stylesheet wiring, document language, brand metadata, and the app-wide OpenRunde font. Kept the root layout a server component. |
| `app/globals.css` | Added the HeroUI style prelude (`tw-animate-css`, utilities, variants, default theme, popover component CSS) plus paper/ink theme overrides (`--overlay`, `--overlay-shadow`, drawably variables, accents, background texture, selection) | HeroUI's popover needs its prelude and animation utilities; the app's paper theme must win over HeroUI's overlay colors. |
| `app/page.tsx` | Rebuilt the homepage: Parchís Stars brand and icon, random name + random avatar, controlled name input, large `AvatarPfp`, HeroUI avatar popover, two-column full-screen layout | Implements the latest UI: icon next to the title, two columns, avatar-first user column with the change trigger at the bottom. |
| `components/avatar-pfp.tsx` | Added the large `AvatarPfp`: a 128–144px drawably-circle PFP image with the avatar name below | Keeps the profile picture visually prominent and separates it from the trigger. The circle is keyed by the image so it redraws after avatar changes. |
| `components/avatar-visual.tsx` | Added the shared `AvatarVisual` image renderer using `next/image` with a neutral silhouette fallback on load error | Reused by the large `AvatarPfp` and the popover options; all eight avatars are images, with no emoji fallback. |
| `public/pictures/dog.png`, `monkey.png`, `chicken.png`, `face.png`, `octupus.png`, `bee.png`, `unicorn.png`, `poop.png` | Used as the eight avatar PFPs (assets provided by the user; not modified) | Rendered with `next/image` for the perro, mono, pollo, cara, pulpo, abeja, unicornio, and popó avatars. |
| `public/fonts/OpenRunde-*.woff` | Loaded as the app-wide OpenRunde font (assets provided by the user; not modified) | `next/font/local` registers Regular/Medium/Semibold/Bold and exposes `--font-open-runde`. |
| `components/drawably-trigger-button.tsx` | Added a ref-forwarding real `<button>` that attaches drawably's outline chrome | HeroUI's Popover trigger needs a ref-forwarding interactive element; drawably's React button does not forward refs. |
| `public/icon.png` | Used as the game icon (asset provided by the user; not modified) | Rendered with `next/image` beside the title. |
| `tasks/01-homepage.md`, `tasks/02-pwa.md` | Updated the briefs for the brand, random identity, HeroUI popover, icon, and two-column layout | Keeps the task specifications accurate. |
| `architecture.md` | Updated title/purpose, stack, structure, Homepage section, and status | Required by the task definition of done and `AGENTS.md`. |
| `results/01-homepage.md` | Updated this summary | Required by `AGENTS.md`. |

No changes were made to `AGENTS.md` during this task.

## Implementation notes

- **Header/icon:** `public/icon.png` (1254×1254) is rendered with `next/image` at 48/56px immediately left of the "Parchís Stars" title. It uses `alt=""` (decorative), `priority`, `object-contain`, and `mix-blend-multiply` so its white paper background blends into the page.
- **Font:** OpenRunde is loaded with `next/font/local` from `public/fonts/` (Regular 400, Medium 500, Semibold 600, Bold 700) and exposed as `--font-open-runde`. It is applied to the body and, through higher-specificity overrides, to drawably controls and the badge; the HeroUI popover inherits it. Geist is no longer loaded.
- **Title case:** visible labels avoid all-caps. The badge reads "Parchís Stars"; the popover heading reads "Elige tu avatar" with no uppercase transform. Only the party-code input value keeps its uppercase styling.
- **Card corners:** each of the three main `DrawablyCard` backgrounds uses `rounded-xl` (12px) so the paper corners no longer overlap the hand-drawn border.
- **Random identity:** the name is prefilled with one of 20 fun names and the avatar starts on a random one of the 8 options. All avatars are images from `public/pictures/`: perro (`dog.png`), mono (`monkey.png`), pollo (`chicken.png`), cara (`face.png`), pulpo (`octupus.png`), abeja (`bee.png`), unicornio (`unicorn.png`), popó (`poop.png`). Both defaults are generated client-side with `useSyncExternalStore` and stable server snapshots, so there is no hydration mismatch. The name is a controlled `DrawablyInput`; the avatar can be changed.
- **Two-column desktop:** the outer grid has a narrower profile column and a wider actions column. Left: the profile card, stretched to the right column's height, with the large `AvatarPfp`, name input, and "Cambiar avatar" trigger pinned to the bottom. Right: join and create cards stacked with equal heights. Mobile stacks the profile and then the two action cards.
- **AvatarPfp:** a large PFP image inside a drawably circle (128px mobile / 144px desktop) with the avatar name below and enough spacing for the hand-drawn oval. `AvatarVisual` renders the image with `next/image` as a circular `object-cover` PFP. If an image fails to load, `onError` shows a neutral silhouette placeholder, not an emoji. The circle is keyed by the image; React otherwise removes the SVG that drawably prepends when the avatar changes. This keeps the sketch visible through avatar changes, popover opening, and name typing.
- **Avatar images:** all eight avatars use the provided PFPs in `public/pictures/`; there are no emoji avatars in the picker or `AvatarPfp`.
- **HeroUI popover:** `Popover.Root` / `Popover.Trigger` / `Popover.Content` / `Popover.Dialog` from `@heroui/react`, with a controlled `isOpen`. The panel uses the paper background and ink text plus HeroUI's rounded/shadowed surface. The heading is `Popover.Heading`; the 8 options remain drawably buttons, each showing its circular PFP image.
- **Trigger:** the bottom-pinned, full-width "Cambiar avatar" drawably button forwards its ref to HeroUI/react-aria and exposes `aria-haspopup="dialog"` plus an `aria-label` with the current avatar. HeroUI supplies `aria-expanded`/`aria-controls`, focus scope, Escape, and outside-pointer dismissal.
- **Selection:** choosing an option updates the `AvatarPfp` image, avatar label, and trigger label, closes the controlled popover, and returns focus to the trigger. Escape also returns focus; outside pointer clicks close it.
- **Full-screen desktop:** `lg:h-dvh` + `lg:overflow-hidden`; no vertical/horizontal page scroll at 1440×900 or 1280×800. The profile and right columns are equal height. Mobile scrolls normally with no horizontal overflow.
- **Constraints:** all buttons, including the trigger and popover options, include `select-none`; the name and party-code inputs stay selectable. No network, routing, API, storage, or game logic. Drawably is used for every control except the explicitly requested HeroUI popover shell.

## Commands and verification

| Command/check | Result |
| --- | --- |
| `bun add drawably` / `bun add tw-animate-css` | Installed `drawably@0.4.2` and `tw-animate-css@1.4.0`. |
| `bun run lint` | Passed. |
| `bunx tsc --noEmit` | Passed. |
| `bun run build` | Passed; `/` prerendered as static content. |
| Desktop 1440×900 | No vertical/horizontal page scroll. Icon loaded via `next/image` and positioned left of the title. Two columns side by side, aligned top and equal height. Join/create stacked on the right. `AvatarPfp` circle >100px with drawably SVG paths. Change trigger full-width and pinned to the profile card bottom. All three card backgrounds compute to `border-radius: 12px`. |
| Fonts/copy | Body, badge, trigger, and popover heading compute to the OpenRunde font stack; the badge reads "Parchís Stars"; the popover heading reads "Elige tu avatar" with `text-transform: none`. |
| Identity checks | Random name from the 20-name list; random avatar out of 8; the large `AvatarPfp` and label match the selected avatar; no hydration warnings. |
| Avatar media checks | Popover shows exactly 8 image options and 0 emoji options; all 8 images load; selecting perro shows the large `next/image` dog PFP; selecting mono shows the large monkey PFP; image-to-image selection updates the circle and label. |
| HeroUI popover | 8 drawably options; exactly the current avatar selected; focus inside the HeroUI dialog; `aria-expanded`; paper background; fits desktop and mobile viewports. |
| Selection/dismissal | Choosing another avatar updates `AvatarPfp`, label, and trigger, closes the popover, and returns focus. Escape returns focus; a real outside mouse click closes it. |
| Persistence of sketch | The `AvatarPfp` circle SVG is still present after avatar changes, opening/closing the popover, and typing a new name. |
| Desktop 1280×800 | No vertical/horizontal scroll; still two columns. |
| Mobile 375×812 | Columns stack (profile, then join/create); icon loads; no horizontal overflow; HeroUI popover fits. |
| Input checks | Name: controlled, prefilled random, `maxLength=24`, `autoComplete="name"`, editable, selectable. Party code: `maxLength=6`, `autoComplete="off"`, `spellCheck=false`, selectable. |
| Button checks | All buttons, including the trigger and popover options, include `select-none`. |
| Console check | No console errors, warnings, or exceptions (the Next Image quality warning was removed by using the default quality). |
| Visual checks | Desktop closed/open/selected and mobile-open screenshots captured and inspected. |

## Deviations / follow-ups

- The HeroUI popover is an explicit exception to the drawably-only rule. Only the popover shell uses HeroUI; its trigger and option buttons are drawably, and no other HeroUI components are used.
- Drawably's React button does not forward refs, so the trigger uses a small local wrapper that renders a real button and attaches drawably chrome directly.
- `AvatarPfp` is keyed by the image because drawably appends its SVG directly to the React-managed element; without the key, React removes the circle when the avatar changes.
- All eight avatar options are images; there are no emoji avatars. If an image fails to load, the shared `AvatarVisual` shows a neutral silhouette instead of an emoji. Only the existing `public/pictures/*.png` assets are used; no new avatar assets were added.
- The HeroUI popover has a rounded, shadowed surface by design (per the explicit request), rather than a sketch card.
- Create uses the `outline` variant with a green accent rather than `scribble`, because the scribble hatching made the label unreadable; the brief allows either.
- The random identity is client-only and not persisted; refreshing generates a new name/avatar, and the name remains editable. Wiring identity into party creation/joining is a later task.
- The page is pinned to the light paper theme; dark mode remains a later task.

## Follow-up: homepage copy trim (2026-11-02)

- Removed the "Parchís Stars" badge that sat above the logo.
- Removed the subtitle "Elige tu avatar, consigue un código y llama a tus amigos a la mesa."
- Removed the footer line "Hecho a mano. Jugado entre amigos."
- Dropped the now-unused `DrawablyBadge` import from `app/page.tsx`.
- No layout or behaviour changes beyond the removed elements; the accent dots,
  logo, highlighted title, profile card and mode cards are unchanged.
- Verified with `npx tsc --noEmit` and `npx eslint app/page.tsx` (both pass).
