/**
 * Browser-side client for the online signaling server.
 *
 * The server only relays WebRTC descriptions and presence: this client
 * creates/joins a room, posts an offer per guest and an answer back, and polls
 * for the signals addressed to it. No game message ever goes through HTTP.
 */
import type { GameMode } from "../protocol";

export const VERSUS_ENDPOINT = "/api/versus";

/** How often a waiting peer asks the server for new signals. */
export const SIGNAL_POLL_MS = 700;

/** Room seats for a mode: 1v1 seats two, `all` seats four. */
export function capacityForMode(mode: GameMode): 2 | 4 {
  return mode === "1v1" ? 2 : 4;
}

export interface VersusCredentials {
  readonly code: string;
  /** Server-assigned peer id: `"host"` or `"guest-1"`…`"guest-3"`. */
  readonly id: string;
  readonly token: string;
  readonly role: "host" | "guest";
}

export type VersusSignalKind = "offer" | "answer" | "joined" | "left" | "bye";

export interface VersusSignal {
  readonly seq: number;
  readonly kind: VersusSignalKind;
  /** Seat that sent it. */
  readonly from: string;
  /** Seat it is meant for, or `null` for the sender's own seat notes. */
  readonly to: string | null;
  readonly payload: string;
}

export interface VersusPollResult {
  readonly seq: number;
  readonly signals: readonly VersusSignal[];
  readonly present: {
    readonly host: boolean;
    readonly guests: readonly string[];
  };
  readonly capacity: 2 | 4;
  readonly closed: boolean;
}

export type VersusClientFailure =
  | "offline"
  | "room-not-found"
  | "room-full"
  | "room-closed"
  | "unauthorized"
  | "bad-request"
  | "server-error"
  | "network";

export type VersusClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: VersusClientFailure };

const SIGNAL_KINDS: ReadonlySet<string> = new Set([
  "offer",
  "answer",
  "joined",
  "left",
  "bye",
]);

const PEER_ID_PATTERN = /^(?:host|guest-[1-3])$/;

function mapStatus(status: number): VersusClientFailure {
  switch (status) {
    case 400:
    case 413:
      return "bad-request";
    case 401:
      return "unauthorized";
    case 404:
      return "room-not-found";
    case 409:
      return "room-full";
    default:
      return "server-error";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPeerId(value: unknown): value is string {
  return typeof value === "string" && PEER_ID_PATTERN.test(value);
}

function parseCredentials(value: unknown): VersusCredentials | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.code !== "string" ||
    !/^[A-Z0-9]{4,8}$/.test(value.code) ||
    typeof value.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.token) ||
    !isPeerId(value.id) ||
    (value.role !== "host" && value.role !== "guest")
  ) {
    return null;
  }

  return {
    code: value.code,
    id: value.id,
    token: value.token,
    role: value.role,
  };
}

function parsePoll(value: unknown): VersusPollResult | null {
  if (!isRecord(value) || !Array.isArray(value.signals)) {
    return null;
  }

  const signals: VersusSignal[] = [];

  for (const entry of value.signals) {
    if (
      !isRecord(entry) ||
      typeof entry.seq !== "number" ||
      typeof entry.kind !== "string" ||
      !SIGNAL_KINDS.has(entry.kind) ||
      !isPeerId(entry.from) ||
      (entry.to !== null && !isPeerId(entry.to)) ||
      typeof entry.payload !== "string"
    ) {
      continue;
    }

    signals.push({
      seq: entry.seq,
      kind: entry.kind as VersusSignalKind,
      from: entry.from,
      to: entry.to as string | null,
      payload: entry.payload,
    });
  }

  const present = isRecord(value.present) ? value.present : {};
  const guests = Array.isArray(present.guests)
    ? present.guests.filter(isPeerId)
    : [];

  return {
    seq: typeof value.seq === "number" ? value.seq : 0,
    signals,
    present: { host: present.host === true, guests },
    capacity: value.capacity === 4 ? 4 : 2,
    closed: value.closed === true,
  };
}

/** The slice of `fetch` this module uses (Bun's type adds static helpers). */
type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * The global `fetch` must be called unbound: `this.fetcher(...)` would invoke
 * it with the client as `this`, which browsers reject with "Illegal
 * invocation". An injected test fetch is used as-is.
 */
