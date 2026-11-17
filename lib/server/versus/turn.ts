/**
 * Server-only TURN credential minting for Cloudflare Realtime.
 *
 * The browser never sees the Cloudflare API token. The route handler asks this
 * module for short-lived ICE servers; the module calls Cloudflare's
 * `generate-ice-servers` endpoint and validates the response before handing it
 * out. If anything is missing or fails, the caller still receives a usable
 * STUN-only list, so online play keeps working (without relay) instead of
 * breaking.
 *
 * Credentials are deliberately short-lived: TURN is only used while ICE is
 * negotiating, never for the lifetime of a match.
 */

/** Cloudflare's TURN credential endpoint, keyed by the TURN Token ID. */
export const CLOUDFLARE_TURN_ENDPOINT =
  "https://rtc.live.cloudflare.com/v1/turn/keys";

/** STUN-only fallback used when TURN is not configured or unreachable. */
export const STUN_ONLY_ICE_SERVERS: readonly RTCIceServer[] = Object.freeze([
  { urls: "stun:stun.cloudflare.com:3478" },
]);

/** Default lifetime of a minted credential, in seconds. */
export const DEFAULT_TURN_TTL_SECONDS = 3600;

/** Hard cap on the credential lifetime Cloudflare accepts. */
const MAX_TURN_TTL_SECONDS = 86_400;

/**
 * How long the API request may take before we give up and use STUN. Kept
 * below the browser's `ICE_FETCH_TIMEOUT_MS` so a slow mint still succeeds.
 */
const TURN_FETCH_TIMEOUT_MS = 3000;

/** At most this many ICE URLs are accepted from one credential. */
const MAX_ICE_URLS = 8;

export interface TurnEnvironment {
  readonly tokenId?: string;
  readonly apiToken?: string;
}

export interface TurnOptions {
  /** Injected in tests; defaults to `process.env`. */
  readonly env?: TurnEnvironment;
  /** Credential lifetime in seconds; clamped to Cloudflare's accepted range. */
  readonly ttlSeconds?: number;
  /** Injected in tests. */
  readonly fetcher?: typeof fetch;
}

export type IceServersSource = "turn" | "stun";

export interface IceServersResult {
  readonly iceServers: readonly RTCIceServer[];
  /** `turn` when the credentials came from Cloudflare, `stun` on fallback. */
  readonly source: IceServersSource;
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
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 256) {
      return null;
    }

    // Only transport URLs are relayed to the browser; nothing executable.
    if (!/^(?:stun|stuns|turn|turns):[^\s]+$/.test(entry)) {
      return null;
    }

    urls.push(entry);
  }

  return urls;
}

/**
 * Validates the Cloudflare response. The payload is untrusted input even
 * though it comes from a trusted service, so every field is checked.
 */
export function parseIceServersPayload(
  value: unknown,
): RTCIceServer[] | null {
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
    const hasCredentials =
      entry.username !== undefined || entry.credential !== undefined;

    // Cloudflare sends a STUN-only entry (no username) next to the TURN one.
    // A TURN URL without credentials, on the other hand, is unusable.
    if (!hasCredentials) {
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

    servers.push({
      urls,
      username: entry.username,
      credential: entry.credential,
    });
  }

  return servers.length > 0 ? servers : null;
}

function clampTtl(ttlSeconds: number | undefined): number {
  if (
    typeof ttlSeconds !== "number" ||
    !Number.isFinite(ttlSeconds) ||
    ttlSeconds <= 0
  ) {
    return DEFAULT_TURN_TTL_SECONDS;
  }

  return Math.min(Math.floor(ttlSeconds), MAX_TURN_TTL_SECONDS);
}

function stunFallback(): IceServersResult {
  return { iceServers: STUN_ONLY_ICE_SERVERS, source: "stun" };
}

/**
 * Mints short-lived TURN credentials. Never throws: any failure returns the
 * STUN-only fallback so pairing can still proceed.
 */
export async function generateIceServers(
  options: TurnOptions = {},
): Promise<IceServersResult> {
  const env = options.env ?? {
    tokenId: process.env.CLOUDFLARE_TURN_TOKEN_ID,
    apiToken: process.env.CLOUDFLARE_TURN_API_TOKEN,
  };

  if (!env.tokenId || !env.apiToken) {
    return stunFallback();
  }

  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURN_FETCH_TIMEOUT_MS);

  try {
    const response = await fetcher(
      `${CLOUDFLARE_TURN_ENDPOINT}/${encodeURIComponent(env.tokenId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: clampTtl(options.ttlSeconds) }),
        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return stunFallback();
    }

    const parsed = parseIceServersPayload(await response.json());

    return parsed ? { iceServers: parsed, source: "turn" } : stunFallback();
  } catch {
    // Network error, abort or malformed JSON: keep the game playable.
    return stunFallback();
  } finally {
    clearTimeout(timer);
  }
}
