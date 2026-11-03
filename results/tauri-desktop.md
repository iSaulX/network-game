# Tauri desktop shell and cross-platform CI

## Scope

Wrap the existing Next.js app in a Tauri v2 desktop shell that embeds every
route and asset (HTML, RSC payloads, `_next/static`, fonts, images, sounds and
the manifest) in the native binary, so the desktop build works with no network
connection and without a service worker. Add a GitHub Actions matrix that
builds and uploads installers for Linux, Windows and macOS.

## Files created

- `scripts/build-desktop.mjs` — runs `next build` with `TAURI_BUILD=1`, asserts
  that `out/index.html` exists, and removes the unused PWA worker
  (`sw.js`, `sw.js.map`, `swe-worker*`) from `out/`.
- `scripts/tauri.mjs` — cross-platform wrapper that runs the root-installed
  Tauri CLI with `cwd: tauri/`, so `bun run desktop:*` works from any directory
  without shell `cd`.
- `public/manifest.webmanifest` — static copy of the former `app/manifest.ts`
  metadata route. Static export requires `dynamic = "force-static"` on metadata
  routes, which conflicts with `cacheComponents`; a public file works in both
  the server build and the export.
- `lib/tauri.ts` — shared Tauri runtime detection (`__TAURI_INTERNALS__`,
  `window.isTauri`, protocol/hostname fallbacks) and `needsBlobAudio()` for the
  Linux WebKitGTK media workaround.
- `tauri/README.md` — desktop prerequisites, commands, bundle formats, offline
  behaviour and CI notes.
- `tauri/.gitignore` — ignores `src-tauri/target/` and `src-tauri/gen/`.
- `tauri/src-tauri/Cargo.toml` — Tauri v2 crate with the `_lib` name used by
  `main.rs`; `tauri-build` as a build dependency.
- `tauri/src-tauri/Cargo.lock` — committed for reproducible desktop builds.
- `tauri/src-tauri/build.rs` — `tauri_build::build()`.
- `tauri/src-tauri/src/main.rs` — binary entry point with the Windows
  `windows_subsystem` attribute for release builds.
- `tauri/src-tauri/src/lib.rs` — `tauri::Builder::default().run(...)`.
- `tauri/src-tauri/tauri.conf.json` — `frontendDist: "../../out"`,
  `beforeDevCommand` (`bun run dev`, cwd `../..`), `beforeBuildCommand`
  (`node scripts/build-desktop.mjs`, cwd `../..`), the main window and bundle
  metadata/icons.
- `tauri/src-tauri/capabilities/default.json` — `core:default` for the main
  window.
- `tauri/src-tauri/icons/*` — desktop icon set generated from the app icon
  (32/64/128/128@2x PNG, `icon.icns`, `icon.ico`, Windows Store logos). The
  generated `android/` and `ios/` folders were removed because this shell is
  desktop-only.
- `.github/workflows/desktop.yml` — matrix CI: `ubuntu-22.04` (`deb`, `rpm`,
  `appimage`), `windows-2025` (NSIS) and `macos-15` (universal `app`, `dmg`),
  with Rust/Bun caching, Windows long-path support, portable-bundle archives
  and `actions/upload-artifact@v7`.
- `results/tauri-desktop.md` — this summary.

## Files changed

- `next.config.ts` — `TAURI_BUILD=1` switches to `output: "export"`,
  `images: { unoptimized: true }` and `trailingSlash: true`. The web build
  keeps `cacheComponents`, `partialPrefetching` and the service-worker
  headers. `headers()` is gated off for the export, where it is unsupported.
- `package.json` — added `@tauri-apps/cli` and the `build:desktop`,
  `desktop:dev` and `desktop:build` scripts. `desktop:build` now runs
  `tauri build`; the export is produced by `beforeBuildCommand`.
- `bun.lock` — lockfile entries for `@tauri-apps/cli` and all platform
  packages.
- `app/layout.tsx` — links `/manifest.webmanifest` through `metadata.manifest`.
- `app/service-worker-register.tsx` — uses the shared `isTauriRuntime()` helper,
  unregisters any leftover worker and never registers the PWA worker in the
  desktop app.
- `components/game/game-feedback.ts` — on Tauri + Linux, fetches the two bundled
  MP3s and plays blob URLs instead of `tauri://` URLs. WebKitGTK/GStreamer has
  no URI handler for the custom protocol, so the supplied dice/move clips would
  otherwise be silent in Linux release builds. Other platforms keep the
  existing direct `new Audio('/sounds/...')` path.
- `scripts/generate-service-worker.mjs` — validates required routes against
  `.next/prerender-manifest.json` (tolerating adapters that relocate
  prerendered HTML) and no longer adds the manifest body explicitly.
- `eslint.config.mjs` — ignores `tauri/src-tauri/target/**` and
  `tauri/src-tauri/gen/**`, which contain Rust build artifacts and generated
  schemas rather than application source.
- `architecture.md` — desktop stack, project structure, PWA manifest rationale
  and a “Desktop (Tauri v2)” section covering hooks, commands and CI.
- `results/05-offline-shell.md` — follow-up note for the prerender-manifest fix.

