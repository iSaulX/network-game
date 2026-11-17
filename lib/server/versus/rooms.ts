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

/**
 * Signals older than this are dropped even if nobody read them. Pairing
 * completes in seconds, so a minute-old offer can no longer be useful.
 */
export const SIGNAL_TTL_MS = 2 * 60_000;

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

export type VersusStoreError =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_CLOSED"
  | "ROOM_STARTED"
  | "PEER_GONE"
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
  /**
   * Occupant generation of the sender and recipient. A seat is reused by
   * later guests, and signals from a previous occupant must never reach the
   * next one (nor the host, once that guest is gone).
   */
  readonly fromEpoch: number;
  readonly toEpoch: number | null;
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
  /** Incremented on every join, so seat reuse is distinguishable. */
  readonly epoch: number;
  /** Signals at or below this seq predate the peer and are never delivered. */
  readonly joinedSeq: number;
  lastSeenAt: number;
  /** Highest cursor this peer has polled with; used to prune read signals. */
  lastPolledSeq: number;
}

interface Room {
  readonly code: string;
  readonly capacity: VersusCapacity;
  readonly createdAt: number;
  touchedAt: number;
  closed: boolean;
  /** True once the host starts the match; new guests are refused. */
  started: boolean;
  seq: number;
  epochCounter: number;
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
  /** Host-only: refuses new guests because the match already started. */
  markStarted(
    credentials: VersusPeer & { code: string },
  ): VersusResult<null>;
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

  /**
   * Drops signals that can no longer be delivered usefully:
   * - ones whose sender seat has since been re-occupied (or emptied),
   * - ones addressed to a seat that is gone or already read them,
   * - broadcasts every other peer has already polled past,
   * - anything older than `SIGNAL_TTL_MS`.
   *
   * Without this the room accumulates every join/leave/offer forever and
   * eventually refuses new signals (`TOO_MANY_SIGNALS`), poisoning the room
   * for everyone.
   */
  const pruneSignals = (room: Room, time: number) => {
    const peers = [...room.peers.values()];

    const kept = room.signals.filter((signal) => {
      if (time - signal.at > SIGNAL_TTL_MS) {
        return false;
      }

      // A `left` note is the only signal whose sender is already gone.
      if (signal.kind !== "left") {
        const sender = room.peers.get(signal.from);
        if (!sender || sender.epoch !== signal.fromEpoch) {
          return false;
        }
      }

      if (signal.to === null) {
        return peers.some(
          (peer) => peer.id !== signal.from && peer.lastPolledSeq < signal.seq,
        );
      }

      const recipient = room.peers.get(signal.to);

      if (!recipient || recipient.epoch !== signal.toEpoch) {
        return false;
      }

      return recipient.lastPolledSeq < signal.seq;
    });

    if (kept.length !== room.signals.length) {
      room.signals.length = 0;
      room.signals.push(...kept);
    }
  };

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
        continue;
      }

      pruneSignals(room, time);
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
      fromEpoch: room.peers.get(from)?.epoch ?? 0,
      toEpoch: to === null ? null : (room.peers.get(to)?.epoch ?? 0),
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
      epoch: 1,
      joinedSeq: 0,
      lastSeenAt: time,
      lastPolledSeq: 0,
    };

    rooms.set(code, {
      code,
      capacity,
      createdAt: time,
      touchedAt: time,
      closed: false,
      started: false,
      seq: 0,
      epochCounter: 1,
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

    if (room.started) {
      return { ok: false, error: "ROOM_STARTED" };
    }

    const seat = GUEST_SEAT_IDS.slice(0, room.capacity - 1).find(
      (id) => !room.peers.has(id),
    );

    if (!seat) {
      return { ok: false, error: "ROOM_FULL" };
    }

    // The seat may have held a previous guest whose pairing is still in the
    // log. Those signals must never reach the next occupant, or it answers an
    // offer the host is no longer waiting for.
    const kept = room.signals.filter(
      (signal) => signal.from !== seat && signal.to !== seat,
    );
    if (kept.length !== room.signals.length) {
      room.signals.length = 0;
      room.signals.push(...kept);
    }

    room.epochCounter += 1;

    const guest: StoredPeer = {
      id: seat,
      token: randomToken(),
      role: "guest",
      epoch: room.epochCounter,
      // Nothing emitted before this join is relevant to this occupant.
      joinedSeq: room.seq,
      lastSeenAt: time,
      lastPolledSeq: room.seq,
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

    if (to !== null && typeof to !== "string") {
      return { ok: false, error: "BAD_SIGNAL" };
    }

    // The seat may have left between the sender's poll and this request.
    // That is a race, not a malformed message: report it separately so the
    // host can drop the seat instead of ending the whole lobby.
    if (to !== null && !room.peers.has(to)) {
      return { ok: false, error: "PEER_GONE" };
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

    if (!peer) {
      return { ok: false, error: "UNAUTHORIZED" };
    }

    peer.lastSeenAt = time;
    room.touchedAt = time;

    // A seat may be reused; never replay anything from before this occupant
    // joined, even if the client starts its cursor at zero.
    const cursor = Math.max(
      peer.joinedSeq,
      Number.isFinite(since) ? Math.max(0, Math.floor(since)) : 0,
    );

    peer.lastPolledSeq = Math.max(peer.lastPolledSeq, cursor);

    // A peer only reads what was addressed to it (or broadcast); its own
    // messages are noise, and signals from a previous occupant of a seat are
    // never delivered.
    const signals = room.signals.filter(
      (signal) =>
        signal.seq > cursor &&
        signal.from !== credentials.id &&
        (signal.to === null || signal.to === credentials.id) &&
        (signal.kind === "left" ||
          room.peers.get(signal.from)?.epoch === signal.fromEpoch) &&
        (signal.to === null || signal.toEpoch === peer.epoch),
    );

    pruneSignals(room, time);

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

    if (roleOf(credentials.id) === "host") {
      // No host migration: the room ends for everyone.
      room.peers.delete(credentials.id);
      room.closed = true;
      room.signals.length = 0;
      return { ok: true, value: null };
    }

    // Drop everything addressed to or sent by the departing guest before the
    // `left` note, so a later occupant of the seat inherits a clean log.
    const kept = room.signals.filter(
      (signal) =>
        signal.from !== credentials.id && signal.to !== credentials.id,
    );
    if (kept.length !== room.signals.length) {
      room.signals.length = 0;
      room.signals.push(...kept);
    }

    room.peers.delete(credentials.id);
    room.touchedAt = time;
    pushSignal(room, credentials.id, "left", "", "host", time);

    return { ok: true, value: null };
  };

  /** Host-only: marks the room as started, refusing new guests from now on. */
  const markStarted = (
    credentials: VersusPeer & { code: string },
  ): VersusResult<null> => {
    const time = now();
    const room = findRoom(credentials.code, time);
    const error = authorize(room, credentials);

    if (error || !room) {
      return { ok: false, error: error ?? "ROOM_NOT_FOUND" };
    }

    if (roleOf(credentials.id) !== "host") {
      return { ok: false, error: "UNAUTHORIZED" };
    }

    room.started = true;
    room.touchedAt = time;

    return { ok: true, value: null };
  };

  return { create, join, send, poll, leave, markStarted };
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
