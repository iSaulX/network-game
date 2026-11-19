/**
 * Service worker template.
 *
 * `scripts/generate-service-worker.mjs` replaces the two placeholders below
 * after `next build` and writes the result to `public/sw.js`. Never edit
 * `public/sw.js` directly: it is generated and ignored by git.
 *
 * The worker deliberately caches only same-origin GET requests. API traffic
 * (`/api/*`) and WebSocket connections are never intercepted or cached.
 */

const BUILD_REVISION = __BUILD_REVISION__;

/** @type {string[]} */
const PRECACHE_URLS = __PRECACHE_MANIFEST__;

const CACHE_PREFIX = "parchis-stars-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_REVISION}`;
const OFFLINE_URL = "/offline";
const HOME_URL = "/";
const NAVIGATION_TIMEOUT_MS = 3000;
const PRECACHE_CONCURRENCY = 6;
const ROUTE_PATHS = new Set([HOME_URL, "/play", OFFLINE_URL]);
// Routes that existed before the unified setup flow. Installed PWAs (the old
// start URL was `/alone`) and old links can still open them, so navigations
// are sent to the home page instead of a 404 or the offline page.
const LEGACY_ROUTE_PATHS = new Set(["/alone", "/lan"]);
const STATIC_PREFIXES = [
  "/_next/static/",
  "/icons/",
  "/pictures/",
  "/chips/",
  "/dices/",
  "/sounds/",
  "/modes/",
  "/fonts/",
];
const STATIC_FILES = new Set([
  "/favicon.ico",
  "/icon.png",
  "/manifest.webmanifest",
]);

const PRECACHE_SET = new Set(
  PRECACHE_URLS.map((url) => {
    try {
      return new URL(url, self.location.origin).pathname;
    } catch {
      return url;
    }
  }),
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await precacheEverything(cache);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cachesToDelete = (await caches.keys()).filter(
        (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
      );

      await Promise.all(cachesToDelete.map((name) => caches.delete(name)));

      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch (error) {
          console.warn("[pwa] Could not enable navigation preload.", error);
        }
      }

      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // Never touch cross-origin traffic. The app is fully self-hosted.
  if (url.origin !== self.location.origin) {
    return;
  }

  // API responses may contain party or player data. They are network-only and
  // must never be written to Cache Storage.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  const isDocument =
    request.mode === "navigate" || request.destination === "document";

  if (isDocument) {
    event.respondWith(handleNavigation(event));
    return;
  }

  // Client-router payloads are network-only. Letting them fail makes Next.js
  // fall back to a regular document navigation, which the worker does handle.
  if (
    request.headers.get("RSC") === "1" ||
    request.headers.get("Next-Router-Prefetch") === "1"
  ) {
    return;
  }

  if (url.pathname === "/_next/image") {
    event.respondWith(handleOptimizedImage(request));
    return;
  }

  if (PRECACHE_SET.has(url.pathname) || isStaticAsset(url.pathname)) {
    event.respondWith(networkFallbackToCache(request));
  }
});

/**
 * Fetch the whole precache list. A failed entry is retried once; failures are
 * logged but do not prevent the worker from installing, so a single broken
 * optional asset cannot leave the app without a service worker.
 *
 * @param {Cache} cache
 */
async function precacheEverything(cache) {
  const queue = [...PRECACHE_URLS];
  /** @type {string[]} */
  const failed = [];

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift();

      if (!url) {
        continue;
      }

      try {
        await precacheOne(cache, url);
      } catch {
        failed.push(url);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(PRECACHE_CONCURRENCY, queue.length) },
    () => worker(),
  );

  await Promise.all(workers);

  for (const url of [...failed]) {
    try {
      await precacheOne(cache, url);
      failed.splice(failed.indexOf(url), 1);
    } catch {
      // Keep it in `failed`; logged below.
    }
  }

  if (failed.length > 0) {
    console.warn(
      `[pwa] ${failed.length} precache entries could not be cached:`,
      failed,
    );
  }
}

/**
 * @param {Cache} cache
 * @param {string} url
 */