## Files deleted

- `app/manifest.ts` — replaced by `public/manifest.webmanifest` (see above).

## Why each change satisfies the brief

- **Every file cached, works without connectivity:** the desktop build is a
  complete static export. `tauri::generate_context!()` (tauri-codegen) embeds
  every file under `out/` into the Rust binary at compile time. The webview
  loads them from the Tauri custom protocol; there is no HTTP server, remote
  origin, service worker or runtime download. `next/image` is unoptimized so
  image tags point at the bundled files, and `trailingSlash` emits
  `route/index.html` files that the Tauri asset resolver serves.
- **Offline audio on Linux:** bundled MP3s are embedded like every other asset,
  but WebKitGTK cannot play `tauri://` media URLs. The audio engine now fetches
  each clip locally and plays a blob URL on Tauri + Linux, so the supplied dice
  and movement sounds work in Linux release builds as well as on macOS/Windows.
- **Desktop project inside `tauri/`:** `tauri/src-tauri` is the Cargo crate and
  `tauri/README.md` documents the workflow. The CLI stays a root dev
  dependency so the repository keeps one `bun.lock`.
- **GitHub workflow for every desktop platform:** the matrix builds
  `ubuntu-22.04` (`deb`, `rpm`, `appimage`), `windows-2025` (NSIS `.exe`) and
  `macos-15` (universal `app`, `dmg`), then uploads each bundle with
  `actions/upload-artifact@v7`. Because upload-artifact does not preserve file
  modes, the workflow also produces `.AppImage.tar.gz` and `.app.zip` archives
  that keep their executable bit. NSIS is used instead of MSI because MSI
  generation depends on the optional VBSCRIPT Windows feature.
- **Local developer experience:** `beforeDevCommand` starts `next dev`, so
  `bun run desktop:dev` is the only command needed. `beforeBuildCommand`
  refreshes `out/` before `generate_context!` embeds it, so a plain
  `tauri build` is also correct.

## Commands and results

- `bun run build` (web) — passed; generated `public/sw.js` with 101 precache
  entries (60.7 MiB).
- `bun run desktop:build -- --no-bundle` — passed; `beforeBuildCommand` ran
  the static export (`/`, `/alone`, `/offline`, `/play`, `/_not-found` all
  static) and the release binary compiled.
- `CI=true bun run desktop:build -- --bundles dmg` — passed; produced
  `tauri/src-tauri/target/release/bundle/dmg/Parchis Stars_0.1.0_x64.dmg`
  (65.29 MiB).
- `hdiutil attach` on the DMG — mounted, contained `Parchis Stars.app` and the
  `/Applications` symlink; detached cleanly.
- Earlier in the task: `tauri build --no-bundle` and `--bundles app` passed;
  the `.app` (69.34 MiB) launched and the `parchis-stars` process was observed.
- `npx tsc --noEmit` — exit 0.
- `npx eslint .` — exit 0 after the ignore entries.
- `ruby -ryaml` / `ruby -rjson` — workflow YAML and both JSON configs parse.
- Final pass after the Linux audio fix: `npx tsc --noEmit`, `npx eslint .`,
  `bun run build` and `CI=true bun run desktop:build -- --bundles dmg` all
  passed. The export contains both `/sounds/*.mp3` files, every image/font
  directory and the blob-audio code, and contains no `sw.js`. The rebuilt DMG
  was mounted again and contains `Parchis Stars.app` and the `/Applications`
  symlink.
- `git status` — only the intended files are modified/untracked; `out/`,
  `.next/`, `public/sw.js` and `tauri/src-tauri/target/` are ignored.

## Deviations and follow-ups

- The GitHub Actions workflow has not been executed here (no remote run was
  triggered). Its YAML, matrix conditions, cross-platform lockfile entries and
  Tauri CLI arguments were validated statically.
- Desktop bundles are unsigned. macOS notarization and Windows code signing
  are follow-ups; unsigned macOS builds require the usual right-click → Open
  on first launch.
- Local DMG creation uses a Finder AppleScript. When Finder automation is
  unavailable, run with `CI=true` so Tauri passes `--skip-jenkins`; CI already
  sets `CI=true`.
- The macOS CI job builds a universal binary and uploads both the `.dmg` and a
  `ditto`-created `.app.zip`.
- The desktop runtime was launched but not driven through a full game; the
  static export, embedded assets, asset resolver and service-worker skip were
  verified from the build output and the Tauri source. The Linux blob-audio
  path could not be exercised on this macOS host; it is gated to Tauri + Linux
  and the macOS/web paths are unchanged.
- CSP remains disabled (`csp: null`). Enabling a policy is a security-hardening
  follow-up; it would need `media-src blob:` and `connect-src 'self'` for the
  Linux audio workaround.
- Linux MP3 playback still depends on the system GStreamer MP3 decoder. The
  blob workaround fixes the `tauri://` URI-handler failure, not codec
  availability; the synthesized Web Audio cues work without that decoder.
- The README previously said `tauri-build` embeds the frontend; the actual
  embedder is `tauri::generate_context!()`/tauri-codegen. The documentation was
  corrected.
