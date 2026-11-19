import { describe, expect, test } from "bun:test";
import {
  createRoomState,
  deserializeRoom,
  joinRoomState,
  serializeRoom,
  type VersusCapacity,
  type VersusCredentials,
  type VersusRoom,
} from "./rooms";
import {
  actParty,
  advanceParty,
  BOT_DELAY_MS,
  connectParty,
  disconnectParty,
  heartbeatParty,
  leaveParty,
  PRESENCE_TTL_MS,
  setSeatEmptyParty,
  startParty,
} from "./party-state";
import type { LanPlayerInfo } from "@/lib/party/protocol";
import type { DieValue } from "@/lib/parchis/types";

const HOST_PROFILE: LanPlayerInfo = {
  id: "host",
  name: "Anfitrión",
  avatar: "/pictures/chicken.png",
};

const GUEST_PROFILE: LanPlayerInfo = {
  id: "guest-1",
  name: "Invitada",
  avatar: "/pictures/dog.png",
};

function openRoom(capacity: VersusCapacity = 2): {
  room: VersusRoom;
  host: VersusCredentials;
  guest: VersusCredentials | null;
} {
  const created = createRoomState({
    code: "ABC234",
    capacity,
    hostToken: "a".repeat(64),
    time: 0,
  });
  const joined = joinRoomState(created.room, 0, "b".repeat(64));

  return {
    room: created.room,
    host: created.credentials,
    guest: joined.ok ? joined.value : null,
  };
}

