# Parchís Stars — desktop shell

Tauri v2 wrapper for the Next.js app. The desktop binary embeds a complete
static export of the app, so every route, script, stylesheet, font, image and
sound ships inside the executable and works with no network connection.

## How it fits together

- `bun run build:desktop` (root) runs `next build` with `TAURI_BUILD=1`, which
  switches `next.config.ts` to `output: "export"` and writes the app to `out/`.
- `tauri/src-tauri/tauri.conf.json` points `build.frontendDist` at `../../out`
  and runs that export as its `beforeBuildCommand`, so a plain `tauri build`
  always embeds fresh frontend assets.
- `tauri::generate_context!()` (tauri-codegen) embeds every file in `out/` into
  the Rust binary at compile time. There is no HTTP server, no remote origin
  and no service worker: the webview loads the bundled assets from the Tauri
  custom protocol.
- `app/service-worker-register.tsx` detects the Tauri runtime and never
  registers the PWA worker inside the desktop app.
- `beforeDevCommand` starts `next dev` automatically, so `bun run desktop:dev`
  is the only command needed during development.

## Prerequisites

- Rust stable (`rustup default stable`)
- Bun 1.4.2 (or the version in the root `package.json`)
- Platform toolchain:
  - **macOS:** Xcode Command Line Tools
  - **Windows:** WebView2 (included with Windows 10/11) and the MSVC build tools
  - **Linux:** `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`,
    `librsvg2-dev`, `libssl-dev`, `libxdo-dev`, `patchelf`, `build-essential`

## Commands

Run from the repository root:

```bash
bun install

# Development: starts Next.js and the desktop shell together.
bun run desktop:dev

# Production: builds the static export and then the native bundle.
bun run desktop:build

# Only the static export (Tauri will embed this directory).
bun run build:desktop
```

`desktop:build` accepts Tauri CLI flags after `--`, for example:

```bash
bun run desktop:build -- --bundles app,dmg
bun run desktop:build -- --target universal-apple-darwin
```

## Bundles

`bun run desktop:build` uses the default `"targets": "all"`:

- macOS: `.app` and `.dmg`
- Windows: `.msi` and NSIS `.exe`
- Linux: `.deb`, `.rpm` and `.AppImage`

The GitHub Actions workflow (`.github/workflows/desktop.yml`) builds Linux
(`.deb`, `.rpm`, `.AppImage`), Windows (NSIS `.exe`) and a macOS universal
bundle (`.app`, `.dmg`) and uploads each to the workflow run's artifacts. NSIS
is used on CI instead of MSI because MSI generation depends on the optional
VBSCRIPT Windows feature; `bundle.targets: "all"` still builds both locally on
Windows.

DMG creation runs a Finder AppleScript to position the icons. On CI (where
`CI=true`) Tauri passes `--skip-jenkins` and produces a plain DMG without that
layout. If Finder automation is unavailable on a local Mac, run the same build
with `CI=true bun run desktop:build` to skip the AppleScript.

`actions/upload-artifact` does not preserve executable bits, so the workflow
also uploads `*.AppImage.tar.gz` and `*.app.zip` archives alongside the raw
bundles. Installers (`.dmg`, `.deb`, `.msi`, NSIS `.exe`) are unaffected.

## Offline behaviour

Everything under `out/` is embedded at compile time. `next/image` is configured
with `images.unoptimized`, so image tags point directly at the bundled
`/pictures`, `/chips`, `/dices`, `/modes`, `/game-results` and `/button-icons`
files. Audio files under `/sounds`, fonts under `/fonts` and all `_next/static`
chunks are embedded the same way. Removing or changing a public asset requires
rebuilding the desktop binary; there is no runtime download.

On Linux, WebKitGTK cannot play media from the `tauri://` scheme, so the game
fetches the two MP3s and plays blob URLs instead. Playback still depends on the
system GStreamer MP3 decoder being installed; the synthesized Web Audio cues do
not need it.
