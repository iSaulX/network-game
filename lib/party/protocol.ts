/**
 * Wire types for online party sessions.
 *
 * Everything here is framework-free and browser-safe: the same messages travel
 * over the WebRTC data channel in the app and over an in-memory pair in tests.
 * The host is authoritative; guests only send intents, never die values.
 *
 * A room has one host and up to three guests. The host talks to every guest
 * over its own data channel (star topology); guests never talk to each other.
 */
import type { BonusMove, GameEvent, GameState, Move } from "@/lib/parchis/types";

export const PARTY_PROTOCOL_VERSION = 4 as const;

/** Hard cap for one data-channel message. State snapshots are far smaller. */
export const MAX_WIRE_CHARS = 64 * 1024;

/** Reliable, ordered data channel created by the host before the offer. */
export const DATA_CHANNEL_LABEL = "parchis-v1";

export type PartyRole = "host" | "guest";

/** `1v1` seats two players; `all` seats four. */
export type GameMode = "1v1" | "all";

/** Stable ids: one host, up to three guests, and bots by board colour. */
export const HOST_ID = "host" as const;
export const GUEST_IDS = ["guest-1", "guest-2", "guest-3"] as const;
export const BOT_IDS = [
  "bot-red",
  "bot-yellow",
  "bot-blue",
  "bot-green",
] as const;

export type GuestId = (typeof GUEST_IDS)[number];
export type BotId = (typeof BOT_IDS)[number];
export type PlayerId = typeof HOST_ID | GuestId | BotId;

export interface LanPlayerInfo {
  readonly id: PlayerId;
  /** Display name, trimmed and capped at 24 characters. */
  readonly name: string;
  /** One of the allowlisted `/pictures/*.png` avatars. */
  readonly avatar: string;
}

export interface LanRoster {
  readonly players: readonly LanPlayerInfo[];
}

/** ICE candidate type actually selected for a peer's link. */
export type IceCandidateType = "host" | "srflx" | "prflx" | "relay" | "unknown";

/** How a seat is connected: a direct WebRTC channel or the in-memory test pair. */
export type SeatTransport = "webrtc" | "memory";

export interface SeatConnection {
  readonly transport: SeatTransport;
  readonly candidate: IceCandidateType;
}

export type ClientAction =
  | { readonly type: "ROLL" }
  | { readonly type: "MOVE"; readonly move: Move }
  | { readonly type: "BONUS_MOVE"; readonly move: BonusMove }
  | { readonly type: "CHOOSE_BARRIER"; readonly progress: number };

export type PartyErrorCode =
  | "PROTOCOL_MISMATCH"
  | "BAD_MESSAGE"
  | "NOT_YOUR_TURN"
  | "STALE_VERSION"
  | "WRONG_PHASE"
  | "ILLEGAL_MOVE"
  | "INVALID_BONUS"
  | "INVALID_BARRIER"
  | "GAME_OVER"
  | "RATE_LIMITED"
  | "NOT_READY";

export type GuestToHostMessage =
  | {
      readonly type: "HELLO";
      readonly protocol: number;
      readonly player: LanPlayerInfo;
    }
  | {
      readonly type: "ACTION";
      readonly protocol: number;
      readonly version: number;
      readonly action: ClientAction;
      readonly requestId: string;
    };

