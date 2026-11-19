/**
 * Server-authoritative party state.
 *
 * The host's browser is no longer the referee: the server owns the game state
 * and persists it in Redis (inside the room snapshot). Every mutation here is
 * pure over a `VersusRoom`, so the same rules run under the Redis lock and in
 * unit tests. Bots, and humans whose socket dropped mid-match, are played by
 * the server with the shared bot policy.
 */
import { createGame } from "@/lib/parchis";
import type { DieValue, GameEvent, GameState } from "@/lib/parchis/types";
import {
  chooseBarrier,
  chooseBonusMove,
  chooseMove,
} from "@/lib/bots/policy";
import { applyAction, cryptoDice } from "@/lib/party/authority";
import {
  isBotId,
  isGuestId,
  isLanPlayerInfo,
  type ClientAction,
  type GameMode,
  type LanPlayerInfo,
  type LanRoster,
  type PartyErrorCode,
  type PlayerId,
} from "@/lib/party/protocol";
import { buildConfigs, buildRoster, seatIdsFor } from "@/lib/party/seats";
import {
  leaveRoomState,
  type VersusCredentials,
  type VersusRoom,
} from "./rooms";

/** How long the server waits before playing an automated seat. */
export const BOT_DELAY_MS = 700;

/** A socket that has not sent a heartbeat for this long is considered gone. */
export const PRESENCE_TTL_MS = 30_000;

/** Guest seats in the order they are accepted by the lobby. */
const GUEST_SEATS = ["guest-1", "guest-2", "guest-3"] as const;

export interface PartyRoomState {
  readonly mode: GameMode;
  /** Human profiles by seat id; kept across reconnects. */
  profiles: Record<string, LanPlayerInfo>;
  /** Seat id → last heartbeat timestamp. */
  presence: Record<string, number>;
  /** Guest seats the host chose to leave without a bot. */
  emptySeats: string[];
  version: number;
  game: GameState | null;
  roster: LanRoster | null;
  /** Events appended by the last action, used by the client for sound/dice. */
  events: GameEvent[];
  /** Human seats currently played by the server because their socket is gone. */
  disconnected: string[];
  /** When the server should run the next automated action, or null. */
  botDueAt: number | null;
  updatedAt: number;
}

export interface PartySnapshot {
  readonly code: string;
  readonly mode: GameMode;
  readonly capacity: 2 | 4;
  /** Connected humans in the lobby, or the human seats of the roster once started. */
  readonly players: readonly LanPlayerInfo[];
  readonly emptySeats: readonly string[];
  readonly started: boolean;
  readonly version: number;
  readonly state: GameState | null;
  readonly roster: LanRoster | null;
  readonly events: readonly GameEvent[];
  readonly disconnected: readonly string[];
  readonly closed: boolean;
  /** Server-only: when the next bot step is due. */
  readonly nextBotAt: number | null;
}

export type PartyMutationKind = "lobby" | "start" | "state" | "bye" | "none";

export interface PartyMutation {
  readonly snapshot: PartySnapshot;
  readonly kind: PartyMutationKind;
  readonly error?: {
    readonly code: PartyErrorCode;
    readonly message: string;
  };
  /** The host left and the room must be closed on every instance. */
  readonly closeRoom?: boolean;
}

export function createPartyState(capacity: 2 | 4, time: number): PartyRoomState {
  return {
    mode: capacity === 2 ? "1v1" : "all",
    profiles: {},
    presence: {},
    emptySeats: [],
    version: 0,
    game: null,
    roster: null,
    events: [],
    disconnected: [],
    botDueAt: null,
    updatedAt: time,
  };
}

/** Adds party state to rooms created before this feature existed. */
export function ensurePartyState(
  room: VersusRoom,
  time: number,
): PartyRoomState {
  room.party ??= createPartyState(room.capacity, time);
  return room.party;
}

function isHumanSeat(id: string): boolean {
  return id === "host" || isGuestId(id);
}

function isPresent(
  party: PartyRoomState,
  id: string,
  time: number,
): boolean {
  const at = party.presence[id];
  return typeof at === "number" && time - at <= PRESENCE_TTL_MS;
}

