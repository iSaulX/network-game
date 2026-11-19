import { describe, expect, test } from "bun:test";
import {
  createRedisVersusServer,
  type VersusRedisLike,
  type VersusRedisSetOptions,
} from "./redis-store";

const ROOM_KEY = "parchis:versus:room:ABC234";

/** Minimal Redis stand-in; TTLs are exercised through the injected clock. */
class FakeRedis implements VersusRedisLike {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    options?: VersusRedisSetOptions,
  ): Promise<string | null> {
    if (options?.NX && this.values.has(key)) {
      return null;
    }

    this.values.set(key, value);
    return "OK";
  }

  async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }
}

function createStore(
  client: VersusRedisLike,
  options: { now?: () => number } = {},
) {
  let tokenIndex = 0;

  return createRedisVersusServer(client, {
    newRoomCode: () => "ABC234",
    newToken: () => `token-${(tokenIndex += 1)}`.padEnd(64, "0"),
    ...options,
  });
}

describe("redis versus store", () => {
  test("a room created by one instance is visible to another", async () => {
    const redis = new FakeRedis();
    const hostStore = createStore(redis);
    const guestStore = createStore(redis);

    const host = await hostStore.create(2);
    if (!host.ok) throw new Error("room");

    const guest = await guestStore.join(host.value.code);
    if (!guest.ok) throw new Error("join");

    expect(guest.value).toMatchObject({ id: "guest-1", code: "ABC234" });

    const hostPoll = await hostStore.poll(host.value, 0);
    if (!hostPoll.ok) throw new Error("host poll");

    expect(
      hostPoll.value.signals.map((signal) => [signal.kind, signal.from]),
    ).toEqual([["joined", "guest-1"]]);
    expect(hostPoll.value.present).toEqual({
      host: true,
      guests: ["guest-1"],
    });
  });

  test("signals travel between instances", async () => {
    const redis = new FakeRedis();
    const hostStore = createStore(redis);
    const guestStore = createStore(redis);

    const host = await hostStore.create(2);
    const guest = await guestStore.join("ABC234");
    if (!host.ok || !guest.ok) throw new Error("room");

    const sent = await hostStore.send(
      host.value,
      "offer",
      "OFFER-SDP",
      guest.value.id,
    );
    expect(sent.ok).toBeTrue();

    const guestPoll = await guestStore.poll(guest.value, 0);
    if (!guestPoll.ok) throw new Error("guest poll");

    expect(guestPoll.value.signals.map((signal) => signal.payload)).toEqual([
      "OFFER-SDP",
    ]);
  });

  test("expires a guest-less room on the injected clock", async () => {
    let now = 0;
    const redis = new FakeRedis();
    const store = createStore(redis, { now: () => now });

    const host = await store.create();
    if (!host.ok) throw new Error("room");

    now += 11 * 60_000;

    expect(await store.poll(host.value, 0)).toEqual({
      ok: false,
      error: "ROOM_NOT_FOUND",
    });
    expect(redis.values.has(ROOM_KEY)).toBeFalse();
  });

  test("treats a corrupt room value as missing", async () => {
    const redis = new FakeRedis();
    redis.values.set(ROOM_KEY, "{not-json");

    const store = createStore(redis);

    expect(await store.join("ABC234")).toEqual({
      ok: false,
      error: "ROOM_NOT_FOUND",
    });
    expect(redis.values.has(ROOM_KEY)).toBeFalse();
  });

  test("reports STORE_UNAVAILABLE when Redis fails", async () => {
    const readFailure: VersusRedisLike = {
      get: async () => {
        throw new Error("down");
      },
      set: async () => "OK",
      del: async () => 0,
    };

    const writeFailure: VersusRedisLike = {
      get: async () => null,
      set: async () => {
        throw new Error("down");
      },
      del: async () => 0,
    };

    expect(await createStore(readFailure).join("ABC234")).toEqual({
      ok: false,
      error: "STORE_UNAVAILABLE",
    });

    expect(await createStore(writeFailure).create()).toEqual({
      ok: false,
      error: "STORE_UNAVAILABLE",
    });
  });
});