export type HostToGuestMessage =
  | {
      readonly type: "LOBBY";
      readonly protocol: number;
      readonly mode: GameMode;
      /** Connected humans, host first; empty seats are not listed. */
      readonly players: readonly LanPlayerInfo[];
      /**
       * Seats the host chose to leave unoccupied. They are not filled by bots
       * when the match starts, so the table seats fewer players.
       */
      readonly emptySeats: readonly string[];
    }
  | {
      readonly type: "START";
      readonly protocol: number;
      readonly version: number;
      /** The room's mode: a 1v1 and an "all" room can both seat two players. */
      readonly mode: GameMode;
      readonly roster: LanRoster;
      readonly state: GameState;
    }
  | {
      readonly type: "STATE";
      readonly protocol: number;
      readonly version: number;
      readonly state: GameState;
      readonly events: readonly GameEvent[];
    }
  | {
      readonly type: "ERROR";
      readonly protocol: number;
      readonly version: number;
      readonly code: PartyErrorCode;
      readonly message: string;
      readonly state?: GameState;
    }
  | {
      readonly type: "CONNECTION";
      readonly protocol: number;
      /** Per-seat transport and selected ICE candidate type. */
      readonly connections: Readonly<Record<string, SeatConnection>>;
    }
  | {
      readonly type: "BYE";
      readonly protocol: number;
      readonly reason: "host-closed";
    };

export type WireMessage = GuestToHostMessage | HostToGuestMessage;

export type DecodeResult =
  | { readonly ok: true; readonly message: WireMessage }
  | { readonly ok: false; readonly code: PartyErrorCode; readonly message: string };

const GUEST_MESSAGE_TYPES = new Set(["HELLO", "ACTION"]);
const HOST_MESSAGE_TYPES = new Set([
  "LOBBY",
  "START",
  "STATE",
  "ERROR",
  "CONNECTION",
  "BYE",
]);
const CANDIDATE_TYPES = new Set<string>([
  "host",
  "srflx",
  "prflx",
  "relay",
  "unknown",
]);
const SEAT_TRANSPORTS = new Set<string>(["webrtc", "memory"]);
const ERROR_CODES = new Set<string>([
  "PROTOCOL_MISMATCH",
  "BAD_MESSAGE",
  "NOT_YOUR_TURN",
  "STALE_VERSION",
  "WRONG_PHASE",
  "ILLEGAL_MOVE",
  "INVALID_BONUS",
  "INVALID_BARRIER",
  "GAME_OVER",
  "RATE_LIMITED",
  "NOT_READY",
]);

const PLAYER_ID_PATTERN =
  /^(?:host|guest-[1-3]|bot-(?:red|blue|yellow|green))$/;
const GUEST_ID_PATTERN = /^guest-[1-3]$/;

/** Avatar values are always local asset paths, never peer-supplied URLs. */
export function isAllowedAvatar(value: string): boolean {
  return /^\/pictures\/[a-z]+\.png$/.test(value);
}

export function sanitizePlayerName(value: string): string {
  return value.trim().slice(0, 24);
}

export function isPlayerId(value: unknown): value is PlayerId {
  return typeof value === "string" && PLAYER_ID_PATTERN.test(value);
}

export function isGuestId(value: unknown): value is GuestId {
  return typeof value === "string" && GUEST_ID_PATTERN.test(value);
}

export function isGameMode(value: unknown): value is GameMode {
  return value === "1v1" || value === "all";
}

/** Board colour each seat plays. Host is red, guests follow the colour order. */
export const SEAT_BOARD_COLOR: Readonly<Record<PlayerId, string>> =
  Object.freeze({
    host: "red",
    "guest-1": "yellow",
    "guest-2": "blue",
    "guest-3": "green",
    "bot-red": "red",
    "bot-yellow": "yellow",
    "bot-blue": "blue",
    "bot-green": "green",
  });

export function isBotId(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("bot-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDieValue(value: unknown): value is 1 | 2 | 3 | 4 | 5 | 6 {
  return (
    value === 1 ||
    value === 2 ||
    value === 3 ||
    value === 4 ||
    value === 5 ||
    value === 6
  );
}

function isProgress(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 71;
}

function isMove(value: unknown): value is Move {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.type === "ADVANCE" &&
    typeof value.tokenId === "string" &&
    value.tokenId.length > 0 &&
    value.tokenId.length <= 48 &&
    isProgress(value.to) &&
    isDieValue(value.die) &&
    Object.keys(value).length === 4
  );
}