function connectedHumans(
  party: PartyRoomState,
  time: number,
): LanPlayerInfo[] {
  const seats: readonly string[] = ["host", ...GUEST_SEATS];

  return seats
    .filter((id) => party.profiles[id] !== undefined && isPresent(party, id, time))
    .map((id) => party.profiles[id]!);
}

/**
 * Drops stale heartbeats and recomputes which human seats the server must
 * play. Profiles are kept so a reconnecting player can reclaim the seat.
 */
export function prunePresence(
  party: PartyRoomState,
  time: number,
): boolean {
  let changed = false;

  for (const id of Object.keys(party.presence)) {
    const at = party.presence[id]!;
    if (time - at > PRESENCE_TTL_MS) {
      delete party.presence[id];
      changed = true;
    }
  }

  const nextDisconnected = party.game && party.roster
    ? party.roster.players
        .filter((player) => !isBotId(player.id))
        .filter((player) => !isPresent(party, player.id, time))
        .map((player) => player.id)
    : [];

  if (
    nextDisconnected.length !== party.disconnected.length ||
    nextDisconnected.some((id, index) => party.disconnected[index] !== id)
  ) {
    party.disconnected = nextDisconnected;
    changed = true;
  }

  return changed;
}

function isAutomated(party: PartyRoomState, playerId: string): boolean {
  return isBotId(playerId) || party.disconnected.includes(playerId);
}

/** When the current seat is automated, the delay before its next action. */
function automationDue(
  party: PartyRoomState,
  time: number,
): number | null {
  if (!party.game || party.game.phase === "finished") {
    return null;
  }

  const current = party.game.players[party.game.currentPlayerIndex];

  return current && isAutomated(party, current.id)
    ? time + BOT_DELAY_MS
    : null;
}

export function partySnapshot(room: VersusRoom, time: number): PartySnapshot {
  const party = ensurePartyState(room, time);
  const players = party.game && party.roster
    ? party.roster.players.filter((player) => !isBotId(player.id))
    : connectedHumans(party, time);

  return {
    code: room.code,
    mode: party.mode,
    capacity: room.capacity,
    players,
    emptySeats: [...party.emptySeats],
    started: party.game !== null,
    version: party.version,
    state: party.game,
    roster: party.roster,
    events: [...party.events],
    disconnected: [...party.disconnected],
    closed: room.closed,
    nextBotAt: party.botDueAt,
  };
}

function failure(
  room: VersusRoom,
  time: number,
  code: PartyErrorCode,
  message: string,
): PartyMutation {
  return {
    snapshot: partySnapshot(room, time),
    kind: "none",
    error: { code, message },
  };
}

/** Records a socket's profile and heartbeat; the seat keeps its room token. */
export function connectParty(
  room: VersusRoom,
  credentials: VersusCredentials,
  player: LanPlayerInfo,
  time: number,
): PartyMutation {
  const party = ensurePartyState(room, time);
  prunePresence(party, time);

  if (
    !isLanPlayerInfo(player) ||
    player.id !== credentials.id ||
    !isHumanSeat(credentials.id)
  ) {
    return failure(room, time, "BAD_MESSAGE", "Invalid player profile.");
  }

  party.profiles[credentials.id] = player;
  party.presence[credentials.id] = time;
  // A human who reconnects reclaims a seat the host had marked empty.
  if (!party.game) {
    party.emptySeats = party.emptySeats.filter((seat) => seat !== credentials.id);
  }
  party.disconnected = party.disconnected.filter(
    (id) => id !== credentials.id,
  );
  party.updatedAt = time;
  room.touchedAt = time;

  return {
    snapshot: partySnapshot(room, time),
    kind: party.game ? "none" : "lobby",
  };
}

/**
 * A socket closed without an explicit LEAVE. Mid-match the seat is played by
 * the server; before the start the player disappears from the lobby but keeps
 * the room seat so a reconnect is seamless.
 */
