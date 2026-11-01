#!/usr/bin/env node
/**
 * Generates `public/sw.js` after `next build`.
 *
 * The worker needs one list of every URL it should precache. Next.js hashes
 * its chunks on every build, so the list is generated from the build output
 * and the public directory instead of being maintained by hand. The build ID
 * is embedded as the cache revision so a deploy replaces the previous cache.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const root = process.cwd();
const nextDirectory = path.join(root, ".next");
const publicDirectory = path.join(root, "public");
const buildIdPath = path.join(nextDirectory, "BUILD_ID");
const templatePath = path.join(
  root,
  "scripts",
  "service-worker-template.js",
);
const outputPath = path.join(publicDirectory, "sw.js");

function fail(message) {
  console.error(`[pwa] ${message}`);
  process.exit(1);
}

if (!existsSync(buildIdPath)) {
  fail("No .next/BUILD_ID found. Run `next build` before generating sw.js.");
}

if (!existsSync(templatePath)) {
  fail(`Service worker template not found at ${templatePath}.`);
}

const buildId = readFileSync(buildIdPath, "utf8").trim();

if (!buildId) {
  fail(".next/BUILD_ID is empty.");
}

const requiredRoutes = [
  ["index.html", "/"],
  ["alone.html", "/alone"],
  ["play.html", "/play"],
  ["offline.html", "/offline"],
];

for (const [file] of requiredRoutes) {
  if (!existsSync(path.join(nextDirectory, "server", "app", file))) {
    fail(`Missing prerendered route .next/server/app/${file}.`);
  }
}

const urls = new Set();
const sizes = new Map();

function add(url, filePath) {
  if (urls.has(url)) {
    return;
  }

  urls.add(url);

  if (filePath) {
    sizes.set(url, statSync(filePath).size);
  }
}

function walk(directory, urlPrefix, skip) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    const relativePath = path
      .relative(directory, absolutePath)
      .split(path.sep)
      .join("/");

    if (skip?.(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      walk(absolutePath, `${urlPrefix}${entry.name}/`, skip);
      continue;
    }

    add(`${urlPrefix}${relativePath}`, absolutePath);
  }
}

for (const [file, url] of requiredRoutes) {
  add(
    url,
    path.join(nextDirectory, "server", "app", file),
  );
}

add(
  "/manifest.webmanifest",
  path.join(nextDirectory, "server", "app", "manifest.webmanifest.body"),
);
add(
  "/favicon.ico",
  path.join(nextDirectory, "server", "app", "favicon.ico.body"),
);

walk(
  path.join(nextDirectory, "static"),
  "/_next/static/",
);

walk(publicDirectory, "/", (relativePath) => {
  return (
    relativePath === "sw.js" ||
    relativePath === "sw.js.map" ||
    relativePath.startsWith("swe-worker")
  );
});

const precacheUrls = [...urls].sort((left, right) => left.localeCompare(right));
const totalBytes = [...sizes.values()].reduce(
  (total, size) => total + size,
  0,
);
const totalMegabytes = totalBytes / (1024 * 1024);

const template = readFileSync(templatePath, "utf8");

for (const placeholder of ["__BUILD_REVISION__", "__PRECACHE_MANIFEST__"]) {
  if (!template.includes(placeholder)) {
    fail(`The service worker template is missing ${placeholder}.`);
  }
}

const output = template
  .replace("__BUILD_REVISION__", () => JSON.stringify(buildId))
  .replace("__PRECACHE_MANIFEST__", () =>
    JSON.stringify(precacheUrls, null, 2),
  );

if (output.includes("__BUILD_REVISION__") || output.includes("__PRECACHE_MANIFEST__")) {
  fail("The generated service worker still contains an unreplaced placeholder.");
}

writeFileSync(outputPath, output, "utf8");

console.log(
  `[pwa] Generated public/sw.js with ${precacheUrls.length} precache entries (${totalMegabytes.toFixed(1)} MiB of build/public files; revision ${buildId}).`,
);