function isBonusMove(value: unknown): value is BonusMove {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.kind === "capture-20" || value.kind === "home-10") &&
    typeof value.tokenId === "string" &&
    value.tokenId.length > 0 &&
    value.tokenId.length <= 48 &&
    isProgress(value.to) &&
    Object.keys(value).length === 3
  );
}

function isClientAction(value: unknown): value is ClientAction {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.type) {
    case "ROLL":
      return Object.keys(value).length === 1;
    case "MOVE":
      return Object.keys(value).length === 2 && isMove(value.move);
    case "BONUS_MOVE":
      return Object.keys(value).length === 2 && isBonusMove(value.move);
    case "CHOOSE_BARRIER":
      return Object.keys(value).length === 2 && isProgress(value.progress);
    default:
      return false;
  }
}

function isSeatConnection(value: unknown): value is SeatConnection {
  return (
    isRecord(value) &&
    typeof value.transport === "string" &&
    SEAT_TRANSPORTS.has(value.transport) &&
    typeof value.candidate === "string" &&
    CANDIDATE_TYPES.has(value.candidate)
  );
}

function isConnectionMap(
  value: unknown,
): value is Readonly<Record<string, SeatConnection>> {
  if (!isRecord(value)) {
    return false;
  }

  const entries = Object.entries(value);

  return (
    entries.length <= 4 &&
    entries.every(
      ([seat, connection]) =>
        (seat === "host" || isGuestId(seat)) && isSeatConnection(connection),
    )
  );
}

function isLanPlayerInfo(value: unknown): value is LanPlayerInfo {
  return (
    isRecord(value) &&
    isPlayerId(value.id) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 24 &&
    typeof value.avatar === "string" &&
    isAllowedAvatar(value.avatar)
  );
}

function isHumanSeat(value: unknown): value is LanPlayerInfo {
  return (
    isLanPlayerInfo(value) && (value.id === "host" || isGuestId(value.id))
  );
}

function hasUniqueIds(players: readonly LanPlayerInfo[]): boolean {
  return new Set(players.map((player) => player.id)).size === players.length;
}

function isLobbyPlayers(value: unknown): value is readonly LanPlayerInfo[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 4 &&
    value.every(isHumanSeat) &&
    hasUniqueIds(value as LanPlayerInfo[])
  );
}

/**
 * Seats the host marked as empty. They are seat ids (`host`/`guest-N`), never
 * bots, and must be unique. The host's own seat is never empty.
 */
function isEmptySeatList(
  value: unknown,
  players: readonly LanPlayerInfo[],
): value is readonly string[] {
  // Absent means "no empty seats", which keeps older senders decodable.
  if (value === undefined) return true;

  if (
    !Array.isArray(value) ||
    value.length > 3 ||
    !value.every((item) => typeof item === "string" && /^guest-[1-3]$/.test(item)) ||
    new Set(value as string[]).size !== value.length
  ) {
    return false;
  }

  const occupied = new Set<string>(players.map((player) => player.id));
  return (value as string[]).every((item) => !occupied.has(item));
}

function isRoster(value: unknown): value is LanRoster {
  if (!isRecord(value) || !Array.isArray(value.players)) {
    return false;
  }

  const players = value.players as unknown[];

  return (
    // A table may leave seats empty, so it can seat 2 to 4 players.
    players.length >= 2 &&
    players.length <= 4 &&
    players.every(isLanPlayerInfo) &&
    hasUniqueIds(players as LanPlayerInfo[]) &&
    players.some((player) => (player as LanPlayerInfo).id === "host")
  );
}

function isGameState(value: unknown): value is GameState {
  return (
    isRecord(value) &&
    value.schemaVersion === 2 &&
    value.mode === "classic" &&
    Array.isArray(value.players) &&
    Array.isArray(value.log) &&
    typeof value.turn === "number"
  );
}

function isEventArray(value: unknown): value is readonly GameEvent[] {
  return Array.isArray(value) && value.length <= 512;
}

function fail(code: PartyErrorCode, message: string): DecodeResult {
  return { ok: false, code, message };
}

