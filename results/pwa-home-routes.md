# PWA routes back to the home page — completion summary

## Problem

The PWA used to be installable with `"start_url": "/alone"`. When the setup
flow was unified into `/`, `/alone` and `/lan` were deleted and both the
manifest `start_url` and the service-worker route list were updated to `/`.
Installed PWAs and old bookmarks can still request the removed paths, however,
so launching them produced a 404 (online) or the offline page (offline) instead
of the home page.

The manifest already had `"id"`, `"scope"` and `"start_url"` set to `/`; the
missing piece was recovering navigations to the paths that no longer exist.

## Changes

| File | Change |
| --- | --- |
| `next.config.ts` | Added `redirects()` for `/alone/:path*` and `/lan/:path*` → `/` with `permanent: false` (307), web build only. Redirects are unsupported in the Tauri static export, so they live in the existing `if (!isDesktopBuild)` block. Also removed the stale `/alone/` mention from the `trailingSlash` comment. |
| `scripts/service-worker-template.js` | Added `HOME_URL`, `LEGACY_ROUTE_PATHS` (`/alone`, `/lan`) and `isLegacyRoute()`. `handleNavigation()` now returns `Response.redirect(..., 302)` to `/` for a removed route or any path below it, before the network/cache logic, so old launches recover both online and offline. `ROUTE_PATHS` now uses `HOME_URL`. |
| `architecture.md` | Documented the worker redirect, the mirrored `next.config.ts` redirect, its web-only scope, and the last-updated entry. |

No manifest change was needed: `id`, `scope` and `start_url` are already `/`.
`public/sw.js` is generated and git-ignored; it is refreshed by `bun run build`.

## Behaviour

- Old installed PWA shortcut / bookmark to `/alone` or `/lan` (including
  sub-paths) → 302 to `/` from the worker. The browser then loads the home
  page from the network or from the precache.
- Clients running an older worker → `next.config.ts` answers the same paths
  with a 307 to `/` while online.
- `/`, `/play`, `/offline`, assets and APIs are unaffected.
- The offline fallback for genuinely unknown paths is unchanged.

## Verification

| Command / check | Result |
| --- | --- |
| `bun run lint` | 0 errors; 4 pre-existing unused-import warnings in `lib/server/versus/rooms.ts`. |
| Dev server (`next dev` on port 3000, config hot-reloaded) | `/alone` → 307 `/`; `/alone/foo` → 307 `/`; `/lan` → 307 `/`; `/lan/xyz` → 307 `/`; `/alone/` → 308 `/alone` (Next trailing-slash normalisation) then 307 `/`; `/play`, `/offline`, `/manifest.webmanifest` → 200. |
| Node VM harness over `scripts/service-worker-template.js` | `/alone`, `/alone/`, `/alone/old/sub`, `/lan`, `/lan/room/1` → 302 to `http://localhost/`; `/`, `/play`, `/offline` served from the mocked precache; unknown `/otra` still fell back to `/offline`. All assertions passed. |
| `bun run build` | **Not verified in this session.** The build fails during TypeScript checking on unrelated in-progress WebSocket work (`lib/party/versus/use-party-session.ts`, `lib/server/versus/party-state.ts`, `lib/party/sessions/server-game-session.ts`, `lib/party/websocket/party-socket-transport.ts`). Since the build stops before writing `.next/BUILD_ID`, `public/sw.js` could not be regenerated here. |

## Follow-ups

- Run `bun run build` once the concurrent WebSocket changes compile; it
  regenerates `public/sw.js` with the new navigation logic.
- Verify an actual installed-PWA launch at the old `/alone` start URL after
  that production build, both online and offline.
- Chrome refreshes an installed PWA's `start_url` from the manifest
  asynchronously; the redirects cover the transition and any shortcut created
  before the manifest change.
