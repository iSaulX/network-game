/**
 * Server-authoritative party socket.
 *
 * A client opens `/api/party/socket`, authenticates with the room credentials
 * it got from `POST /api/versus`, and then sends the same `HELLO`/`ACTION`
 * wire messages the old P2P session used. The server owns the game state in
 * Redis, validates every action and echoes `LOBBY`/`START`/`STATE` snapshots.
 *
 * Vercel Functions pin a socket to one instance and cap its lifetime, so:
 * - every instance subscribes to a per-room Redis pub/sub channel and
 *   delivers to its local sockets;
 * - the client reconnects, re-AUTHs and receives the full snapshot again;
 * - bots and disconnected humans are advanced on any instance that receives
 *   a message, with `botDueAt` in Redis preventing duplicate steps.
 */
import type { RawData, WebSocket } from "ws";
import {
  PARTY_PROTOCOL_VERSION,
  type ClientAction,
  type HostToGuestMessage,
  type LanPlayerInfo,
  type PartyErrorCode,
} from "@/lib/party/protocol";
import {
  authError,
  authOk,
  decodePartyControl,
  type AuthFailureCode,
  type ServerControlMessage,
} from "@/lib/party/websocket/messages";
import { decodeWireMessage, encodeWireMessage } from "@/lib/party/protocol";
import {
  actParty,
  advanceParty,
  connectParty,
  disconnectParty,
  heartbeatParty,
  leaveParty,
  serverDice,
  setSeatEmptyParty,
  startParty,
  type PartyMutation,
  type PartySnapshot,
} from "./party-state";
import {
  normalizeRoomCode,
  type VersusCredentials,
  type VersusResult,
  type VersusStoreError,
} from "./rooms";
import {
  getRedisClient,
  getVersusServer,
  type AsyncVersusServer,
} from "./redis-store";

const CHANNEL_PREFIX = "parchis:versus:events:";

interface PeerContext {
  readonly credentials: VersusCredentials;
  player: LanPlayerInfo;
  readonly local: LocalPeer;
}

interface LocalPeer {
  readonly id: string;
  readonly ws: WebSocket;
}

/** Sockets connected to this serverless instance, by room code. */
const localRooms = new Map<string, Set<LocalPeer>>();
const roomSubscriptions = new Map<string, Promise<void>>();
const botTimers = new Map<string, ReturnType<typeof setTimeout>>();

type RedisClient = Awaited<ReturnType<typeof getRedisClient>>;

let subscriberPromise: Promise<RedisClient> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function channel(code: string): string {
  return `${CHANNEL_PREFIX}${code}`;
}

async function getSubscriber(): Promise<RedisClient> {
  if (subscriberPromise) {
    return subscriberPromise;
  }

  subscriberPromise = (async () => {
    const client = await getRedisClient();
    const subscriber = client.duplicate();
    subscriber.on("error", () => {});
    await subscriber.connect();
    return subscriber;
  })().catch((error) => {
    subscriberPromise = null;
    throw error;
  });

  return subscriberPromise;
}

async function ensureRoomSubscription(code: string): Promise<void> {
  const existing = roomSubscriptions.get(code);

  if (existing) {
    await existing;
    return;
  }

  const pending = (async () => {
    const subscriber = await getSubscriber();

    await subscriber.subscribe(channel(code), (raw) => {
      let payload: unknown;

      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }

      if (!isRecord(payload) || typeof payload.text !== "string") {
        return;
      }

      const to = typeof payload.to === "string" ? payload.to : null;
      const close = payload.close === true;
      const peers = localRooms.get(code);

      if (!peers) {
        return;
      }

      for (const local of [...peers]) {
        if (to !== null && local.id !== to) {
          continue;
        }

        try {
          local.ws.send(payload.text);
        } catch {
          // The socket is closing; its close handler removes it.
        }

        if (close) {
          try {
            local.ws.close(1000, "room-closed");
          } catch {
            // Already closed.
          }
        }
      }

      if (close) {
        localRooms.delete(code);
        clearBotTimer(code);
      }
    });
  })();

  roomSubscriptions.set(code, pending);

  try {
    await pending;
  } catch (error) {
    roomSubscriptions.delete(code);
    throw error;
  }
}

async function publish(
  code: string,
  message: HostToGuestMessage,
  options: { readonly to?: string; readonly close?: boolean } = {},
): Promise<void> {
  try {
    const text = encodeWireMessage(message);
    const client = await getRedisClient();
    await client.publish(
      channel(code),
      JSON.stringify({
        to: options.to ?? null,
        text,
        ...(options.close ? { close: true } : {}),
      }),
    );
  } catch {
    // The state is already in Redis; the next message or reconnect heals.
  }
}

