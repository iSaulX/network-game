#!/usr/bin/env node
/**
 * Builds the static export that Tauri embeds in the desktop application.
 *
 * `TAURI_BUILD=1` makes `next.config.ts` switch to `output: "export"`, which
 * writes the complete app (HTML, JS, CSS, fonts, images, sounds) to `out/`.
 * Tauri then bundles every file from that directory into the binary, so the
 * desktop app needs no network access and no service worker.
 *
 * The normal `build` script is unchanged: it still produces a server-capable
 * Next.js build plus the PWA service worker.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const outDirectory = path.join(root, "out");

function fail(message) {
  console.error(`[desktop] ${message}`);
  process.exit(1);
}

if (!existsSync(nextBin)) {
  fail("Next.js is not installed. Run `bun install` first.");
}

const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    TAURI_BUILD: "1",
  },
});

if (result.error) {
  fail(`Could not run next build: ${result.error.message}`);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!existsSync(path.join(outDirectory, "index.html"))) {
  fail("The static export did not produce out/index.html.");
}

// The desktop app serves everything from its embedded bundle, so the PWA
// service worker copied from `public/` is dead weight. Remove it (and any
// runtime cache from a previous web build) before Tauri embeds `out/`.
for (const entry of readdirSync(outDirectory)) {
  if (entry === "sw.js" || entry === "sw.js.map" || entry.startsWith("swe-worker")) {
    rmSync(path.join(outDirectory, entry), { force: true, recursive: true });
  }
}

console.log("[desktop] Static export ready in out/.");
