# Task 05 — Offline app shell (PWA service worker)

**Read `AGENTS.md` before making any changes, and read and update `architecture.md` after making changes so the architecture is always current.**

## Outcome

After one online visit, the app must load and render its shell with no network: `/` and `/offline` work on a cold reload, styles/fonts/icons are available, and the installed PWA launches offline. Caches are versioned and updated on deploy. API responses and WebSocket traffic are **never** cached. This task delivers the offline shell only; offline gameplay is Task 06.

## Dependencies

- Task 02 (manifest, full-screen display, icons) must be complete.
- Task 04 (custom server, `bun dev` / `bun start`) is the expected runtime. If Task 04 is not done, test with `next build && next start` and flag it.
- Do not break online parties or the custom server. `/api/ws` upgrades and `/api/*` traffic must keep working.

## Why a service worker

Next.js' experimental `useOffline` only covers soft navigations and retries; a full page reload while offline still needs a service worker to serve the HTML and assets. Next's own PWA guide recommends Serwist for full service-worker caching.

Use a **current Turbopack-compatible Serwist setup**:

- Preferred: `@serwist/next` configurator mode (external `serwist build` step, `app/sw.ts`, `swDest: public/sw.js`).
- Acceptable: `@serwist/turbopack` route-handler mode (`app/serwist/[path]/route.ts`, SW served at `/serwist/sw.js`, `SerwistProvider` registration).
- Do **not** use the legacy webpack `withSerwistInit` / `register: true` flow.
- Read the current Serwist docs linked by Next (`serwist.pages.dev/docs/next/turbo`) and pin compatible versions. If Serwist cannot build with Next 16.4.2 + Turbopack, fall back to a hand-written service worker plus a generated precache manifest, and document the deviation.

## Service worker requirements

Service worker source: `app/sw.ts` (or the location required by the chosen Serwist mode). Generated output must never be committed; add `public/sw*` and `public/swe-worker*` to `.gitignore`.

- **Precache:** the generated build asset manifest plus explicit entries for `/`, `/offline`, `/manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, and `apple-touch-icon.png`. Use a build revision (build ID or git SHA) so updates invalidate.
- **Navigations:** network-first with a short timeout (~3 s), then the cached document, then `/offline`. `navigationPreload` enabled where supported.
- **Static assets:** cache-first for immutable hashed `/_next/static/*`, fonts, and icons; stale-while-revalidate where appropriate. Cache names include the build revision; activation deletes old caches.
- **API:** `NetworkOnly` for `/api/*`. Never cache requests or responses that carry party/player data. No background sync or offline queue for party actions.
- **WebSocket:** not intercepted, cached, or replayed. Offline means local mode only; online parties require connectivity.
- **Cross-origin:** do not cache third-party responses. The app uses `next/font` (self-hosted) and drawably (bundled), so same-origin caching is enough.
- **Activation:** `skipWaiting: true`, `clientsClaim: true`; document that updates take control on the next load. No update-prompt UI in this task.
- **Range/OPAQUE:** do not cache opaque or partial responses beyond what Serwist's default rules already handle safely.

### Offline fallback page

Create `app/offline/page.tsx` as a static, precached route:

- Drawably card and controls, Spanish copy.
- Heading: "Sin conexión"; body: "No hay conexión a internet."; a "Reintentar" button that reloads.
- Leave a clearly marked place for Task 06 to add a "Jugar contra bots" link.
- It must render with the same paper/ink theme and be readable without network.

### Registration

- Add a small client component (e.g. `app/service-worker-register.tsx`) mounted once in `app/layout.tsx`.
- Register **only in production** (`process.env.NODE_ENV === "production"`), only in a secure context, and only if `"serviceWorker" in navigator`.
- Use scope `/` and `updateViaCache: "none"`. Catch and log registration errors; never block rendering.
- Do not auto-reload the page on `controllerchange`; a reload during a game would be disruptive.
- The service worker file must be served with:
  - `Content-Type: application/javascript; charset=utf-8`
  - `Cache-Control: no-cache, no-store, must-revalidate`
  - `Service-Worker-Allowed: /`
  
  Add these via `next.config.ts` headers (or the custom server). Also send `Cache-Control: no-store` for `manifest.webmanifest`.

### Offline indicator

Add a tiny client component mounted in the root layout:

- Uses `navigator.onLine` plus `online`/`offline` events; treat it as a hint, not a guarantee.
- Shows a Drawably badge with Spanish text "Sin conexión" only while offline.
- Non-blocking, does not shift the layout, respects `prefers-reduced-motion`.
- Do not disable or hide online actions here; Task 04/06 wiring handles that.

## Build and scripts

- Keep `dev` running the custom server. The service worker is **not registered in development**, so do not run a Serwist watch build in dev.
- Build must produce the service worker, e.g. `"build": "next build && serwist build"`.
- `start` stays as Task 04 defined (`NODE_ENV=production tsx server.ts`).
- Verify `bun run build` succeeds with the custom server/Turbopack setup and that `public/sw.js` (or `/serwist/sw.js`) is generated.
- Do not change `next.config.ts` in a way that breaks `serverExternalPackages`, the custom server, or the PWA manifest.

## Testing checklist

Run against a production build: `bun run build && bun start`.

1. Load `/` online. In DevTools → Application → Service Workers, confirm the SW is activated and controls the page.
2. DevTools → Network → Offline, hard-reload `/`: the page renders with drawably styles, app font, and icons. No white screen or unstyled HTML.
3. Direct offline load of `/offline` works; an uncached document navigation falls back to `/offline`.
4. Offline reload of `/` after closing/reopening the tab works (installed PWA: launch in airplane mode).
5. Application → Cache Storage: only expected same-origin caches; no `/api/*` responses, no tokens, no party data.
6. While offline, `/api/parties` requests fail normally (not served from cache) and online party UI does not show stale data.
7. `bun dev`: no service worker is registered, HMR works, `/api/ws` still upgrades, and the app is unaffected.
8. Update test: rebuild, reload twice, confirm the new SW activates and old caches are deleted. No mixed old/new asset references.
9. Chose Serwist mode: verify the SW URL/scope and headers match the mode. If route-handler mode, `/serwist/sw.js` must not be cached by Next.
10. `bun run lint`, `bunx tsc --noEmit`, and `bun test` pass.

## Acceptance criteria

- After one online visit, a cold offline reload of `/` renders the full shell with styles, fonts, and icons.
- `/offline` is precached and used as the navigation fallback.
- The installed PWA launches offline.
- Service worker registration is production-only; dev and HMR are unaffected.
- `/api/*` is never cached; WebSockets are never intercepted or replayed.
- Caches are versioned; a new build activates cleanly and removes old caches.
- `/sw.js` (or `/serwist/sw.js`) is served with the correct headers and scope.
- No secrets, tokens, or party data are written to Cache Storage or localStorage by this task.
- Online parties and the custom server still work.
- `architecture.md` is updated.

## Out of scope

- Offline gameplay, bots, or local matches (Task 06).
- Background sync, offline mutation queues, push notifications, periodic sync.
- Update-prompt UI, forced reloads, or version banners.
- Caching `/api/*`, WebSocket state, or party data.
- Native app packaging, app stores, or multi-instance/multi-device sync.
- Final icon artwork.

## Definition of done

- Update `architecture.md` with: the Serwist integration mode, service worker file/output and headers, precache/fallback list, runtime cache policy, production-only registration, offline indicator, build/start scripts, and the offline boundary (no API/WS caching).
- Report the files added/changed, packages and versions, build/start commands, the manual offline test results (Chrome + iOS if available), and any deviation from Serwist or Next guidance.
