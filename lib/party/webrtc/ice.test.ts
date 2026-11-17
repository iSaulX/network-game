import { describe, expect, test } from "bun:test";
import {
  fetchIceServers,
  ICE_ENDPOINT,
  parseIceServers,
  resetIceServersCache,
} from "./ice";
import { OFFLINE_ICE_SERVERS, ONLINE_ICE_SERVERS } from "./signaling";

const PAYLOAD = {
  iceServers: [
    {
      urls: [
        "stun:stun.cloudflare.com:3478",
        "turn:turn.cloudflare.com:3478?transport=udp",
      ],
      username: "user-1",
      credential: "cred-1",
    },
  ],
};

function fakeFetcher(
  handler: (url: string) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: RequestInfo | URL) =>
    handler(String(input))) as unknown as typeof fetch;
}

describe("browser ICE server discovery", () => {
  test("parses a minted credential list", () => {
    expect(parseIceServers(PAYLOAD)).toEqual(PAYLOAD.iceServers);
    expect(parseIceServers({ iceServers: [{ urls: ["stun:x:3478"] }] })).toEqual(
      [{ urls: ["stun:x:3478"] }],
    );
  });

  test("rejects foreign URLs and malformed credentials", () => {
    expect(parseIceServers(null)).toBeNull();
    expect(parseIceServers({ iceServers: [] })).toBeNull();
    expect(
      parseIceServers({ iceServers: [{ urls: ["https://evil.example"] }] }),
    ).toBeNull();
    expect(
      parseIceServers({
        iceServers: [{ urls: ["turn:x"], username: "u", credential: 3 }],
      }),
    ).toBeNull();
    expect(parseIceServers({ iceServers: [{ urls: ["turn:x"] }] })).toBeNull();
  });

  test("requests the app's own endpoint", async () => {
    let seenUrl = "";
    const servers = await fetchIceServers({
      fetcher: fakeFetcher((url) => {
        seenUrl = url;
        return Response.json(PAYLOAD);
      }),
    });

    expect(seenUrl).toBe(ICE_ENDPOINT);
    expect(servers).toEqual(PAYLOAD.iceServers);
  });

  test("falls back to STUN when the endpoint is missing or fails", async () => {
    resetIceServersCache();

    expect(
      await fetchIceServers({
        fetcher: fakeFetcher(() => new Response("", { status: 404 })),
      }),
    ).toEqual([...ONLINE_ICE_SERVERS]);

    expect(
      await fetchIceServers({
        fetcher: fakeFetcher(() => {
          throw new Error("offline");
        }),
      }),
    ).toEqual([...ONLINE_ICE_SERVERS]);

    expect(
      await fetchIceServers({
        fetcher: fakeFetcher(() => Response.json({ nope: true })),
      }),
    ).toEqual([...ONLINE_ICE_SERVERS]);
  });

  test("uses no ICE servers when the device is offline", async () => {
    expect(await fetchIceServers({ online: false })).toEqual([
      ...OFFLINE_ICE_SERVERS,
    ]);
  });

  test("a STUN fallback is not cached for the whole session", async () => {
    resetIceServersCache();

    const original = globalThis.fetch;
    let calls = 0;

    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1
        ? new Response("", { status: 500 })
        : Response.json(PAYLOAD);
    }) as unknown as typeof fetch;

    try {
      expect(await fetchIceServers({ online: true })).toEqual([
        ...ONLINE_ICE_SERVERS,
      ]);
      // The next call retries instead of reusing the failed fallback.
      expect(await fetchIceServers({ online: true })).toEqual(
        PAYLOAD.iceServers,
      );
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = original;
      resetIceServersCache();
    }
  });

  test("TURN credentials are reused and refreshed before they expire", async () => {
    resetIceServersCache();

    const original = globalThis.fetch;
    let calls = 0;
    let now = 0;

    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json(PAYLOAD);
    }) as unknown as typeof fetch;

    try {
      await fetchIceServers({ online: true, now: () => now });
      await fetchIceServers({ online: true, now: () => now });
      expect(calls).toBe(1);

      // The credentials live for an hour; the cache is shorter.
      now += 51 * 60_000;
      await fetchIceServers({ online: true, now: () => now });
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = original;
      resetIceServersCache();
    }
  });
});
