/**
 * Redis-backed versus room store.
 *
 * Vercel runs route handlers in serverless instances, so the in-memory store
 * cannot see a room created by another instance: the host's `create` and a
 * guest's `join` may land in different processes. Every room is stored as one
 * JSON value per code in Redis, and each mutation runs under a short
 * per-room lock so seat allocation and the signal log stay consistent.
 *
 * Only SDP descriptions and presence live here; game state never does, and
 * payloads are never logged. Rooms expire through Redis TTLs using the same
 * windows as the in-memory store.
 *
 * Connection settings are intentionally inline: the project owner provided a
 * dedicated free Redis Labs instance and asked for the credentials to be
 * committed. Move them to environment variables before sharing the repository.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "redis";
import {
  createRoomState,
  deserializeRoom,
  isRoomExpired,
  joinRoomState,
  leaveRoomState,
  markRoomStartedState,
  normalizeRoomCode,
  pollRoomState,
  pruneRoomSignals,
  randomRoomCode,
  randomToken,
  roomTtlSeconds,
  sendRoomSignal,
  serializeRoom,
  type VersusCapacity,
  type VersusCredentials,
  type VersusPeer,
  type VersusPoll,
  type VersusResult,
  type VersusRoom,
  type VersusSignalKind,
} from "./rooms";

const REDIS_HOST = "redis-13932.c245.us-east-1-3.ec2.cloud.redislabs.com";
const REDIS_PORT = 13932;
const REDIS_USERNAME = "default";
const REDIS_PASSWORD = "ZCpCfGexhVHjc1wt4BfP92XzLLUHPaHS";

const ROOM_KEY_PREFIX = "parchis:versus:room:";
const LOCK_KEY_PREFIX = "parchis:versus:lock:";

/** A room mutation never takes longer than this; the lock auto-releases. */
const LOCK_TTL_SECONDS = 5;
const LOCK_RETRY_MS = 25;
const DEFAULT_LOCK_WAIT_MS = 1_000;

export interface VersusRedisSetOptions {
  readonly NX?: true;
  readonly EX?: number;
}

/** The slice of a Redis client this store needs; tests inject a fake. */
export interface VersusRedisLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: VersusRedisSetOptions,
  ): Promise<string | null>;
  del(key: string): Promise<number>;
}

export interface RedisVersusServerOptions {
  readonly now?: () => number;
  /** Injected in tests so room codes are deterministic. */
  readonly newRoomCode?: () => string;
  /** Injected in tests so credentials are deterministic. */
  readonly newToken?: () => string;
  readonly lockWaitMs?: number;
}

/** The asynchronous equivalent of `VersusServer`, used by the route handler. */
export interface AsyncVersusServer {
  create(capacity?: VersusCapacity): Promise<VersusResult<VersusCredentials>>;
  join(code: string): Promise<VersusResult<VersusCredentials>>;
  send(
    credentials: VersusPeer & { code: string },
    kind: VersusSignalKind,
    payload: string,
    to?: string | null,
  ): Promise<VersusResult<{ seq: number }>>;
  poll(
    credentials: VersusPeer & { code: string },
    since: number,
  ): Promise<VersusResult<VersusPoll>>;
  leave(
    credentials: VersusPeer & { code: string },
  ): Promise<VersusResult<null>>;
  markStarted(
    credentials: VersusPeer & { code: string },
  ): Promise<VersusResult<null>>;
}

interface RoomActionOutcome<T> {
  readonly result: VersusResult<T>;
  /** Whether the mutation must be written back to Redis. */
  readonly persist: boolean;
}

