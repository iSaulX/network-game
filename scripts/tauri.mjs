#!/usr/bin/env node
/**
 * Runs the Tauri CLI from the `tauri/` project directory.
 *
 * The CLI is a dev dependency of the root package (one lockfile for the whole
 * repository), but Tauri expects to be invoked next to `src-tauri`. This
 * wrapper keeps `bun run desktop:*` working from any directory and on every
 * platform without relying on a shell `cd`.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(
  root,
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);

const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
  cwd: path.join(root, "tauri"),
  stdio: "inherit",
});

if (result.error) {
  console.error(`[desktop] Could not run the Tauri CLI: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
