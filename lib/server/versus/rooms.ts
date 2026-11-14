/**
 * Server-only, in-memory pairing rooms for the online party modes.
 *
 * The server never sees or stores game state: it only relays WebRTC
 * offer/answer strings between the peers of a room. A room seats one host and
 * up to three guests, so the host opens one direct connection per guest.
 * Rooms are ephemeral, live on `globalThis` so every route-handler bundle
 * shares one store, and are pruned as soon as they expire. Payloads are capped
 * and never logged.
 *
 * This store assumes a single long-lived Node process (see `architecture.md`).
 * Serverless/multi-instance deployments would need an external store.
 */
import { randomBytes } from "node:crypto";

export type VersusRole = "host" | "guest";

/** `2` seats a 1v1, `4` seats all four board colours. */
export type VersusCapacity = 2 | 4;

/** Guest seats, in the order they are handed out. */
export const GUEST_SEAT_IDS = ["guest-1", "guest-2", "guest-3"] as const;
export type GuestSeatId = (typeof GUEST_SEAT_IDS)[number];

/**
 * `joined`/`left` tell the host that a seat changed, so it can open or drop a
 * direct connection. Both are internal to the room and never echoed back to
 * their sender.
 */
export type VersusSignalKind =
  | "offer"
  | "answer"
  | "joined"
  | "left"
  | "bye";

/** Maximum characters accepted for one SDP payload. */
export const MAX_SIGNAL_CHARS = 20_000;

/** How long a room survives without activity. */
export const ROOM_TTL_MS = 30 * 60_000;

/** A room with no guest is dropped after this, even if the host keeps polling. */
export const EMPTY_ROOM_TTL_MS = 10 * 60_000;

/** A full room holds one offer/answer pair per guest plus a few control notes. */
export const MAX_SIGNALS_PER_ROOM = 64;

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

export type VersusStoreError =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_CLOSED"
  | "UNAUTHORIZED"
  | "BAD_SIGNAL"
  | "TOO_MANY_SIGNALS";

export type VersusResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: VersusStoreError };

export interface VersusPeer {
  readonly id: string;
  readonly token: string;
}

export interface VersusCredentials extends VersusPeer {
  readonly code: string;
  readonly role: VersusRole;
}

export interface VersusSignal {
  readonly seq: number;
  readonly kind: VersusSignalKind;
  readonly payload: string;
  readonly at: number;
  /** The peer that sent it; a peer never reads its own signals back. */
  readonly from: string;
  /** The only peer allowed to read it, or `null` for a broadcast. */
  readonly to: string | null;
}

export interface VersusPresence {
  readonly host: boolean;
  readonly guests: readonly string[];
}

export interface VersusPoll {
  readonly seq: number;
  readonly signals: readonly VersusSignal[];
  readonly present: VersusPresence;
  readonly capacity: VersusCapacity;
  readonly closed: boolean;
}

interface StoredPeer extends VersusPeer {
  readonly role: VersusRole;
  lastSeenAt: number;
}

interface Room {
  readonly code: string;
  readonly capacity: VersusCapacity;
  readonly createdAt: number;
  touchedAt: number;
  closed: boolean;
  seq: number;
  readonly peers: Map<string, StoredPeer>;
  readonly signals: VersusSignal[];
}

export interface VersusServerOptions {
  readonly now?: () => number;
  /** Injected in tests so room codes are deterministic. */
  readonly newRoomCode?: () => string;
}

export interface VersusServer {
  create(capacity?: VersusCapacity): VersusResult<VersusCredentials>;
  join(code: string): VersusResult<VersusCredentials>;
  send(
    credentials: VersusPeer & { code: string },
    kind: VersusSignalKind,
    payload: string,
    to?: string | null,
  ): VersusResult<{ seq: number }>;
  poll(
    credentials: VersusPeer & { code: string },
    since: number,
  ): VersusResult<VersusPoll>;
  leave(credentials: VersusPeer & { code: string }): VersusResult<null>;
}

const SIGNAL_KINDS = new Set<VersusSignalKind>([
  "offer",
  "answer",
  "joined",
  "left",
  "bye",
]);

