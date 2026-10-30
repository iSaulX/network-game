# Task 02 — PWA shell (installable, full screen, placeholder icons): completion summary

**Status:** Complete. The app now has a fullscreen web app manifest, four placeholder PNG icons, Spanish metadata plus an iOS Apple Web App block, a dedicated viewport export, and safe-area/edge-to-edge shell styling. No service worker, offline caching, install prompt, or in-app fullscreen toggle was added.

## Files created or changed

| File | Change | Why |
| --- | --- | --- |
| `app/manifest.ts` | **New.** Exports `MetadataRoute.Manifest` with the Parchís Stars name/description, `id`/`start_url`/`scope` `/`, `display: "fullscreen"`, the `display_override` fallback chain, paper colors, `lang: "es"`, `dir: "ltr"`, `categories: ["games"]`, and the three install icons. Includes a `TODO` noting the icons are placeholders. | Implements section 1 of the brief; Next.js serves it at `/manifest.webmanifest` automatically. |
| `public/icons/icon-192.png` | **New.** 192×192 PNG, 7.0 KB. | Required `any` installability icon. |
| `public/icons/icon-512.png` | **New.** 512×512 PNG, 21.2 KB. | Required large `any` installability icon. |
| `public/icons/icon-maskable-512.png` | **New.** 512×512 PNG, 17.2 KB. Content scaled to ~60% of the canvas, inside the central 80% maskable safe zone; full-bleed paper background. | Required `maskable` icon. |
| `public/icons/apple-touch-icon.png` | **New.** 180×180 PNG, 6.5 KB, fully opaque. | iOS home-screen icon linked from metadata. |
| `app/layout.tsx` | Added `viewport` and `Metadata`/`Viewport` imports; added `applicationName`, `appleWebApp`, `icons.apple`, `formatDetection`; added the `viewport` export (`themeColor`, `width`, `initialScale`, `viewportFit`); body uses `min-h-dvh`. | Implements sections 3 and 4; keeps the root layout a server component and keeps the single `drawably/style.css` import. |
| `app/globals.css` | Added `html` background, `overscroll-behavior: none`, `-webkit-tap-highlight-color: transparent`; added `min-height: 100dvh` and one set of `env(safe-area-inset-*)` paddings on `body`; body `overscroll-behavior: none`. | App-like edge-to-edge shell, notch/home-indicator clearance, no pull-to-refresh or bounce. Inputs/textarea selection is untouched. |
| `architecture.md` | Documented the manifest route and fields, icon paths and their temporary status, metadata/viewport decisions, safe-area handling, platform caveat, structure, and status. | Required by the brief and `AGENTS.md`. |
| `results/02-pwa.md` | **New.** This summary. | Required by `AGENTS.md`. |
| `AGENTS.md` | Modified by `next dev`, which appended its managed `nextjs-agent-feedback` block. | Tool-generated; the file's own note says to leave/commit it. No manual content was changed. |

No changes were made to `app/page.tsx`, the homepage components, `package.json`, or `bun.lock`. The pre-existing `.gitignore` modification was already present before this task and was not touched.

## Implementation notes

### Manifest

- `background_color` and `theme_color` are both `#efe5cf`, matching the existing `--background` and computed `body` background (`rgb(239, 229, 207)`). No new palette values were introduced.
- Icon entries use `/icons/icon-192.png` (`192x192`, `any`), `/icons/icon-512.png` (`512x512`, `any`), and `/icons/icon-maskable-512.png` (`512x512`, `maskable`).
- The placeholder `TODO` lives directly above the `manifest()` export in `app/manifest.ts`.

### Placeholder icons

- Generated once with Sharp (`node_modules/sharp`) from an SVG in a throwaway script kept outside the repository (`%TEMP%`), then written to `public/icons/`. No runtime dependency or committed generation script was added, per the brief.
- Artwork: `#efe5cf` cream canvas, a rough ink (`#2b2822`) hand-drawn double circle, and four Parchís-colored dots (red `#b63a2f`, blue `#2f5c9a`, yellow `#d9a62f`, green `#3f7a4f`). Deliberately simple so it reads as temporary.
- Every PNG is flattened onto the paper background (no transparency), including the Apple touch icon. All files are far below the ~100 KB limit.
- The maskable variant scales the whole motif to 78% and keeps its outer stroke under 30% of the canvas radius, comfortably inside the 80% safe zone.

### Metadata and viewport

- `appleWebApp` uses `capable: true`, `title: "Parchís Stars"`, and `statusBarStyle: "black-translucent"`.
- `themeColor` was moved to the `viewport` export with `#efe5cf`; `metadata.themeColor` is not used. Pinch zoom is preserved: neither `maximumScale` nor `userScalable` is set.
- Next 16 emits `<link rel="manifest">`, `<meta name="theme-color">`, `<meta name="application-name">`, `<meta name="format-detection" content="telephone=no">`, `<link rel="apple-touch-icon">`, `<meta name="apple-mobile-web-app-title">`, and `<meta name="apple-mobile-web-app-status-bar-style">` from this configuration.
- For `appleWebApp.capable`, this Next version emits the modern `<meta name="mobile-web-app-capable" content="yes">`; it does **not** emit the legacy `apple-mobile-web-app-capable` tag.