function lobbyMessage(snapshot: PartySnapshot): HostToGuestMessage {
  return {
    type: "LOBBY",
    protocol: PARTY_PROTOCOL_VERSION,
    mode: snapshot.mode,
    players: snapshot.players,
    emptySeats: snapshot.emptySeats,
  };
}

function startMessage(snapshot: PartySnapshot): HostToGuestMessage | null {
  if (!snapshot.roster || !snapshot.state) {
    return null;
  }

  return {
    type: "START",
    protocol: PARTY_PROTOCOL_VERSION,
    version: snapshot.version,
    mode: snapshot.mode,
    roster: snapshot.roster,
    state: snapshot.state,
  };
}

function stateMessage(snapshot: PartySnapshot): HostToGuestMessage | null {
  if (!snapshot.state) {
    return null;
  }

  return {
    type: "STATE",
    protocol: PARTY_PROTOCOL_VERSION,
    version: snapshot.version,
    state: snapshot.state,
    events: snapshot.events,
  };
}

function connectionMessage(snapshot: PartySnapshot): HostToGuestMessage {
  const connections: Record<
    string,
    { readonly transport: "websocket"; readonly candidate: "relay" }
  > = {};

  for (const player of snapshot.players) {
    if (snapshot.disconnected.includes(player.id)) {
      continue;
    }

    connections[player.id] = { transport: "websocket", candidate: "relay" };
  }

  return {
    type: "CONNECTION",
    protocol: PARTY_PROTOCOL_VERSION,
    connections,
  };
}

const byeMessage: HostToGuestMessage = {
  type: "BYE",
  protocol: PARTY_PROTOCOL_VERSION,
  reason: "host-closed",
};

function errorMessage(
  snapshot: PartySnapshot,
  error: { readonly code: PartyErrorCode; readonly message: string },
): HostToGuestMessage {
  return {
    type: "ERROR",
    protocol: PARTY_PROTOCOL_VERSION,
    version: snapshot.version,
    code: error.code,
    message: error.message,
    ...(snapshot.state ? { state: snapshot.state } : {}),
  };
}

function authCodeFor(error: VersusStoreError): AuthFailureCode {
  switch (error) {
    case "ROOM_NOT_FOUND":
      return "room-not-found";
    case "ROOM_CLOSED":
      return "room-closed";
    case "ROOM_FULL":
      return "room-full";
    case "UNAUTHORIZED":
      return "unauthorized";
    default:
      return "server-error";
  }
}

function clearBotTimer(code: string): void {
  const timer = botTimers.get(code);

  if (timer !== undefined) {
    clearTimeout(timer);
    botTimers.delete(code);
  }
}

function scheduleBot(code: string, nextAt: number | null): void {
  clearBotTimer(code);

  // Only an instance with a local socket needs to drive the clock; another
  // instance that holds the room's sockets has its own timer.
  if (nextAt === null || !localRooms.has(code)) {
    return;
  }

  const delay = Math.max(0, nextAt - Date.now());
  const timer = setTimeout(() => {
    botTimers.delete(code);
    void advanceAndPublish(code);
  }, delay);

  botTimers.set(code, timer);
}

/** Plays one automated step (if due) and broadcasts it. */
async function advanceAndPublish(code: string): Promise<void> {
  try {
    const server = await getVersusServer();
    const result = await server.mutatePartyAsServer(
      code,
      (room, time) => {
        const mutation = advanceParty(room, time, serverDice());
        return { value: mutation, persist: true };
      },
    );

    if (!result.ok) {
      return;
    }

    const mutation = result.value;

    if (mutation.kind === "state") {
      const message = stateMessage(mutation.snapshot);

      if (message) {
        await publish(code, message);
      }
    }

    scheduleBot(code, mutation.snapshot.nextBotAt);
  } catch {
    // A transient Redis failure; the next heartbeat retries.
  }
}

async function applyMutation(
  code: string,
  mutation: PartyMutation,
): Promise<void> {
  switch (mutation.kind) {
    case "lobby":
      await publish(code, lobbyMessage(mutation.snapshot));
      return;
    case "start": {
      const message = startMessage(mutation.snapshot);

      if (message) {
        await publish(code, message);
      }

      void advanceAndPublish(code);
      return;
    }
    case "state": {
      const message = stateMessage(mutation.snapshot);

      if (message) {
        await publish(code, message);
      }

      void advanceAndPublish(code);
      return;
    }
    case "bye":
      await publish(code, byeMessage, { close: true });
      return;
    default:
      return;
  }
}

function readText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return data.toString("utf8");
}

/**
 * Attaches one `ws` socket to the party protocol. Used by the Vercel function
 * and by the local Bun WebSocket server.
 */
