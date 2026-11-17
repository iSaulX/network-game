import { describe, expect, test } from "bun:test";
import {
  capacityForMode,
  createVersusRoom,
  joinVersusRoom,
  VersusSignalingClient,
} from "./signaling-client";
import { createVersusServer, type VersusServer } from "@/lib/server/versus/rooms";

/**
 * A fetch that talks to an in-memory store using the same HTTP contract as
 * `app/api/versus/route.ts` (POST actions, GET poll with a Bearer token).
 */
function serverFetch(server: VersusServer): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      "http://localhost",
    );
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const token = (headers.get("Authorization") ?? "").replace("Bearer ", "");

    if (method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const credentials = { ...body, token: body.token ?? token };

      switch (body.action) {
        case "create": {
          const created = server.create(body.capacity);
          if (created.ok) {
            return Response.json({ ok: true, ...created.value });
          }
          return Response.json({ ok: false, error: created.error }, { status: 409 });
        }
        case "join": {
          const joined = server.join(body.code);
          if (joined.ok) {
            return Response.json({ ok: true, ...joined.value });
          }
          const status = joined.error === "ROOM_NOT_FOUND" ? 404 : 409;
          return Response.json({ ok: false, error: joined.error }, { status });
        }
        case "signal": {
          const sent = server.send(
            credentials,
            body.kind,
            body.payload,
            body.to ?? null,
          );
          if (sent.ok) {
            return Response.json({ ok: true, ...sent.value });
          }
          const status =
            sent.error === "UNAUTHORIZED"
              ? 401
              : sent.error === "BAD_SIGNAL"
                ? 400
                : 409;
          return Response.json({ ok: false, error: sent.error }, { status });
        }
        case "start": {
          const started = server.markStarted(credentials);
          if (started.ok) {
            return Response.json({ ok: true });
          }
          const status = started.error === "UNAUTHORIZED" ? 401 : 409;
          return Response.json({ ok: false, error: started.error }, { status });
        }
        case "leave": {
          server.leave(credentials);
          return Response.json({ ok: true });
        }
      }
    }

    const polled = server.poll(
      {
        code: url.searchParams.get("code") ?? "",
        id: url.searchParams.get("id") ?? "",
        token,
      },
      Number(url.searchParams.get("since") ?? "0"),
    );

    if (!polled.ok) {
      return Response.json({ ok: false, error: polled.error }, { status: 404 });
    }

    return Response.json({ ok: true, ...polled.value });
  }) as typeof fetch;
}

function fixedServer() {
  let counter = 0;
  return createVersusServer({
    newRoomCode: () => {
      counter += 1;
      return `ROOM${String(counter).padStart(2, "0")}`;
    },
  });
}