export function disconnectParty(
  room: VersusRoom,
  credentials: VersusCredentials,
  time: number,
): PartyMutation {
  const party = ensurePartyState(room, time);
  delete party.presence[credentials.id];
  prunePresence(party, time);
  party.updatedAt = time;
  room.touchedAt = time;

  return {
    snapshot: partySnapshot(room, time),
    kind: party.game ? "none" : "lobby",
  };
}

export function heartbeatParty(
  room: VersusRoom,
  credentials: VersusCredentials,
  time: number,
): PartyMutation {
  const party = ensurePartyState(room, time);
  const wasDisconnected = party.disconnected.includes(credentials.id);
  party.presence[credentials.id] = time;
  prunePresence(party, time);
  party.updatedAt = time;
  room.touchedAt = time;

  return {
    snapshot: partySnapshot(room, time),
    kind: !party.game && wasDisconnected ? "lobby" : "none",
  };
}

export function setSeatEmptyParty(
  room: VersusRoom,
  credentials: VersusCredentials,
  seatId: string,
  empty: boolean,
  time: number,
): PartyMutation {
  const party = ensurePartyState(room, time);
  prunePresence(party, time);

  if (party.game) {
    return failure(room, time, "NOT_READY", "The match already started.");
  }

  if (credentials.id !== "host") {
    return failure(room, time, "BAD_MESSAGE", "Only the host can change seats.");
  }

  const seats = seatIdsFor(party.mode);

  if (
    seatId === "host" ||
    !GUEST_SEATS.includes(seatId as (typeof GUEST_SEATS)[number]) ||
    !seats.includes(seatId as PlayerId)
  ) {
    return failure(room, time, "BAD_MESSAGE", "Invalid seat.");
  }

  if (empty && isPresent(party, seatId, time)) {
    return failure(room, time, "BAD_MESSAGE", "That seat is occupied.");
  }

  const next = empty
    ? [...new Set([...party.emptySeats, seatId])]
    : party.emptySeats.filter((item) => item !== seatId);

  if (seats.length - next.length < 2) {
    return failure(room, time, "BAD_MESSAGE", "At least two seats are required.");
  }

  party.emptySeats = next;
  party.updatedAt = time;
  room.touchedAt = time;

  return {
    snapshot: partySnapshot(room, time),
    kind: "lobby",
  };
}

export function startParty(
  room: VersusRoom,
  credentials: VersusCredentials,
  time: number,
): PartyMutation {
  const party = ensurePartyState(room, time);
  prunePresence(party, time);

  if (room.closed) {
    return failure(room, time, "NOT_READY", "The room is closed.");
  }

  if (party.game) {
    return failure(room, time, "NOT_READY", "The match already started.");
  }

  if (credentials.id !== "host") {
    return failure(room, time, "BAD_MESSAGE", "Only the host can start.");
  }

  const humans = connectedHumans(party, time);

  if (!humans.some((player) => player.id === "host")) {
    return failure(room, time, "NOT_READY", "The host is not connected.");
  }

  const roster = buildRoster(party.mode, humans, party.emptySeats);

  let game: GameState;

  try {
    game = createGame(buildConfigs(roster, party.mode));
  } catch {
    return failure(room, time, "BAD_MESSAGE", "The match could not start.");
  }

  party.game = game;
  party.roster = roster;
  party.version = 0;
  party.events = [];
  party.disconnected = [];
  party.botDueAt = automationDue(party, time);
  party.updatedAt = time;
  room.started = true;
  room.touchedAt = time;

  return {
    snapshot: partySnapshot(room, time),
    kind: "start",
  };
}

export function actParty(
  room: VersusRoom,
  credentials: VersusCredentials,
  action: ClientAction,
  expectedVersion: number,
  time: number,
  drawDice?: () => [DieValue, DieValue],
): PartyMutation {
  const party = ensurePartyState(room, time);
  prunePresence(party, time);

  if (room.closed) {
    return failure(room, time, "NOT_READY", "The room is closed.");
  }

  if (!party.game) {
    return failure(room, time, "NOT_READY", "The match has not started yet.");
  }

  const result = applyAction(
    {
      state: party.game,
      version: party.version,
      actorId: credentials.id,
      action,
      expectedVersion,
    },
    drawDice,
  );

  if (!result.ok) {
    return failure(room, time, result.code, result.message);
  }

  party.game = result.state;
  party.version = result.version;
  party.events = [...result.events];
  party.botDueAt = automationDue(party, time);
  party.updatedAt = time;
  room.touchedAt = time;

  return {
    snapshot: partySnapshot(room, time),
    kind: "state",
  };
}