const browserFetcher: Fetcher = (input, init) => fetch(input, init);

/**
 * One room's signaling session. Every call is a plain HTTP request, so the
 * client can be tested with an injected fetch and needs no WebSocket.
 */
export class VersusSignalingClient {
  readonly credentials: VersusCredentials;
  private readonly fetcher: Fetcher;
  private readonly endpoint: string;
  private seq = 0;
  private left = false;

  constructor(
    credentials: VersusCredentials,
    options: { fetcher?: Fetcher; endpoint?: string } = {},
  ) {
    this.credentials = credentials;
    this.fetcher = options.fetcher ?? browserFetcher;
    this.endpoint = options.endpoint ?? VERSUS_ENDPOINT;
  }

  private get headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.credentials.token}`,
    };
  }

  private async post(body: unknown): Promise<Response> {
    const fetcher = this.fetcher;

    return fetcher(this.endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });
  }

  /** Posts one SDP payload, addressed to a seat. */
  async send(
    kind: VersusSignalKind,
    payload: string,
    to: string | null = null,
  ): Promise<VersusClientResult<null>> {
    if (this.left) {
      return { ok: false, failure: "room-closed" };
    }

    try {
      const response = await this.post({
        action: "signal",
        ...this.credentials,
        kind,
        payload,
        ...(to === null ? {} : { to }),
      });

      if (!response.ok) {
        return { ok: false, failure: mapStatus(response.status) };
      }

      return { ok: true, value: null };
    } catch {
      return { ok: false, failure: "network" };
    }
  }

  async poll(): Promise<VersusClientResult<VersusPollResult>> {
    if (this.left) {
      return { ok: false, failure: "room-closed" };
    }

    const params = new URLSearchParams({
      code: this.credentials.code,
      id: this.credentials.id,
      since: String(this.seq),
    });

    try {
      const fetcher = this.fetcher;
      const response = await fetcher(
        `${this.endpoint}?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${this.credentials.token}`,
          },
          cache: "no-store",
        },
      );

      if (!response.ok) {
        return { ok: false, failure: mapStatus(response.status) };
      }

      const parsed = parsePoll(await response.json());

      if (!parsed) {
        return { ok: false, failure: "server-error" };
      }

      this.seq = Math.max(this.seq, parsed.seq);

      return { ok: true, value: parsed };
    } catch {
      return { ok: false, failure: "network" };
    }
  }

  async leave(): Promise<void> {
    if (this.left) {
      return;
    }

    this.left = true;

    try {
      await this.post({ action: "leave", ...this.credentials });
    } catch {
      // Leaving is best-effort; the room expires on its own.
    }
  }
}

async function postRoom(
  body: unknown,
  fetcher: Fetcher,
  endpoint: string,
): Promise<VersusClientResult<VersusCredentials>> {
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!response.ok) {
      const failure = mapStatus(response.status);

      // A full room and a closed room are user-visible but distinct.
      if (failure === "room-full") {
        try {
          const payload = (await response.json()) as { error?: string };
          if (payload.error === "ROOM_CLOSED") {
            return { ok: false, failure: "room-closed" };
          }
        } catch {
          // Fall through to ROOM_FULL.
        }
      }

      return { ok: false, failure };
    }

    const parsed = parseCredentials(await response.json());

    if (!parsed) {
      return { ok: false, failure: "server-error" };
    }

    return { ok: true, value: parsed };
  } catch {
    return { ok: false, failure: "network" };
  }
}

/** Creates a new room of the given capacity and returns host credentials. */
export function createVersusRoom(
  capacity: 2 | 4 = 2,
  options: { fetcher?: Fetcher; endpoint?: string } = {},
): Promise<VersusClientResult<VersusCredentials>> {
  return postRoom(
    { action: "create", capacity },
    options.fetcher ?? browserFetcher,
    options.endpoint ?? VERSUS_ENDPOINT,
  );
}

/** Joins an existing room by code and returns the guest's credentials. */
export function joinVersusRoom(
  code: string,
  options: { fetcher?: Fetcher; endpoint?: string } = {},
): Promise<VersusClientResult<VersusCredentials>> {
  return postRoom(
    { action: "join", code: code.trim().toUpperCase() },
    options.fetcher ?? browserFetcher,
    options.endpoint ?? VERSUS_ENDPOINT,
  );
}