describe("versus signaling client", () => {
  test("creates and joins a room through the HTTP contract", async () => {
    const fetcher = serverFetch(fixedServer());

    const created = await createVersusRoom(2, { fetcher });
    expect(created.ok).toBeTrue();
    if (!created.ok) return;
    expect(created.value.role).toBe("host");
    expect(created.value.id).toBe("host");

    const joined = await joinVersusRoom(created.value.code, { fetcher });
    expect(joined.ok).toBeTrue();
    if (!joined.ok) return;
    expect(joined.value.role).toBe("guest");
    expect(joined.value.id).toBe("guest-1");
    expect(joined.value.code).toBe(created.value.code);
    expect(joined.value.token).not.toBe(created.value.token);
  });

  test("seats the extra guests of a four-player room in order", async () => {
    const fetcher = serverFetch(fixedServer());
    const created = await createVersusRoom(4, { fetcher });
    if (!created.ok) throw new Error("room");

    const seats: string[] = [];

    for (let index = 0; index < 3; index += 1) {
      const joined = await joinVersusRoom(created.value.code, { fetcher });
      if (!joined.ok) throw new Error("seat");
      seats.push(joined.value.id);
    }

    expect(seats).toEqual(["guest-1", "guest-2", "guest-3"]);
    expect(await joinVersusRoom(created.value.code, { fetcher })).toEqual({
      ok: false,
      failure: "room-full",
    });
  });

  test("maps a mode to the room capacity it needs", () => {
    expect(capacityForMode("1v1")).toBe(2);
    expect(capacityForMode("all")).toBe(4);
  });

  test("reports a full room and an unknown code", async () => {
    const fetcher = serverFetch(fixedServer());
    const created = await createVersusRoom(2, { fetcher });
    if (!created.ok) throw new Error("room");

    await joinVersusRoom(created.value.code, { fetcher });

    expect(await joinVersusRoom(created.value.code, { fetcher })).toEqual({
      ok: false,
      failure: "room-full",
    });

    expect(await joinVersusRoom("ZZZZZZ", { fetcher })).toEqual({
      ok: false,
      failure: "room-not-found",
    });
  });

  test("relays targeted offers and answers between two clients", async () => {
    const fetcher = serverFetch(fixedServer());
    const created = await createVersusRoom(2, { fetcher });
    if (!created.ok) throw new Error("room");

    const joined = await joinVersusRoom(created.value.code, { fetcher });
    if (!joined.ok) throw new Error("room");

    const hostClient = new VersusSignalingClient(created.value, { fetcher });
    const guestClient = new VersusSignalingClient(joined.value, { fetcher });

    // The host learns that a seat is now taken, and addressed it explicitly.
    const presence = await hostClient.poll();
    if (!presence.ok) throw new Error("poll");
    expect(presence.value.signals.map((signal) => signal.kind)).toEqual([
      "joined",
    ]);
    expect(presence.value.present).toEqual({
      host: true,
      guests: ["guest-1"],
    });

    expect(
      await hostClient.send("offer", "OFFER", joined.value.id),
    ).toEqual({ ok: true, value: null });

    const guestPoll = await guestClient.poll();
    if (!guestPoll.ok) throw new Error("poll");
    expect(guestPoll.value.signals[0]?.payload).toBe("OFFER");
    expect(guestPoll.value.capacity).toBe(2);

    await guestClient.send("answer", "ANSWER", "host");
    const hostPoll = await hostClient.poll();
    if (!hostPoll.ok) throw new Error("poll");
    expect(hostPoll.value.signals[0]?.payload).toBe("ANSWER");

    // A signal addressed to the host never reaches the guest.
    await hostClient.send("offer", "OTHER", "host");
    const unrelated = await guestClient.poll();
    if (!unrelated.ok) throw new Error("poll");
    expect(unrelated.value.signals).toHaveLength(0);

    // The guest's own `joined` marker is never delivered back to it.
    const repeat = await guestClient.poll();
    if (!repeat.ok) throw new Error("poll");
    expect(repeat.value.signals).toHaveLength(0);
  });

  test("a started match refuses new guests with a distinct failure", async () => {
    const fetcher = serverFetch(fixedServer());
    const created = await createVersusRoom(2, { fetcher });
    if (!created.ok) throw new Error("room");

    const joined = await joinVersusRoom(created.value.code, { fetcher });
    if (!joined.ok) throw new Error("room");

    const hostClient = new VersusSignalingClient(created.value, { fetcher });
    await hostClient.markStarted();

    expect(await joinVersusRoom(created.value.code, { fetcher })).toEqual({
      ok: false,
      failure: "room-started",
    });
  });

  test("an offer to a seat that already left reports peer-gone", async () => {
    const fetcher = serverFetch(fixedServer());
    const created = await createVersusRoom(2, { fetcher });
    if (!created.ok) throw new Error("room");

    const joined = await joinVersusRoom(created.value.code, { fetcher });
    if (!joined.ok) throw new Error("room");

    const hostClient = new VersusSignalingClient(created.value, { fetcher });
    const guestClient = new VersusSignalingClient(joined.value, { fetcher });

    await guestClient.leave();

    expect(
      await hostClient.send("offer", "SDP", joined.value.id),
    ).toEqual({ ok: false, failure: "peer-gone" });
  });

  test("a network failure is reported, not thrown", async () => {
    const fetcher = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    expect(await createVersusRoom(2, { fetcher })).toEqual({
      ok: false,
      failure: "network",
    });
  });

  test("rejects malformed server responses", async () => {
    const fetcher = (async () =>
      Response.json({
        ok: true,
        code: 12,
        token: null,
        id: "nope",
        role: "host",
      })) as unknown as typeof fetch;

    expect(await createVersusRoom(2, { fetcher })).toEqual({
      ok: false,
      failure: "server-error",
    });
  });
});
