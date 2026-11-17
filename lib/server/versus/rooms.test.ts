import { describe, expect, test } from "bun:test";
import {
  createVersusServer,
  isVersusCapacity,
  MAX_SIGNALS_PER_ROOM,
  normalizeRoomCode,
} from "./rooms";

function fixedServer(codes: string[] = []) {
  let index = 0;
  return createVersusServer({
    newRoomCode: () => codes[index++] ?? `ROOM${index}`,
  });
}

function credentials(code: string, id: string, token: string) {
  return { code, id, token } as const;
}

describe("versus room store", () => {
  test("creates a room with a host and a six-character code", () => {
    const server = fixedServer(["ABC234"]);
    const created = server.create();

    expect(created.ok).toBeTrue();
    if (!created.ok) return;

    expect(created.value.code).toBe("ABC234");
    expect(created.value.id).toBe("host");
    expect(created.value.role).toBe("host");
    expect(created.value.token).toHaveLength(64);
  });

  test("guest seats fill in order and stop at the capacity", () => {
    const server = fixedServer(["ABC234"]);
    const created = server.create(2);
    if (!created.ok) throw new Error("room");

    const first = server.join("  abc234 ");
    expect(first.ok).toBeTrue();
    if (!first.ok) return;

    expect(first.value.id).toBe("guest-1");
    expect(first.value.code).toBe("ABC234");

    expect(server.join("ABC234")).toEqual({ ok: false, error: "ROOM_FULL" });
  });

  test("a four-seat room admits three guests", () => {
    const server = fixedServer(["ABC234"]);
    const created = server.create(4);
    if (!created.ok) throw new Error("room");

    expect(server.join("ABC234")).toMatchObject({
      ok: true,
      value: { id: "guest-1" },
    });
    expect(server.join("ABC234")).toMatchObject({
      ok: true,
      value: { id: "guest-2" },
    });
    expect(server.join("ABC234")).toMatchObject({
      ok: true,
      value: { id: "guest-3" },
    });
    expect(server.join("ABC234")).toEqual({ ok: false, error: "ROOM_FULL" });
  });

  test("a freed seat is reused", () => {
    const server = fixedServer(["ABC234"]);
    const created = server.create(4);
    const first = server.join("ABC234");
    if (!created.ok || !first.ok) throw new Error("room");

    server.leave(first.value);

    expect(server.join("ABC234")).toMatchObject({
      ok: true,
      value: { id: "guest-1" },
    });
  });

  test("only the host receives seat notifications", () => {
    const server = fixedServer(["ABC234"]);
    const host = server.create(4);
    const first = server.join("ABC234");
    const second = server.join("ABC234");
    if (!host.ok || !first.ok || !second.ok) throw new Error("room");

    const hostPoll = server.poll(host.value, 0);
    if (!hostPoll.ok) throw new Error("poll");

    expect(
      hostPoll.value.signals.map((signal) => [signal.kind, signal.from]),
    ).toEqual([
      ["joined", "guest-1"],
      ["joined", "guest-2"],
    ]);
    expect(hostPoll.value.present).toEqual({
      host: true,
      guests: ["guest-1", "guest-2"],
    });
    expect(hostPoll.value.capacity).toBe(4);

    // Guests never see other seats' join notes.
    const guestPoll = server.poll(first.value, 0);
    if (!guestPoll.ok) throw new Error("poll");
    expect(guestPoll.value.signals).toHaveLength(0);
  });

  test("rejects unknown codes and bad tokens", () => {
    const server = fixedServer(["ABC234"]);
    expect(server.join("ZZZZZZ")).toEqual({
      ok: false,
      error: "ROOM_NOT_FOUND",
    });

    const created = server.create();
    if (!created.ok) throw new Error("room");

    expect(
      server.send(
        credentials("ABC234", "host", "0".repeat(64)),
        "offer",
        "sdp",
      ),
    ).toEqual({ ok: false, error: "UNAUTHORIZED" });
  });

  test("a targeted offer reaches only its recipient", () => {
    const server = fixedServer(["ABC234"]);
    const host = server.create(4);
    const first = server.join("ABC234");
    const second = server.join("ABC234");
    if (!host.ok || !first.ok || !second.ok) throw new Error("room");

    server.send(host.value, "offer", "OFFER-1", "guest-1");
    server.send(host.value, "offer", "OFFER-2", "guest-2");

    const firstPoll = server.poll(first.value, 0);
    const secondPoll = server.poll(second.value, 0);

    if (!firstPoll.ok || !secondPoll.ok) throw new Error("poll");

    expect(firstPoll.value.signals.map((signal) => signal.payload)).toEqual([
      "OFFER-1",
    ]);
    expect(secondPoll.value.signals.map((signal) => signal.payload)).toEqual([
      "OFFER-2",
    ]);
  });

  test("an addressed signal to a seat that is gone reports PEER_GONE", () => {
    const server = fixedServer(["ABC234"]);
    const host = server.create(4);
    if (!host.ok) throw new Error("room");

    // The seat exists but nobody holds it: a race, not a malformed request.
    expect(server.send(host.value, "offer", "SDP", "guest-3")).toEqual({
      ok: false,
      error: "PEER_GONE",
    });
  });

  test("relays an answer back to the host only", () => {
    const server = fixedServer(["ABC234"]);
    const host = server.create(4);
    const first = server.join("ABC234");
    const second = server.join("ABC234");
    if (!host.ok || !first.ok || !second.ok) throw new Error("room");

    server.send(host.value, "offer", "OFFER-1", "guest-1");
    const guestPoll = server.poll(first.value, 0);
    if (!guestPoll.ok) throw new Error("poll");

    server.send(first.value, "answer", "ANSWER-1", "host");
    const hostPoll = server.poll(host.value, guestPoll.value.seq);

    if (!hostPoll.ok) throw new Error("poll");
    expect(hostPoll.value.signals.map((signal) => signal.kind)).toEqual([
      "answer",
    ]);

    const otherGuestPoll = server.poll(second.value, 0);
    if (!otherGuestPoll.ok) throw new Error("poll");
    expect(otherGuestPoll.value.signals).toHaveLength(0);
  });

  test("caps signal size and unread payload volume", () => {
    const server = fixedServer(["ABC234"]);
    const host = server.create(4);
    const guest = server.join("ABC234");
    if (!host.ok || !guest.ok) throw new Error("room");

    expect(server.send(host.value, "offer", "")).toEqual({
      ok: false,
      error: "BAD_SIGNAL",
    });

    expect(server.send(host.value, "offer", "x".repeat(30_000))).toEqual({
      ok: false,
      error: "BAD_SIGNAL",
    });

    // The guest never polls, so nothing can be pruned yet: the cap is the
    // backstop against an unbounded log. One slot is the `joined` note.
    for (let index = 0; index < MAX_SIGNALS_PER_ROOM - 1; index += 1) {
      expect(server.send(host.value, "offer", `sdp-${index}`).ok).toBeTrue();
    }

    expect(server.send(host.value, "offer", "one-more")).toEqual({
      ok: false,
      error: "TOO_MANY_SIGNALS",
    });
  });

  test("read signals are pruned so a long lobby never fills the room", () => {
    const server = fixedServer(["ABC234"]);
    const host = server.create(2);
    if (!host.ok) throw new Error("room");

    // Far more join/leave cycles than MAX_SIGNALS_PER_ROOM would allow if the
    // log were never pruned.
    let hostSeq = 0;

    for (let index = 0; index < 40; index += 1) {
      const guest = server.join("ABC234");
      if (!guest.ok) throw new Error(`join ${index}`);

      const hostPoll = server.poll(host.value, hostSeq);
      if (!hostPoll.ok) throw new Error("host poll");
      hostSeq = hostPoll.value.seq;

      expect(
        server.send(host.value, "offer", `OFFER-${index}`, guest.value.id).ok,
      ).toBeTrue();

      const guestPoll = server.poll(guest.value, 0);
      if (!guestPoll.ok) throw new Error("guest poll");
      expect(guestPoll.value.signals.map((signal) => signal.payload)).toEqual([
        `OFFER-${index}`,
      ]);

      // Both peers advance past everything, then the seat leaves.
      server.poll(guest.value, guestPoll.value.seq);
      server.leave(guest.value);

      const leftPoll = server.poll(host.value, hostSeq);
      if (!leftPoll.ok) throw new Error("host poll after leave");
      hostSeq = leftPoll.value.seq;
    }

    const last = server.join("ABC234");
    if (!last.ok) throw new Error("last join");
    expect(server.send(host.value, "offer", "FINAL", last.value.id).ok).toBeTrue();
  });

  test("a reused seat never replays the previous occupant's signals", () => {
    const server = fixedServer(["ABC234"]);
    const host = server.create(2);
    const first = server.join("ABC234");
    if (!host.ok || !first.ok) throw new Error("room");

    server.send(host.value, "offer", "OLD-OFFER", first.value.id);
    server.leave(first.value);

    const second = server.join("ABC234");
    if (!second.ok) throw new Error("rejoin");

    // The host has not polled between the leave and the rejoin: the old offer
    // must not be delivered to the new occupant of `guest-1`.
    const polled = server.poll(second.value, 0);
    if (!polled.ok) throw new Error("poll");
    expect(polled.value.signals).toHaveLength(0);

    server.send(host.value, "offer", "NEW-OFFER", second.value.id);
    const after = server.poll(second.value, 0);
    if (!after.ok) throw new Error("poll");
    expect(after.value.signals.map((signal) => signal.payload)).toEqual([
      "NEW-OFFER",
    ]);
  });

  test("a seat that joined and left in one window leaves no stale answer", () => {
    const server = fixedServer(["ABC234"]);
    const host = server.create(2);
    const guest = server.join("ABC234");
    if (!host.ok || !guest.ok) throw new Error("room");

    // The guest answers, then leaves before the host polls.
    server.send(guest.value, "answer", "ANSWER", "host");
    server.leave(guest.value);

    const next = server.join("ABC234");
    if (!next.ok) throw new Error("rejoin");

    const hostPoll = server.poll(host.value, 0);
    if (!hostPoll.ok) throw new Error("poll");
    // The host sees the new join but never the departed guest's answer.
    expect(
      hostPoll.value.signals.map((signal) => [signal.kind, signal.payload]),
    ).toEqual([["joined", ""]]);
  });

  test("the host can refuse joins once the match started", () => {
    const server = fixedServer(["ABC234"]);
    const host = server.create(4);
    const guest = server.join("ABC234");
    if (!host.ok || !guest.ok) throw new Error("room");

    expect(server.markStarted(guest.value)).toEqual({
      ok: false,
      error: "UNAUTHORIZED",
    });
    expect(server.markStarted(host.value).ok).toBeTrue();

    // A guest already inside is unaffected; a new one fails immediately.
    expect(server.poll(guest.value, 0).ok).toBeTrue();
    expect(server.join("ABC234")).toEqual({
      ok: false,
      error: "ROOM_STARTED",
    });
  });

  test("the host leaving closes the room for every guest", () => {
    const server = fixedServer(["ABC234"]);
    const host = server.create(4);
    const guest = server.join("ABC234");
    if (!host.ok || !guest.ok) throw new Error("room");

    server.leave(host.value);

    expect(server.join("ABC234")).toEqual({ ok: false, error: "ROOM_CLOSED" });

    const polled = server.poll(guest.value, 0);
    if (!polled.ok) throw new Error("poll");
    expect(polled.value.closed).toBeTrue();
    expect(polled.value.present.host).toBeFalse();
  });

  test("a guest leaving notifies the host and frees the seat", () => {
    const server = fixedServer(["ABC234"]);
    const host = server.create(4);
    const guest = server.join("ABC234");
    if (!host.ok || !guest.ok) throw new Error("room");

    const before = server.poll(host.value, 0);
    if (!before.ok) throw new Error("poll");

    server.leave(guest.value);

    const after = server.poll(host.value, before.value.seq);
    if (!after.ok) throw new Error("poll");

    expect(
      after.value.signals.map((signal) => [signal.kind, signal.from]),
    ).toEqual([["left", "guest-1"]]);
    expect(after.value.present.guests).toEqual([]);
    expect(server.join("ABC234").ok).toBeTrue();
  });

  test("expires rooms on their own clock", () => {
    let now = 0;
    const server = createVersusServer({
      now: () => now,
      newRoomCode: () => "ABC234",
    });
    const host = server.create();
    if (!host.ok) throw new Error("room");

    now += 11 * 60_000; // Past the empty-room TTL.
    expect(server.poll(host.value, 0)).toEqual({
      ok: false,
      error: "ROOM_NOT_FOUND",
    });
  });

  test("host polling does not keep a guest-less room alive", () => {
    let now = 0;
    const server = createVersusServer({
      now: () => now,
      newRoomCode: () => "ABC234",
    });
    const host = server.create();
    if (!host.ok) throw new Error("room");

    // The host keeps polling, but nobody joins.
    for (let tick = 0; tick < 9; tick += 1) {
      now += 60_000;
      expect(server.poll(host.value, 0).ok).toBeTrue();
    }

    now += 2 * 60_000; // Past the 10-minute empty-room TTL.
    expect(server.poll(host.value, 0)).toEqual({
      ok: false,
      error: "ROOM_NOT_FOUND",
    });
  });

  test("normalizes codes and validates capacities", () => {
    expect(normalizeRoomCode(" ab2 34 ")).toBe("AB2 34");
    expect(normalizeRoomCode("abc234")).toBe("ABC234");
    expect(isVersusCapacity(2)).toBeTrue();
    expect(isVersusCapacity(4)).toBeTrue();
    expect(isVersusCapacity(3)).toBeFalse();
  });
});