function randomToken(): string {
  return randomBytes(32).toString("hex");
}

function randomRoomCode(): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  let code = "";

  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_ALPHABET[bytes[index]! % ROOM_CODE_ALPHABET.length];
  }

  return code;
}

/** Normalizes the user-typed room code: trimmed and uppercased. */
export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isVersusCapacity(value: unknown): value is VersusCapacity {
  return value === 2 || value === 4;
}

export function isGuestSeatId(value: unknown): value is GuestSeatId {
  return (
    typeof value === "string" &&
    (GUEST_SEAT_IDS as readonly string[]).includes(value)
  );
}

function roleOf(id: string): VersusRole {
  return id === "host" ? "host" : "guest";
}

/**
 * Creates an isolated store. The production singleton is
 * `getVersusServer()`; tests call this directly with a fake clock.
 */
export function createVersusServer(
  options: VersusServerOptions = {},
): VersusServer {
  const now = options.now ?? (() => Date.now());
  const newRoomCode = options.newRoomCode ?? randomRoomCode;
  const rooms = new Map<string, Room>();

  const guestsOf = (room: Room): string[] =>
    GUEST_SEAT_IDS.filter((id) => room.peers.has(id));

  const prune = (time: number) => {
    for (const [code, room] of rooms) {
      const hasGuest = guestsOf(room).length > 0;

      // Without a guest the room is only useful while someone could still
      // join, so it is aged from creation: polling alone cannot keep a
      // guest-less room alive forever.
      const expired = hasGuest
        ? time - room.touchedAt > ROOM_TTL_MS
        : time - room.createdAt > EMPTY_ROOM_TTL_MS;

      if (expired) {
        rooms.delete(code);
      }
    }
  };

  const findRoom = (rawCode: string, time: number): Room | null => {
    prune(time);
    return rooms.get(normalizeRoomCode(rawCode)) ?? null;
  };

  const authorize = (
    room: Room | null,
    credentials: VersusPeer,
  ): VersusStoreError | null => {
    if (!room) {
      return "ROOM_NOT_FOUND";
    }

    const peer = room.peers.get(credentials.id);

    if (!peer || peer.token !== credentials.token) {
      return "UNAUTHORIZED";
    }

    return null;
  };

  const pushSignal = (
    room: Room,
    from: string,
    kind: VersusSignalKind,
    payload: string,
    to: string | null,
    time: number,
  ): void => {
    room.seq += 1;
    room.signals.push({
      seq: room.seq,
      kind,
      payload,
      at: time,
      from,
      to,
    });
  };

  const create = (
    capacity: VersusCapacity = 2,
  ): VersusResult<VersusCredentials> => {
    const time = now();
    prune(time);

    let code = normalizeRoomCode(newRoomCode());

    // Extremely unlikely, but never hand out a live room code twice.
    for (let attempt = 0; attempt < 8 && rooms.has(code); attempt += 1) {
      code = normalizeRoomCode(newRoomCode());
    }

    if (rooms.has(code)) {
      return { ok: false, error: "ROOM_FULL" };
    }

    const host: StoredPeer = {
      id: "host",
      token: randomToken(),
      role: "host",
      lastSeenAt: time,
    };

    rooms.set(code, {
      code,
      capacity,
      createdAt: time,
      touchedAt: time,
      closed: false,
      seq: 0,
      peers: new Map([[host.id, host]]),
      signals: [],
    });

    return {
      ok: true,
      value: { code, id: host.id, token: host.token, role: "host" },
    };
  };

  const join = (rawCode: string): VersusResult<VersusCredentials> => {
    const time = now();
    const room = findRoom(rawCode, time);

    if (!room) {
      return { ok: false, error: "ROOM_NOT_FOUND" };
    }

    if (room.closed) {
      return { ok: false, error: "ROOM_CLOSED" };
    }

    const seat = GUEST_SEAT_IDS.slice(0, room.capacity - 1).find(
      (id) => !room.peers.has(id),
    );

    if (!seat) {
      return { ok: false, error: "ROOM_FULL" };
    }

    const guest: StoredPeer = {
      id: seat,
      token: randomToken(),
      role: "guest",
      lastSeenAt: time,
    };

    room.peers.set(guest.id, guest);
    room.touchedAt = time;
    pushSignal(room, guest.id, "joined", "", "host", time);

    return {
      ok: true,
      value: {
        code: room.code,
        id: guest.id,
        token: guest.token,
        role: "guest",
      },
    };
  };

  const send = (
    credentials: VersusPeer & { code: string },
    kind: VersusSignalKind,
    payload: string,
    to: string | null = null,
  ): VersusResult<{ seq: number }> => {
    const time = now();
    const room = findRoom(credentials.code, time);
    const error = authorize(room, credentials);

    if (error || !room) {
      return { ok: false, error: error ?? "ROOM_NOT_FOUND" };
    }

    if (!SIGNAL_KINDS.has(kind) || room.closed) {
      return { ok: false, error: "BAD_SIGNAL" };
    }

    if (
      typeof payload !== "string" ||
      payload.length > MAX_SIGNAL_CHARS ||
      (kind !== "joined" && kind !== "left" && payload.length === 0)
    ) {
      return { ok: false, error: "BAD_SIGNAL" };
    }

    if (to !== null && (typeof to !== "string" || !room.peers.has(to))) {
      return { ok: false, error: "BAD_SIGNAL" };
    }

    if (room.signals.length >= MAX_SIGNALS_PER_ROOM) {
      return { ok: false, error: "TOO_MANY_SIGNALS" };
    }

    pushSignal(room, credentials.id, kind, payload, to, time);
    room.touchedAt = time;

    const peer = room.peers.get(credentials.id);

    if (peer) {
      peer.lastSeenAt = time;
    }

    if (kind === "bye" && roleOf(credentials.id) === "host") {
      room.closed = true;
    }

    return { ok: true, value: { seq: room.seq } };
  };

  const poll = (
    credentials: VersusPeer & { code: string },
    since: number,
  ): VersusResult<VersusPoll> => {
    const time = now();
    const room = findRoom(credentials.code, time);
    const error = authorize(room, credentials);

    if (error || !room) {
      return { ok: false, error: error ?? "ROOM_NOT_FOUND" };
    }

    const peer = room.peers.get(credentials.id);

    if (peer) {
      peer.lastSeenAt = time;
    }

    room.touchedAt = time;

    const cursor = Number.isFinite(since) ? Math.max(0, Math.floor(since)) : 0;
    // A peer only reads what was addressed to it (or broadcast); its own
    // messages are noise.
    const signals = room.signals.filter(
      (signal) =>
        signal.seq > cursor &&
        signal.from !== credentials.id &&
        (signal.to === null || signal.to === credentials.id),
    );

    return {
      ok: true,
      value: {
        seq: room.seq,
        signals,
        present: {
          host: room.peers.has("host"),
          guests: guestsOf(room),
        },
        capacity: room.capacity,
        closed: room.closed,
      },
    };
  };

  const leave = (
    credentials: VersusPeer & { code: string },
  ): VersusResult<null> => {
    const time = now();
    const room = findRoom(credentials.code, time);
    const error = authorize(room, credentials);

    if (error || !room) {
      return { ok: false, error: error ?? "ROOM_NOT_FOUND" };
    }

    room.peers.delete(credentials.id);

    if (roleOf(credentials.id) === "host") {
      // No host migration: the room ends for everyone.
      room.closed = true;
      room.signals.length = 0;
    } else {
      room.touchedAt = time;
      pushSignal(room, credentials.id, "left", "", "host", time);
    }

    return { ok: true, value: null };
  };

  return { create, join, send, poll, leave };
}

interface VersusGlobal {
  __versusRooms?: VersusServer;
}

/** The shared store used by the route handler. */
export function getVersusServer(): VersusServer {
  const scope = globalThis as unknown as VersusGlobal;
  scope.__versusRooms ??= createVersusServer();
  return scope.__versusRooms;
}