function botAction(
  state: GameState,
  playerId: string,
): ClientAction | null {
  switch (state.phase) {
    case "awaiting-roll":
      return { type: "ROLL" };
    case "awaiting-move": {
      const move = chooseMove(state, playerId);
      return move ? { type: "MOVE", move } : null;
    }
    case "awaiting-bonus": {
      const move = chooseBonusMove(state, playerId);
      return move ? { type: "BONUS_MOVE", move } : null;
    }
    case "awaiting-barrier": {
      const progress = chooseBarrier(state, playerId);
      return progress !== null ? { type: "CHOOSE_BARRIER", progress } : null;
    }
    default:
      return null;
  }
}

/**
 * Plays one step for a bot or a disconnected human. `botDueAt` prevents two
 * serverless instances from playing the same step twice.
 */
export function advanceParty(
  room: VersusRoom,
  time: number,
  drawDice?: () => [DieValue, DieValue],
): PartyMutation {
  const party = ensurePartyState(room, time);
  prunePresence(party, time);

  if (!party.game || party.game.phase === "finished" || room.closed) {
    return {
      snapshot: partySnapshot(room, time),
      kind: "none",
    };
  }

  const current = party.game.players[party.game.currentPlayerIndex];

  if (!current || !isAutomated(party, current.id)) {
    party.botDueAt = null;
    return {
      snapshot: partySnapshot(room, time),
      kind: "none",
    };
  }

  if (party.botDueAt === null) {
    party.botDueAt = time + BOT_DELAY_MS;
    party.updatedAt = time;
    return {
      snapshot: partySnapshot(room, time),
      kind: "none",
    };
  }

  if (time < party.botDueAt) {
    return {
      snapshot: partySnapshot(room, time),
      kind: "none",
    };
  }

  const action = botAction(party.game, current.id);

  if (!action) {
    party.botDueAt = null;
    party.updatedAt = time;
    return {
      snapshot: partySnapshot(room, time),
      kind: "none",
    };
  }

  const result = applyAction(
    {
      state: party.game,
      version: party.version,
      actorId: current.id,
      action,
    },
    drawDice,
  );

  if (!result.ok) {
    // The policy should always produce a legal action; stop scheduling
    // instead of spinning on the same broken state.
    party.botDueAt = null;
    party.updatedAt = time;
    return {
      snapshot: partySnapshot(room, time),
      kind: "none",
    };
  }

  party.game = result.state;
  party.version = result.version;
  party.events = [...result.events];
  party.botDueAt = automationDue(party, time);
  party.updatedAt = time;
  room.touchedAt = time;

  return {
    snapshot: partySnapshot(room, time),
    kind: "state",
  };
}

/**
 * Intentional leave (the client sent LEAVE). Before the start it frees the
 * room seat; mid-match a guest keeps the roster seat but is played by the
 * server, and the host closes the room for everyone.
 */
export function leaveParty(
  room: VersusRoom,
  credentials: VersusCredentials,
  time: number,
): PartyMutation {
  const party = ensurePartyState(room, time);
  const wasStarted = party.game !== null;

  delete party.presence[credentials.id];

  if (
    party.game &&
    party.roster?.players.some(
      (player) => player.id === credentials.id && !isBotId(player.id),
    )
  ) {
    party.disconnected = [...new Set([...party.disconnected, credentials.id])];
    party.botDueAt = automationDue(party, time);
  }

  leaveRoomState(room, credentials, time);
  delete party.profiles[credentials.id];
  party.updatedAt = time;
  room.touchedAt = time;

  return {
    snapshot: partySnapshot(room, time),
    kind: room.closed ? "bye" : wasStarted ? "none" : "lobby",
    closeRoom: room.closed,
  };
}

/** The default dice source for the server. */
export function serverDice(): () => [DieValue, DieValue] {
  return cryptoDice();
}