function unavailable<T>(): VersusResult<T> {
  return { ok: false, error: "STORE_UNAVAILABLE" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a room store over an injected Redis client. The production
 * singleton is `getVersusServer()`.
 */
export function createRedisVersusServer(
  client: VersusRedisLike,
  options: RedisVersusServerOptions = {},
): AsyncVersusServer {
  const now = options.now ?? (() => Date.now());
  const newRoomCode = options.newRoomCode ?? randomRoomCode;
  const newToken = options.newToken ?? randomToken;
  const lockWaitMs = options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;

  const roomKey = (code: string) => `${ROOM_KEY_PREFIX}${code}`;
  const lockKey = (code: string) => `${LOCK_KEY_PREFIX}${code}`;

  const releaseLock = async (key: string, token: string): Promise<void> => {
    try {
      const current = await client.get(key);
      if (current === token) {
        await client.del(key);
      }
    } catch {
      // The lock expires on its own.
    }
  };

  /**
   * Loads, mutates and saves one room under its lock. Any Redis failure is
   * reported as `STORE_UNAVAILABLE`, which the route maps to a 503.
   */
  const withRoom = async <T>(
    rawCode: string,
    action: (room: VersusRoom, time: number) => RoomActionOutcome<T>,
  ): Promise<VersusResult<T>> => {
    const code = normalizeRoomCode(rawCode);
    const key = lockKey(code);
    const lockToken = randomBytes(12).toString("hex");
    const deadline = Date.now() + lockWaitMs;
    let acquired = false;

    while (!acquired && Date.now() <= deadline) {
      try {
        acquired =
          (await client.set(key, lockToken, {
            NX: true,
            EX: LOCK_TTL_SECONDS,
          })) === "OK";
      } catch {
        return unavailable();
      }

      if (!acquired) {
        await sleep(LOCK_RETRY_MS);
      }
    }

    if (!acquired) {
      return unavailable();
    }

    try {
      let raw: string | null;

      try {
        raw = await client.get(roomKey(code));
      } catch {
        return unavailable();
      }

      if (!raw) {
        return { ok: false, error: "ROOM_NOT_FOUND" };
      }

      const time = now();
      const room = deserializeRoom(raw);

      // Redis should already have dropped the key at the same deadline; this
      // also covers clock skew and snapshots written before a rule change.
      if (!room || isRoomExpired(room, time)) {
        try {
          await client.del(roomKey(code));
        } catch {
          // Best effort: the key expires on its own.
        }
        return { ok: false, error: "ROOM_NOT_FOUND" };
      }

      const before = room.signals.length;
      pruneRoomSignals(room, time);
      const pruned = room.signals.length !== before;

      let outcome: RoomActionOutcome<T>;

      try {
        outcome = action(room, time);
      } catch {
        return unavailable();
      }

      const { result, persist } = outcome;

      if (persist || pruned) {
        try {
          await client.set(roomKey(code), serializeRoom(room), {
            EX: roomTtlSeconds(room, time),
          });
        } catch {
          return unavailable();
        }
      }

      return result;
    } finally {
      await releaseLock(key, lockToken);
    }
  };

  const create = async (
    capacity: VersusCapacity = 2,
  ): Promise<VersusResult<VersusCredentials>> => {
    const time = now();

    // SET NX makes code allocation atomic across instances.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = normalizeRoomCode(newRoomCode());
      const { room, credentials } = createRoomState({
        code,
        capacity,
        hostToken: newToken(),
        time,
      });

      try {
        const stored = await client.set(roomKey(code), serializeRoom(room), {
          NX: true,
          EX: roomTtlSeconds(room, time),
        });

        if (stored === "OK") {
          return { ok: true, value: credentials };
        }
      } catch {
        return unavailable();
      }
    }

    return { ok: false, error: "ROOM_FULL" };
  };

  const join = (rawCode: string): Promise<VersusResult<VersusCredentials>> =>
    withRoom(rawCode, (room, time) => {
      const result = joinRoomState(room, time, newToken());
      return { result, persist: result.ok };
    });

  const send = (
    credentials: VersusPeer & { code: string },
    kind: VersusSignalKind,
    payload: string,
    to: string | null = null,
  ): Promise<VersusResult<{ seq: number }>> =>
    withRoom(credentials.code, (room, time) => {
      const result = sendRoomSignal(room, credentials, kind, payload, to, time);
      return { result, persist: result.ok };
    });

  const poll = (
    credentials: VersusPeer & { code: string },
    since: number,
  ): Promise<VersusResult<VersusPoll>> =>
    withRoom(credentials.code, (room, time) => {
      const result = pollRoomState(room, credentials, since, time);
      return { result, persist: result.ok };
    });

  const leave = (
    credentials: VersusPeer & { code: string },
  ): Promise<VersusResult<null>> =>
    withRoom(credentials.code, (room, time) => {
      const result = leaveRoomState(room, credentials, time);
      return { result, persist: result.ok };
    });

  const markStarted = (
    credentials: VersusPeer & { code: string },
  ): Promise<VersusResult<null>> =>
    withRoom(credentials.code, (room, time) => {
      const result = markRoomStartedState(room, credentials, time);
      return { result, persist: result.ok };
    });

  return { create, join, send, poll, leave, markStarted };
}

type RedisClient = Awaited<ReturnType<typeof connectRedis>>;

interface RedisGlobal {
  __versusRedisClient?: Promise<RedisClient>;
}

function connectRedis() {
  const client = createClient({
    username: REDIS_USERNAME,
    password: REDIS_PASSWORD,
    socket: {
      host: REDIS_HOST,
      port: REDIS_PORT,
    },
  });

  // node-redis emits `error` for transient failures and reconnects on its
  // own. Without a listener the process would crash; callers still see a
  // failure when a command cannot complete.
  client.on("error", () => {});

  return client.connect().then(() => client);
}

/** One client per process, shared by every bundle. */
export function getRedisClient(): Promise<RedisClient> {
  const scope = globalThis as unknown as RedisGlobal;

  if (!scope.__versusRedisClient) {
    const connecting = connectRedis();
    scope.__versusRedisClient = connecting;

    void connecting.catch(() => {
      if (scope.__versusRedisClient === connecting) {
        scope.__versusRedisClient = undefined;
      }
    });
  }

  return scope.__versusRedisClient;
}

interface ServerGlobal {
  __versusServer?: Promise<AsyncVersusServer>;
}

/** The shared store used by the route handler. */
export function getVersusServer(): Promise<AsyncVersusServer> {
  const scope = globalThis as unknown as ServerGlobal;

  if (!scope.__versusServer) {
    const connecting = getRedisClient().then((client) =>
      createRedisVersusServer(client),
    );
    scope.__versusServer = connecting;

    void connecting.catch(() => {
      if (scope.__versusServer === connecting) {
        scope.__versusServer = undefined;
      }
    });
  }

  return scope.__versusServer;
}
