/**
 * Browser-side ICE server discovery.
 *
 * The app does not hard-code TURN credentials: it asks its own `/api/ice`
 * route, which mints short-lived Cloudflare TURN credentials server-side. If
 * that endpoint is missing (static desktop export) or slow, the client falls
 * back to the STUN-only list so pairing still works.
 */
import { OFFLINE_ICE_SERVERS, ONLINE_ICE_SERVERS } from "./signaling";

export const ICE_ENDPOINT = "/api/ice";

/**
 * How long the credential request may take before falling back to STUN.
 * It must exceed the server's Cloudflare timeout (`TURN_FETCH_TIMEOUT_MS`),
 * or a slow-but-successful mint would be discarded as a failure.
 */
export const ICE_FETCH_TIMEOUT_MS = 4000;

/** Successful TURN credentials are reused for this long (they live 1 h). */
const TURN_CACHE_MS = 50 * 60_000;

/** At most this many ICE URLs are accepted from the server. */
const MAX_ICE_URLS = 8;

export interface FetchIceServersOptions {
  /** Injected in tests. */
  readonly fetcher?: typeof fetch;
  /** `false` skips the request entirely (offline). */
  readonly online?: boolean;
  readonly timeoutMs?: number;
  /** Injected in tests to exercise cache expiry. */
  readonly now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readUrls(value: unknown): string[] | null {
  const raw = typeof value === "string" ? [value] : value;

  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ICE_URLS) {
    return null;
  }

  const urls: string[] = [];

  for (const entry of raw) {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.length > 256 ||
      !/^(?:stun|stuns|turn|turns):[^\s]+$/.test(entry)
    ) {
      return null;
    }

    urls.push(entry);
  }

  return urls;
}

/** Validates the `/api/ice` payload before it reaches `RTCPeerConnection`. */
export function parseIceServers(value: unknown): RTCIceServer[] | null {
  if (!isRecord(value) || !Array.isArray(value.iceServers)) {
    return null;
  }

  const servers: RTCIceServer[] = [];

  for (const entry of value.iceServers) {
    if (!isRecord(entry)) {
      return null;
    }

    const urls = readUrls(entry.urls);

    if (!urls) {
      return null;
    }

    const hasTurn = urls.some((url) => /^turns?:/.test(url));

    if (entry.username === undefined && entry.credential === undefined) {
      // A STUN-only entry is valid; a TURN URL without credentials is not.
      if (hasTurn) {
        return null;
      }

      servers.push({ urls });
      continue;
    }

    if (
      typeof entry.username !== "string" ||
      entry.username.length === 0 ||
      entry.username.length > 512 ||
      typeof entry.credential !== "string" ||
      entry.credential.length === 0 ||
      entry.credential.length > 512
    ) {
      return null;
    }

    servers.push({ urls, username: entry.username, credential: entry.credential });
  }

  return servers.length > 0 ? servers : null;
}

function stunOnly(): RTCIceServer[] {
  return [...ONLINE_ICE_SERVERS];
}

function offline(): RTCIceServer[] {
  return [...OFFLINE_ICE_SERVERS];
}

interface IceCache {
  readonly promise: Promise<RTCIceServer[]>;
  readonly expiresAt: number;
}

/** One in-flight request per page; only real TURN lists are cached. */
let cache: IceCache | null = null;

function hasTurnUrl(servers: readonly RTCIceServer[]): boolean {
  return servers.some((server) => {
    const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
    return urls.some((url) => /^turns?:/.test(url));
  });
}

/** Returns `null` on any failure so the caller can retry later. */
async function requestIceServers(
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<RTCIceServer[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(ICE_ENDPOINT, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return parseIceServers(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns the ICE servers to use for this connection. Never throws: any
 * failure degrades to STUN (or to an empty list when offline). A STUN-only
 * result is never cached, so a transient `/api/ice` failure does not disable
 * TURN for the rest of the session.
 */
export function fetchIceServers(
  options: FetchIceServersOptions = {},
): Promise<RTCIceServer[]> {
  if (options.online === false) {
    return Promise.resolve(offline());
  }

  const now = options.now ?? Date.now;

  // An injected fetcher bypasses the shared cache (tests stay isolated).
  if (options.fetcher) {
    return requestIceServers(
      options.fetcher,
      options.timeoutMs ?? ICE_FETCH_TIMEOUT_MS,
    ).then((servers) => servers ?? stunOnly());
  }

  if (cache && cache.expiresAt > now()) {
    return cache.promise;
  }

  const promise = requestIceServers(
    fetch,
    options.timeoutMs ?? ICE_FETCH_TIMEOUT_MS,
  ).then((servers) => servers ?? stunOnly());

  const entry: IceCache = { promise, expiresAt: now() + TURN_CACHE_MS };
  cache = entry;

  void promise.then((servers) => {
    // A fallback must retry on the next call; only TURN-capable lists cache.
    if (cache === entry && !hasTurnUrl(servers)) {
      cache = null;
    }
  });

  return promise;
}

/** Test helper: forget the cached request. */
export function resetIceServersCache(): void {
  cache = null;
}
