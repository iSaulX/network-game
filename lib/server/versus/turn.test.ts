import { describe, expect, test } from "bun:test";
import {
  CLOUDFLARE_TURN_ENDPOINT,
  generateIceServers,
  parseIceServersPayload,
  STUN_ONLY_ICE_SERVERS,
} from "./turn";

const ENV = { tokenId: "turn-key", apiToken: "api-token" };

const CLOUDFLARE_PAYLOAD = {
  iceServers: [
    {
      urls: [
        "stun:stun.cloudflare.com:3478",
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:3478?transport=tcp",
        "turns:turn.cloudflare.com:5349?transport=tcp",
      ],
      username: "user-1",
      credential: "cred-1",
    },
  ],
};

function fakeFetcher(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as unknown as typeof fetch;
}

describe("cloudflare turn credentials", () => {
  test("mints short-lived ICE servers with the API token kept server-side", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;

    const result = await generateIceServers({
      env: ENV,
      ttlSeconds: 3600,
      fetcher: fakeFetcher((url, init) => {
        seenUrl = url;
        seenInit = init;
        return Response.json(CLOUDFLARE_PAYLOAD);
      }),
    });

    expect(result.source).toBe("turn");
    expect(result.iceServers).toEqual(CLOUDFLARE_PAYLOAD.iceServers);
    expect(seenUrl).toBe(
      `${CLOUDFLARE_TURN_ENDPOINT}/turn-key/credentials/generate-ice-servers`,
    );
    expect(new Headers(seenInit?.headers).get("Authorization")).toBe(
      "Bearer api-token",
    );
    expect(JSON.parse(String(seenInit?.body))).toEqual({ ttl: 3600 });
  });

  test("clamps the TTL to Cloudflare's accepted range", async () => {
    let body: unknown;

    await generateIceServers({
      env: ENV,
      ttlSeconds: 999_999,
      fetcher: fakeFetcher((_url, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json(CLOUDFLARE_PAYLOAD);
      }),
    });

    expect(body).toEqual({ ttl: 86_400 });
  });

  test("falls back to STUN when TURN is not configured", async () => {
    const result = await generateIceServers({
      env: {},
      fetcher: fakeFetcher(() => {
        throw new Error("must not be called");
      }),
    });

    expect(result.source).toBe("stun");
    expect(result.iceServers).toEqual(STUN_ONLY_ICE_SERVERS);
  });

  test("falls back to STUN when Cloudflare rejects the request", async () => {
    const result = await generateIceServers({
      env: ENV,
      fetcher: fakeFetcher(() => new Response("nope", { status: 401 })),
    });

    expect(result.source).toBe("stun");
    expect(result.iceServers).toEqual(STUN_ONLY_ICE_SERVERS);
  });

  test("falls back to STUN on a network error", async () => {
    const result = await generateIceServers({
      env: ENV,
      fetcher: fakeFetcher(() => {
        throw new Error("offline");
      }),
    });

    expect(result.source).toBe("stun");
    expect(result.iceServers).toEqual(STUN_ONLY_ICE_SERVERS);
  });

  test("accepts Cloudflare's STUN-only entry next to the TURN entry", () => {
    const parsed = parseIceServersPayload({
      iceServers: [
        {
          urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:443"],
        },
        {
          urls: [
            "turn:turn.cloudflare.com:3478?transport=udp",
            "turns:turn.cloudflare.com:5349?transport=tcp",
          ],
          username: "user-1",
          credential: "cred-1",
        },
      ],
    });

    expect(parsed).toHaveLength(2);
    expect(parsed?.[0]).toEqual({
      urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:443"],
    });
    expect(parsed?.[1]).toMatchObject({ username: "user-1" });
  });

  test("rejects a TURN URL without credentials", () => {
    expect(
      parseIceServersPayload({
        iceServers: [{ urls: ["turn:turn.cloudflare.com:3478"] }],
      }),
    ).toBeNull();
  });

  test("rejects malformed or non-ICE payloads", () => {
    expect(parseIceServersPayload(null)).toBeNull();
    expect(parseIceServersPayload({ iceServers: [] })).toBeNull();
    expect(parseIceServersPayload({ iceServers: [{}] })).toBeNull();
    expect(
      parseIceServersPayload({
        iceServers: [
          {
            urls: ["https://evil.example/x"],
            username: "u",
            credential: "c",
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseIceServersPayload({
        iceServers: [
          {
            urls: ["turn:turn.cloudflare.com:3478"],
            username: "",
            credential: "c",
          },
        ],
      }),
    ).toBeNull();
  });
});