### Safe areas and shell behavior

- Safe-area padding is applied exactly once, on `body`, using `env(safe-area-inset-top/right/bottom/left)`. No page or card adds it again.
- `html` and `body` both use the paper background, so the color reaches every screen edge, including overscroll areas.
- `body` has `min-height: 100dvh` and the layout body class is `min-h-dvh`; the homepage's existing `min-h-dvh` / `lg:h-dvh` layout is unchanged.
- `overscroll-behavior: none` on `html` and `body`; `-webkit-tap-highlight-color: transparent` on `html`. There is no global `user-select: none`, so inputs remain selectable.
- No JavaScript or CSS fullscreen API is used.

## Commands and verification

The machine initially had no `node_modules`, no Bun, and only Node.js 18.18.2 (Next.js 16 requires `>=20.9.0`). Bun 1.4.4 and Node.js 22.23.4 were downloaded into local tool folders outside the repository for verification only; no Node/Bun config in the repo was changed.

| Command/check | Result |
| --- | --- |
| `bun install` (Bun 1.4.4) | Installed the declared dependencies; `bun.lock` was unchanged. |
| `bun run lint` / `eslint .` | Exit 0. |
| `tsc --noEmit` (after the build generated `next-env.d.ts` and route types) | Exit 0. |
| `next build` (Node 22.23.4) | Exit 0. Routes: `/`, `/_not-found`, and `/manifest.webmanifest`, all static. |
| Production `next start`, `GET /manifest.webmanifest` | `200`, `Content-Type: application/manifest+json`. JSON parsed successfully with `display=fullscreen`, fallback chain `fullscreen,standalone,minimal-ui,browser`, `lang=es`, `dir=ltr`, `categories=games`, `theme_color=#efe5cf`, `background_color=#efe5cf`. |
| Production, manifest icon URLs | `icon-192.png` 200 (7,173 bytes), `icon-512.png` 200 (21,669 bytes), `icon-maskable-512.png` 200 (17,579 bytes), `apple-touch-icon.png` 200 (6,620 bytes); all `image/png`. |
| Production, `GET /` head | Present: manifest link, `theme-color=#efe5cf`, `viewport="width=device-width, initial-scale=1, viewport-fit=cover"`, `application-name`, Spanish description, `format-detection=telephone=no`, Apple title/status bar/icon, `mobile-web-app-capable=yes`. |
| Dev `next dev`, manifest and all four icons | Manifest 200 (`application/manifest+json`); each icon 200 with the expected byte size. |
| Chrome (headless, CDP) on the dev page | `Page.getAppManifest` → no errors; `Page.getInstallabilityErrors` → `[]` (no manifest/installability errors). |
| Chrome console/exception capture | No errors, warnings, exceptions, or hydration warnings. Only two expected dev messages: React DevTools info and `[HMR] connected`. |
| Chrome computed styles | `html`/`body` background `rgb(239, 229, 207)`; `overscroll-behavior: none` on both; `-webkit-tap-highlight-color: rgba(0, 0, 0, 0)`; `body` `min-height` equals the viewport height. On the headless environment safe-area insets resolve to `0px`, as expected. |
| Chrome desktop 1280×800 | `lang="es"`, heading "Parchís Stars", 3 buttons, name input prefilled and editable, party-code input present, no horizontal overflow. Task 01 behavior preserved. |
| Chrome emulated mobile 390×844 | No horizontal overflow; the page scrolls vertically as before (document 1,095 px vs. 844 px viewport). |

## Deviations, caveats, and follow-ups

- **Icons are placeholders by design.** A later icon task must replace all four PNGs; do not treat the cream/ink/dots artwork as final.
- **iOS display mode:** iOS does not support `display: "fullscreen"`. "Add to Home Screen" opens the app in WebKit's standalone-style view regardless of the manifest's fullscreen request; `display_override` is honored by Chromium. iOS uses `appleWebApp.title` and `apple-touch-icon` for the home-screen label and icon.
- **Capable meta tag:** Next 16 emits `mobile-web-app-capable=yes` (standard) rather than the legacy `apple-mobile-web-app-capable` tag. If an older iOS target needs the legacy tag, it would require a manual `<meta>` in the layout; the brief's `appleWebApp` API was used as specified.
- **Manual install not performed:** installability was verified through Chrome's DevTools Protocol (`Page.getInstallabilityErrors` empty) rather than by clicking "Install" in a browser UI, and no physical iOS device was used. A manual install check on HTTPS/localhost remains a reviewer step.
- **Safe-area insets** cannot be simulated in the headless browser used here; their computed value was `0px`. The CSS uses the standard `env(safe-area-inset-*)` values and `viewport-fit=cover`, so notch/home-indicator clearance is handled in installed mode.
- **Environment-only setup:** Bun 1.4.4 and Node 22.23.4 live outside the repository. The project still declares `bun@1.4.2` and does not pin a Node version.
- **`AGENTS.md`** was changed by `next dev` (managed agent-feedback block). It was left in place, not manually edited.
- No service worker, offline caching, background sync, push notifications, custom install prompt, or in-app fullscreen toggle was added; those remain out of scope / for Task 05.
- Task 01 homepage markup, copy, controls, and behavior are unchanged.