export function attachPartySocket(ws: WebSocket): void {
  let peer: PeerContext | null = null;
  let leaving = false;

  const send = (message: HostToGuestMessage | ServerControlMessage): void => {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // The close handler owns cleanup.
    }
  };

  const rejectAuth = (code: AuthFailureCode): void => {
    send(authError(code));

    try {
      ws.close(1008, code);
    } catch {
      // Already closed.
    }
  };

  const server = (): Promise<AsyncVersusServer> => getVersusServer();

  async function handleAuth(raw: unknown): Promise<void> {
    const decoded = decodePartyControl(raw);

    if (!decoded.ok || decoded.message.type !== "AUTH") {
      rejectAuth("bad-request");
      return;
    }

    const auth = decoded.message;
    const credentials: VersusCredentials = {
      code: normalizeRoomCode(auth.code),
      id: auth.id,
      token: auth.token,
      role: auth.id === "host" ? "host" : "guest",
    };

    let result: VersusResult<PartyMutation>;

    try {
      const instance = await server();
      result = await instance.mutateParty(credentials, (room, time) => {
        const mutation = connectParty(room, credentials, auth.player, time);
        return { value: mutation, persist: mutation.error === undefined };
      });
    } catch {
      rejectAuth("server-error");
      return;
    }

    if (!result.ok) {
      rejectAuth(authCodeFor(result.error));
      return;
    }

    const mutation = result.value;

    if (mutation.error) {
      rejectAuth("bad-request");
      return;
    }

    if (mutation.snapshot.closed) {
      rejectAuth("room-closed");
      return;
    }

    const code = mutation.snapshot.code;
    const local: LocalPeer = { id: credentials.id, ws };

    try {
      await ensureRoomSubscription(code);
    } catch {
      rejectAuth("server-error");
      return;
    }

    let peers = localRooms.get(code);

    if (!peers) {
      peers = new Set();
      localRooms.set(code, peers);
    }

    peers.add(local);
    peer = { credentials, player: auth.player, local };

    send(authOk());
    send(lobbyMessage(mutation.snapshot));
    send(connectionMessage(mutation.snapshot));

    if (mutation.snapshot.started) {
      const start = startMessage(mutation.snapshot);

      if (start) {
        send(start);
      }

      const state = stateMessage(mutation.snapshot);

      if (state) {
        send(state);
      }
    } else {
      // Tell the other seats that a player arrived.
      await publish(code, lobbyMessage(mutation.snapshot));
    }

    // Every screen keeps the connection map in sync with the current seats.
    await publish(code, connectionMessage(mutation.snapshot));
    scheduleBot(code, mutation.snapshot.nextBotAt);
  }

  async function handleHello(player: LanPlayerInfo): Promise<void> {
    if (!peer) {
      return;
    }

    const credentials = peer.credentials;
    const instance = await server();
    const result = await instance.mutateParty(credentials, (room, time) => {
      const mutation = connectParty(room, credentials, player, time);
      return { value: mutation, persist: mutation.error === undefined };
    });

    if (!result.ok) {
      return;
    }

    peer.player = player;

    if (result.value.error) {
      return;
    }

    if (result.value.kind === "lobby") {
      await publish(
        credentials.code,
        lobbyMessage(result.value.snapshot),
      );
    }
  }

  async function handleAction(
    action: ClientAction,
    version: number,
  ): Promise<void> {
    if (!peer) {
      return;
    }

    const credentials = peer.credentials;
    let result: VersusResult<PartyMutation>;

    try {
      const instance = await server();
      result = await instance.mutateParty(credentials, (room, time) => {
        const mutation = actParty(
          room,
          credentials,
          action,
          version,
          time,
          serverDice(),
        );
        return { value: mutation, persist: true };
      });
    } catch {
      return;
    }

    if (!result.ok) {
      return;
    }

    const mutation = result.value;

    if (mutation.error) {
      send(errorMessage(mutation.snapshot, mutation.error));
      return;
    }

    await applyMutation(credentials.code, mutation);
  }

  async function handleStart(): Promise<void> {
    if (!peer) {
      return;
    }

    const credentials = peer.credentials;
    const instance = await server();
    const result = await instance.mutateParty(credentials, (room, time) => {
      const mutation = startParty(room, credentials, time);
      return { value: mutation, persist: true };
    });

    if (!result.ok) {
      return;
    }

    if (result.value.error) {
      send(errorMessage(result.value.snapshot, result.value.error));
      return;
    }

    await applyMutation(credentials.code, result.value);
  }

  async function handleSeatEmpty(seatId: string, empty: boolean): Promise<void> {
    if (!peer) {
      return;
    }

    const credentials = peer.credentials;
    const instance = await server();
    const result = await instance.mutateParty(credentials, (room, time) => {
      const mutation = setSeatEmptyParty(room, credentials, seatId, empty, time);
      return { value: mutation, persist: true };
    });

    if (!result.ok) {
      return;
    }

    if (result.value.error) {
      send(errorMessage(result.value.snapshot, result.value.error));
      return;
    }

    await applyMutation(credentials.code, result.value);
  }

  async function handlePing(): Promise<void> {
    if (!peer) {
      return;
    }

    const credentials = peer.credentials;
    const instance = await server();
    const result = await instance.mutateParty(credentials, (room, time) => ({
      value: heartbeatParty(room, credentials, time),
      persist: true,
    }));

    if (!result.ok) {
      return;
    }

    if (result.value.kind === "lobby") {
      await publish(
        credentials.code,
        lobbyMessage(result.value.snapshot),
      );
    }

    void advanceAndPublish(credentials.code);
  }

  async function handleLeave(): Promise<void> {
    if (!peer || leaving) {
      return;
    }

    leaving = true;
    const credentials = peer.credentials;
    const instance = await server();
    const result = await instance.mutateParty(credentials, (room, time) => ({
      value: leaveParty(room, credentials, time),
      persist: true,
    }));

    if (result.ok) {
      const mutation = result.value;

      if (mutation.kind === "bye") {
        clearBotTimer(credentials.code);
        await publish(credentials.code, byeMessage, { close: true });
      } else {
        if (mutation.kind === "lobby") {
          await publish(
            credentials.code,
            lobbyMessage(mutation.snapshot),
          );
        }

        await publish(
          credentials.code,
          connectionMessage(mutation.snapshot),
        );
        // A guest leaving mid-match may hand the turn to a bot.
        void advanceAndPublish(credentials.code);
      }
    }

    try {
      ws.close(1000, "left");
    } catch {
      // Already closed.
    }
  }

  async function handleText(text: string): Promise<void> {
    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      if (peer) {
        send({
          type: "ERROR",
          protocol: PARTY_PROTOCOL_VERSION,
          version: 0,
          code: "BAD_MESSAGE",
          message: "Invalid message.",
        });
      } else {
        rejectAuth("bad-request");
      }
      return;
    }

    const control = decodePartyControl(parsed);

    if (control.ok) {
      switch (control.message.type) {
        case "AUTH":
          if (peer) {
            send({
              type: "ERROR",
              protocol: PARTY_PROTOCOL_VERSION,
              version: 0,
              code: "BAD_MESSAGE",
              message: "Already authenticated.",
            });
          } else {
            await handleAuth(control.message);
          }
          return;
        case "START":
          await handleStart();
          return;
        case "SET_SEAT_EMPTY":
          await handleSeatEmpty(control.message.seatId, control.message.empty);
          return;
        case "PING":
          await handlePing();
          return;
        case "LEAVE":
          await handleLeave();
          return;
      }
    }

    if (!peer) {
      rejectAuth("bad-request");
      return;
    }

    const decoded = decodeWireMessage(text);

    if (!decoded.ok) {
      send({
        type: "ERROR",
        protocol: PARTY_PROTOCOL_VERSION,
        version: 0,
        code: decoded.code,
        message: decoded.message,
      });
      return;
    }

    if (decoded.message.type === "HELLO") {
      await handleHello(decoded.message.player);
      return;
    }

    if (decoded.message.type === "ACTION") {
      await handleAction(decoded.message.action, decoded.message.version);
      return;
    }

    send({
      type: "ERROR",
      protocol: PARTY_PROTOCOL_VERSION,
      version: 0,
      code: "BAD_MESSAGE",
      message: "Unexpected message.",
    });
  }

  async function handleClose(): Promise<void> {
    if (!peer) {
      return;
    }

    const current = peer;
    peer = null;
    const peers = localRooms.get(current.credentials.code);

    if (peers) {
      peers.delete(current.local);

      if (peers.size === 0) {
        localRooms.delete(current.credentials.code);
        clearBotTimer(current.credentials.code);
      }
    }

    if (leaving) {
      return;
    }

    try {
      const instance = await server();
      const result = await instance.mutateParty(
        current.credentials,
        (room, time) => ({
          value: disconnectParty(room, current.credentials, time),
          persist: true,
        }),
      );

      if (!result.ok) {
        return;
      }

      if (result.value.kind === "lobby") {
        await publish(
          current.credentials.code,
          lobbyMessage(result.value.snapshot),
        );
      }

      await publish(
        current.credentials.code,
        connectionMessage(result.value.snapshot),
      );
      void advanceAndPublish(current.credentials.code);
    } catch {
      // The room expires on its own.
    }
  }

  ws.on("message", (data) => {
    const text = readText(data);
    void handleText(text).catch(() => {
      try {
        ws.close(1011, "server-error");
      } catch {
        // Already closed.
      }
    });
  });

  ws.on("close", () => {
    void handleClose();
  });

  ws.on("error", () => {
    // The close event owns cleanup.
  });
}