async function precacheOne(cache, url) {
  const response = await fetch(url, {
    cache: "reload",
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error(`Precache request failed for ${url}: ${response.status}`);
  }

  if (response.status !== 200) {
    throw new Error(`Unexpected precache status for ${url}: ${response.status}`);
  }

  await cache.put(url, response);
}

/**
 * Documents are network-first with a short timeout, then the matching
 * precached route, then the offline page.
 *
 * @param {FetchEvent} event
 */
async function handleNavigation(event) {
  const { request } = event;
  const path = normalizePath(new URL(request.url).pathname);

  // Old installed PWAs and bookmarks must always land on the home page, even
  // offline. Redirecting here also skips the network for a route that no
  // longer exists.
  if (isLegacyRoute(path)) {
    return Response.redirect(
      new URL(HOME_URL, self.location.origin).toString(),
      302,
    );
  }

  const cache = await caches.open(CACHE_NAME);

  const cachedFallback = async () => {
    const candidates = ROUTE_PATHS.has(path) ? [path, OFFLINE_URL] : [OFFLINE_URL];

    for (const candidate of candidates) {
      const cached = await cache.match(candidate, {
        ignoreSearch: true,
        ignoreVary: true,
      });

      if (cached) {
        return cached;
      }
    }

    return Response.error();
  };

  // `navigator.onLine` is only a hint, but it avoids a pointless three-second
  // wait when the browser already knows the device is offline.
  if (self.navigator.onLine === false) {
    return cachedFallback();
  }

  try {
    const networkPromise =
      typeof event.preloadResponse !== "undefined"
        ? event.preloadResponse
        : fetch(request);
    const response = await withTimeout(
      networkPromise,
      NAVIGATION_TIMEOUT_MS,
    );

    // A 5xx response is not useful; prefer the last good shell. A 404 is a
    // legitimate answer and is returned as-is.
    if (response && response.status < 500) {
      return response;
    }
  } catch {
    // Timeout or network failure: fall through to the cache.
  }

  return cachedFallback();
}

/**
 * `next/image` normally goes through the optimizer. Online, its response is
 * cached for later; offline, the worker serves the original public image that
 * the optimizer would have read. This keeps every avatar, dice face, and mode
 * image available on a cold offline load.
 *
 * @param {Request} request
 */
async function handleOptimizedImage(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedOptimized = await cache.match(request, { ignoreVary: true });

  if (cachedOptimized) {
    return cachedOptimized;
  }

  const originalFallback = async () => {
    const originalUrl = new URL(request.url).searchParams.get("url");

    if (!originalUrl) {
      return Response.error();
    }

    const cachedOriginal = await cache.match(originalUrl, {
      ignoreSearch: true,
      ignoreVary: true,
    });

    return cachedOriginal || Response.error();
  };

  if (self.navigator.onLine === false) {
    return originalFallback();
  }

  try {
    const response = await fetch(request);

    if (response.status === 200 && response.type === "basic") {
      await cache.put(request, response.clone()).catch(() => {});
    }

    if (response.ok) {
      return response;
    }
  } catch {
    // Network failed; use the original image below.
  }

  return originalFallback();
}

/**
 * Cache-first for same-origin static assets. Range requests are answered from
 * the cached full body so offline audio playback works in browsers that issue
 * media range requests.
 *
 * @param {Request} request
 */
async function networkFallbackToCache(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, {
    ignoreSearch: true,
    ignoreVary: true,
  });

  if (cached) {
    return respondWithRange(cached, request);
  }

  const response = await fetch(request);

  if (response.status === 200 && response.type === "basic") {
    await cache.put(request, response.clone()).catch(() => {});
  }

  return response;
}

/**
 * @param {Response} cached
 * @param {Request} request
 */
async function respondWithRange(cached, request) {
  const rangeHeader = request.headers.get("range");

  if (!rangeHeader || cached.status !== 200) {
    return cached;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

  if (!match) {
    return cached;
  }

  const blob = await cached.blob();
  const size = blob.size;
  let requestedStart;
  let requestedEnd;

  if (match[1] === "") {
    if (match[2] === "") {
      return cached;
    }

    // Suffix range: `bytes=-500` means the last 500 bytes.
    requestedStart = Math.max(0, size - Number(match[2]));
    requestedEnd = size - 1;
  } else {
    requestedStart = Number(match[1]);
    requestedEnd = match[2] === "" ? size - 1 : Number(match[2]);
  }

  if (
    !Number.isFinite(requestedStart) ||
    !Number.isFinite(requestedEnd) ||
    requestedStart > requestedEnd ||
    requestedStart >= size
  ) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }

  const start = requestedStart;
  const end = Math.min(requestedEnd, size - 1);
  const headers = new Headers(cached.headers);

  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);

  return new Response(blob.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers,
  });
}

/**
 * @param {string} pathname
 */
function isStaticAsset(pathname) {
  return (
    STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    STATIC_FILES.has(pathname)
  );
}

/**
 * @param {string} pathname
 */
function normalizePath(pathname) {
  const trimmed = pathname.replace(/\/+$/, "");

  return trimmed === "" ? "/" : trimmed;
}

/**
 * Matches a removed route and any path below it.
 *
 * @param {string} pathname
 */
function isLegacyRoute(pathname) {
  for (const legacyPath of LEGACY_ROUTE_PATHS) {
    if (pathname === legacyPath || pathname.startsWith(`${legacyPath}/`)) {
      return true;
    }
  }

  return false;
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} milliseconds
 * @returns {Promise<T>}
 */
function withTimeout(promise, milliseconds) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Navigation timed out"));
    }, milliseconds);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
