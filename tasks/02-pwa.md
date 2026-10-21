# Task 02 — PWA shell: installable, full-screen, placeholder icon

**Read `AGENTS.md` before making any changes, and read and update `architecture.md` after making changes so the architecture is always current.**

## Outcome

Turn the app into an installable PWA that launches full screen, with a proper manifest, theme colors, iOS metadata, safe-area handling, and **placeholder** app icons. The final icon artwork is intentionally deferred to a later task; the placeholder icons exist only to satisfy installability requirements.

## Dependency

This task assumes Task 01 (homepage UI) has been completed. If it has not, do **not** build the homepage — only add the PWA shell. Do not remove or change the homepage controls required by Task 01.

## Scope

In scope:

- Web app manifest
- Installable icons (temporary)
- Full-screen display mode and app-like viewport behavior
- iOS/Apple metadata
- Safe-area and edge-to-edge styling

Out of scope:

- Service worker, offline caching, background sync, push notifications
- Install prompts or custom "Add to Home Screen" UI
- An in-app fullscreen toggle (full screen comes from the installed display mode)
- Final icon artwork

## 1. Web app manifest

Create `app/manifest.ts` exporting a `MetadataRoute.Manifest`:

- `name`: `"Parchís Stars"`
- `short_name`: `"Parchís Stars"`
- `description`: a short game description in Spanish, e.g. `"Juega al Parchís Stars con tus amigos: elige un avatar, comparte un código y tira los dados."`
- `id`: `"/"`
- `start_url`: `"/"`
- `scope`: `"/"`
- `display`: `"fullscreen"`
- `display_override`: `["fullscreen", "standalone", "minimal-ui", "browser"]`
- `background_color` and `theme_color`: the paper color used by the UI (match the actual page background; do not invent a new palette)
- `lang`: `"es"`
- `dir`: `"ltr"`
- `categories`: `["games"]`
- `icons`:
  - `/icons/icon-192.png` — `192x192`, `type: "image/png"`, `purpose: "any"`
  - `/icons/icon-512.png` — `512x512`, `type: "image/png"`, `purpose: "any"`
  - `/icons/icon-maskable-512.png` — `512x512`, `type: "image/png"`, `purpose: "maskable"`

Add a `TODO` comment in `app/manifest.ts` noting that the icons are placeholders and will be replaced by a later icon task.

## 2. Placeholder icons

Create these files under `public/icons/`:

- `icon-192.png` (192×192)
- `icon-512.png` (512×512)
- `icon-maskable-512.png` (512×512, safe zone respected)
- `apple-touch-icon.png` (180×180, opaque background)

Design guidance:

- Keep them deliberately simple and obviously temporary: paper/cream background, dark ink-colored hand-drawn circle or Parchís-board motif, optionally a bold "P".
- Maskable icon: keep all meaningful content inside the central ~80% safe zone; fill the entire canvas with the background color.
- No transparency for the Apple touch icon.
- Keep each file under ~100 KB.

Generate them with a one-off local script or existing tooling (`sharp` is already in `node_modules`, ImageMagick/sips are fine). Do **not** add a runtime dependency for this, and do **not** commit throwaway generation scripts unless they are genuinely reusable.

## 3. Metadata and viewport (`app/layout.tsx`)

Keep the root layout a server component and keep the single `drawably/style.css` import.

Add or update:

- `metadata`:
  - `applicationName: "Parchís Stars"`
  - `title` and `description` matching the game, in Spanish
  - `appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Parchís Stars" }`
  - `icons: { apple: "/icons/apple-touch-icon.png" }`
  - `formatDetection: { telephone: false }`
- `export const viewport: Viewport`:
  - `themeColor` matching the paper theme (move it here — `themeColor` in `metadata` is deprecated since Next.js 14)
  - `width: "device-width"`
  - `initialScale: 1`
  - `viewportFit: "cover"`
  - Do **not** disable pinch zoom (`maximumScale`, `userScalable`) — accessibility requirement.

Next.js automatically links `app/manifest.ts`; no manual `<link rel="manifest">` is needed.

## 4. App-like behavior and safe areas

In `app/globals.css` (or the appropriate app shell), add lightweight native-feel styling:

- Edge-to-edge background; use `min-height: 100dvh` where the page shell sets height.
- Safe-area padding using `env(safe-area-inset-top/right/bottom/left)` so nothing sits under a notch or home indicator in full-screen mode. Apply it once at the shell level to avoid double padding.
- `overscroll-behavior: none` on `html, body` to stop pull-to-refresh/bounce.
- `-webkit-tap-highlight-color: transparent`.
- Preserve normal text selection inside inputs/textarea; do not globally disable selection unless it is clearly limited to game chrome.

Do not add JavaScript for fullscreen; the installed app's `display` mode handles it.

## Acceptance criteria

- `bun run lint` passes and `bun run build` succeeds.
- `/manifest.webmanifest` returns valid JSON with `display: "fullscreen"`, the fallback list, and resolvable icon URLs.
- Manifest and metadata strings are in Spanish (per `AGENTS.md`), with `lang: "es"`.
- The manifest, 192 icon, 512 icon, maskable icon, and Apple touch icon all return `200` in dev and after build.
- Chrome/Edge DevTools → Application → Manifest shows no installability errors on localhost/HTTPS.
- Installing from Chromium opens the app without browser chrome (full screen or standalone, per support).
- iOS "Add to Home Screen" uses the Apple title and `apple-touch-icon`, and launches standalone.
- The page background reaches the screen edges and content respects safe areas.
- No console errors or hydration warnings.
- Task 01 homepage behavior is unchanged.
- No service worker or offline caching is added in this task.

## Definition of done

- Update `architecture.md` with: the manifest route, display mode, icon paths and their temporary status, metadata/viewport decisions, and safe-area handling.
- Report back with files changed, commands run, and any platform-specific caveats (especially iOS display-mode limitations).