function dice(...values: [DieValue, DieValue][]): () => [DieValue, DieValue] {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

describe("server-authoritative party state", () => {
  test("the host starts a match with connected humans and bots", () => {
    const { room, host, guest } = openRoom(2);
    if (!guest) throw new Error("guest");

    connectParty(room, host, HOST_PROFILE, 0);
    connectParty(room, guest, GUEST_PROFILE, 0);

    const started = startParty(room, host, 0);

    expect(started.kind).toBe("start");
    expect(started.snapshot.started).toBeTrue();
    expect(started.snapshot.version).toBe(0);
    expect(started.snapshot.state?.schemaVersion).toBe(2);
    expect(
      started.snapshot.roster?.players.map((player) => player.id),
    ).toEqual(["host", "guest-1"]);
    expect(room.started).toBeTrue();
  });

  test("the host can leave an unoccupied guest seat empty", () => {
    const { room, host, guest } = openRoom(4);
    if (!guest) throw new Error("guest");

    connectParty(room, host, HOST_PROFILE, 0);
    connectParty(room, guest, GUEST_PROFILE, 0);

    const emptied = setSeatEmptyParty(room, host, "guest-2", true, 0);
    expect(emptied.kind).toBe("lobby");
    expect(emptied.snapshot.emptySeats).toContain("guest-2");

    const occupied = setSeatEmptyParty(room, host, "guest-1", true, 0);
    expect(occupied.error?.code).toBe("BAD_MESSAGE");

    const started = startParty(room, host, 0);
    expect(
      started.snapshot.roster?.players.map((player) => player.id),
    ).not.toContain("guest-2");
  });

  test("a guest cannot start or change seats", () => {
    const { room, host, guest } = openRoom(2);
    if (!guest) throw new Error("guest");

    connectParty(room, host, HOST_PROFILE, 0);
    connectParty(room, guest, GUEST_PROFILE, 0);

    expect(startParty(room, guest, 0).error?.code).toBe("BAD_MESSAGE");
    expect(setSeatEmptyParty(room, guest, "guest-1", true, 0).error?.code).toBe(
      "BAD_MESSAGE",
    );
  });

  test("the server applies actions and rejects the wrong turn or version", () => {
    const { room, host, guest } = openRoom(2);
    if (!guest) throw new Error("guest");

    connectParty(room, host, HOST_PROFILE, 0);
    connectParty(room, guest, GUEST_PROFILE, 0);
    startParty(room, host, 0);

    const offTurn = actParty(
      room,
      guest,
      { type: "ROLL" },
      0,
      0,
      dice([1, 2]),
    );
    expect(offTurn.error?.code).toBe("NOT_YOUR_TURN");

    const rolled = actParty(
      room,
      host,
      { type: "ROLL" },
      0,
      0,
      dice([5, 3]),
    );
    expect(rolled.error).toBeUndefined();
    expect(rolled.snapshot.version).toBe(1);

    const stale = actParty(
      room,
      host,
      { type: "ROLL" },
      0,
      0,
      dice([5, 3]),
    );
    expect(stale.error?.code).toBe("STALE_VERSION");
  });

  test("the server plays a bot after the delay and only once per step", () => {
    const { room, host } = openRoom(4);
    connectParty(room, host, HOST_PROFILE, 0);

    const started = startParty(room, host, 0);
    expect(started.snapshot.nextBotAt).toBe(BOT_DELAY_MS);

    const early = advanceParty(room, 0, dice([5, 3]));
    expect(early.kind).toBe("none");
    expect(early.snapshot.version).toBe(0);

    const bot = advanceParty(room, BOT_DELAY_MS, dice([5, 3]));
    expect(bot.kind).toBe("state");
    expect(bot.snapshot.version).toBe(1);
    expect(
      bot.snapshot.state?.players[
        bot.snapshot.state.currentPlayerIndex
      ]?.id,
    ).toBe("bot-blue");
    expect(bot.snapshot.nextBotAt).not.toBeNull();
  });

  test("a dropped human is played by the server and can reclaim the seat", () => {
    const { room, host, guest } = openRoom(2);
    if (!guest) throw new Error("guest");

    connectParty(room, host, HOST_PROFILE, 0);
    connectParty(room, guest, GUEST_PROFILE, 0);
    startParty(room, host, 0);

    const dropped = disconnectParty(room, guest, 0);
    expect(dropped.snapshot.disconnected).toContain("guest-1");

    const back = connectParty(room, guest, GUEST_PROFILE, 10);
    expect(back.snapshot.disconnected).not.toContain("guest-1");
  });

  test("stale heartbeats mark a human as disconnected", () => {
    const { room, host, guest } = openRoom(2);
    if (!guest) throw new Error("guest");

    connectParty(room, host, HOST_PROFILE, 0);
    connectParty(room, guest, GUEST_PROFILE, 0);
    startParty(room, host, 0);

    const beat = heartbeatParty(room, host, PRESENCE_TTL_MS + 1);
    expect(beat.snapshot.players.length).toBeGreaterThan(0);
    expect(beat.snapshot.disconnected).toContain("guest-1");
  });

  test("the host leaving before the start closes the room", () => {
    const { room, host, guest } = openRoom(2);
    if (!guest) throw new Error("guest");

    connectParty(room, host, HOST_PROFILE, 0);
    connectParty(room, guest, GUEST_PROFILE, 0);

    const left = leaveParty(room, host, 0);
    expect(left.kind).toBe("bye");
    expect(left.closeRoom).toBeTrue();
    expect(left.snapshot.closed).toBeTrue();
  });

  test("a guest leaving mid-match keeps the game running", () => {
    const { room, host, guest } = openRoom(2);
    if (!guest) throw new Error("guest");

    connectParty(room, host, HOST_PROFILE, 0);
    connectParty(room, guest, GUEST_PROFILE, 0);
    startParty(room, host, 0);

    const left = leaveParty(room, guest, 0);
    expect(left.kind).toBe("none");
    expect(left.snapshot.started).toBeTrue();
    expect(left.snapshot.disconnected).toContain("guest-1");
    expect(left.snapshot.state).not.toBeNull();
  });

  test("the party snapshot round-trips through Room serialization", () => {
    const { room, host, guest } = openRoom(2);
    if (!guest) throw new Error("guest");

    connectParty(room, host, HOST_PROFILE, 0);
    connectParty(room, guest, GUEST_PROFILE, 0);
    startParty(room, host, 0);
    actParty(room, host, { type: "ROLL" }, 0, 0, dice([4, 6]));

    const restored = deserializeRoom(serializeRoom(room));

    expect(restored?.party?.mode).toBe("1v1");
    expect(restored?.party?.version).toBe(1);
    expect(restored?.party?.roster?.players.map((player) => player.id)).toEqual([
      "host",
      "guest-1",
    ]);
    expect(restored?.party?.profiles.host?.name).toBe("Anfitrión");
  });
});