/**
 * Validates one inbound message. Peer input is untrusted: every field is
 * checked structurally and nothing is ever evaluated.
 */
export function decodeWireMessage(raw: unknown): DecodeResult {
  if (typeof raw !== "string") {
    return fail("BAD_MESSAGE", "The message is not text.");
  }

  if (raw.length > MAX_WIRE_CHARS) {
    return fail("BAD_MESSAGE", "The message is too large.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("BAD_MESSAGE", "The message is not valid JSON.");
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return fail("BAD_MESSAGE", "The message has no type.");
  }

  if (parsed.protocol !== PARTY_PROTOCOL_VERSION) {
    return fail("PROTOCOL_MISMATCH", "The protocol version does not match.");
  }

  const type = parsed.type;

  if (GUEST_MESSAGE_TYPES.has(type)) {
    if (type === "HELLO") {
      if (!isLanPlayerInfo(parsed.player) || !isGuestId(parsed.player.id)) {
        return fail("BAD_MESSAGE", "Malformed HELLO.");
      }
      return { ok: true, message: parsed as unknown as GuestToHostMessage };
    }

    if (
      typeof parsed.version !== "number" ||
      !Number.isInteger(parsed.version) ||
      parsed.version < 0 ||
      typeof parsed.requestId !== "string" ||
      parsed.requestId.length === 0 ||
      parsed.requestId.length > 64 ||
      !isClientAction(parsed.action)
    ) {
      return fail("BAD_MESSAGE", "Malformed ACTION.");
    }

    return { ok: true, message: parsed as unknown as GuestToHostMessage };
  }

  if (!HOST_MESSAGE_TYPES.has(type)) {
    return fail("BAD_MESSAGE", "Unknown message type.");
  }

  if (type === "BYE") {
    if (parsed.reason !== "host-closed") {
      return fail("BAD_MESSAGE", "Malformed BYE.");
    }
    return { ok: true, message: parsed as unknown as HostToGuestMessage };
  }

  if (type === "CONNECTION") {
    if (!isConnectionMap(parsed.connections)) {
      return fail("BAD_MESSAGE", "Malformed CONNECTION.");
    }
    return { ok: true, message: parsed as unknown as HostToGuestMessage };
  }

  if (type === "LOBBY") {
    if (
      !isGameMode(parsed.mode) ||
      !isLobbyPlayers(parsed.players) ||
      !isEmptySeatList(parsed.emptySeats, parsed.players)
    ) {
      return fail("BAD_MESSAGE", "Malformed LOBBY.");
    }
    return { ok: true, message: parsed as unknown as HostToGuestMessage };
  }

  if (
    typeof parsed.version !== "number" ||
    !Number.isInteger(parsed.version) ||
    parsed.version < 0
  ) {
    return fail("BAD_MESSAGE", "Malformed version.");
  }

  if (type === "ERROR") {
    if (
      typeof parsed.code !== "string" ||
      !ERROR_CODES.has(parsed.code) ||
      typeof parsed.message !== "string" ||
      parsed.message.length > 512
    ) {
      return fail("BAD_MESSAGE", "Malformed ERROR.");
    }
    return { ok: true, message: parsed as unknown as HostToGuestMessage };
  }

  if (!isGameState(parsed.state)) {
    return fail("BAD_MESSAGE", "Malformed state.");
  }

  if (type === "START") {
    if (!isGameMode(parsed.mode) || !isRoster(parsed.roster)) {
      return fail("BAD_MESSAGE", "Malformed roster.");
    }
  }

  if (type === "STATE" && !isEventArray(parsed.events)) {
    return fail("BAD_MESSAGE", "Malformed events.");
  }

  return { ok: true, message: parsed as unknown as HostToGuestMessage };
}

/** Serializes one message, enforcing the size cap. */
export function encodeWireMessage(message: WireMessage): string {
  const text = JSON.stringify(message);

  if (text.length > MAX_WIRE_CHARS) {
    throw new Error("The wire message exceeds the size limit.");
  }

  return text;
}
