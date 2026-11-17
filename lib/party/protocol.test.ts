import { describe, expect, test } from "bun:test";
import {
  decodeWireMessage,
  encodeWireMessage,
  PARTY_PROTOCOL_VERSION,
  type LanRoster,
  type WireMessage,
} from "./protocol";
import { createGame } from "@/lib/parchis";

const ROSTER: LanRoster = {
  players: [
    { id: "host", name: "Ana", avatar: "/pictures/dog.png" },
    { id: "guest-1", name: "Bruno", avatar: "/pictures/octupus.png" },
  ],
};

const SOLO_ROSTER: LanRoster = {
  players: [
    { id: "host", name: "Ana", avatar: "/pictures/dog.png" },
    { id: "bot-yellow", name: "Carla", avatar: "/pictures/chicken.png" },
  ],
};

const STATE = createGame([
  { id: "host", color: "red" },
  { id: "guest-1", color: "yellow" },
]);

describe("wire protocol", () => {
  test("round-trips every message type", () => {
    const messages: WireMessage[] = [
      {
        type: "HELLO",
        protocol: PARTY_PROTOCOL_VERSION,
        player: { id: "guest-1", name: "Bruno", avatar: "/pictures/dog.png" },
      },
      {
        type: "ACTION",
        protocol: PARTY_PROTOCOL_VERSION,
        version: 3,
        action: { type: "ROLL" },
        requestId: "req-1",
      },
      {
        type: "LOBBY",
        protocol: PARTY_PROTOCOL_VERSION,
        mode: "1v1",
        players: [
          { id: "host", name: "Ana", avatar: "/pictures/dog.png" },
          { id: "guest-1", name: "Bruno", avatar: "/pictures/octupus.png" },
        ],
        emptySeats: [],
      },
      {
        type: "START",
        protocol: PARTY_PROTOCOL_VERSION,
        version: 0,
        mode: "1v1",
        roster: ROSTER,
        state: STATE,
      },
      {
        type: "STATE",
        protocol: PARTY_PROTOCOL_VERSION,
        version: 1,
        state: STATE,
        events: [],
      },
      {
        type: "ERROR",
        protocol: PARTY_PROTOCOL_VERSION,
        version: 2,
        code: "STALE_VERSION",
        message: "stale",
        state: STATE,
      },
      {
        type: "CONNECTION",
        protocol: PARTY_PROTOCOL_VERSION,
        connections: {
          host: { transport: "webrtc", candidate: "host" },
          "guest-1": { transport: "webrtc", candidate: "relay" },
        },
      },
      {
        type: "BYE",
        protocol: PARTY_PROTOCOL_VERSION,
        reason: "host-closed",
      },
    ];

    for (const message of messages) {
      const decoded = decodeWireMessage(encodeWireMessage(message));
      expect(decoded.ok).toBeTrue();
      if (decoded.ok) {
        expect(decoded.message).toEqual(message);
      }
    }
  });

  test("accepts a roster that seats bots in empty places", () => {
    const message = {
      type: "START",
      protocol: PARTY_PROTOCOL_VERSION,
      version: 0,
      mode: "all",
      roster: SOLO_ROSTER,
      state: STATE,
    };

    expect(decodeWireMessage(JSON.stringify(message)).ok).toBeTrue();
  });

  test("accepts rosters with 2 to 4 seats and a LOBBY with empty seats", () => {
    const start = (playerCount: number) => ({
      type: "START",
      protocol: PARTY_PROTOCOL_VERSION,
      version: 0,
      mode: "all",
      roster: { players: ROSTER.players.slice(0, playerCount) },
      state: STATE,
    });

    for (const count of [2, 3, 4]) {
      expect(decodeWireMessage(JSON.stringify(start(count))).ok).toBeTrue();
    }
    expect(
      decodeWireMessage(JSON.stringify(start(1))).ok,
    ).toBeFalse();

    const lobby = (emptySeats: unknown) => ({
      type: "LOBBY",
      protocol: PARTY_PROTOCOL_VERSION,
      mode: "all",
      players: [{ id: "host", name: "Ana", avatar: "/pictures/dog.png" }],
      emptySeats,
    });

    expect(decodeWireMessage(JSON.stringify(lobby(["guest-2"]))).ok).toBeTrue();
    // The host's own seat, a connected guest, a bot id or a duplicate is not
    // a valid empty seat.
    expect(decodeWireMessage(JSON.stringify(lobby(["host"]))).ok).toBeFalse();
    expect(
      decodeWireMessage(JSON.stringify(lobby(["bot-red"]))).ok,
    ).toBeFalse();
    expect(
      decodeWireMessage(JSON.stringify(lobby(["guest-2", "guest-2"]))).ok,
    ).toBeFalse();
    expect(decodeWireMessage(JSON.stringify(lobby("guest-2"))).ok).toBeFalse();
  });

  test("rejects a malformed connection map", () => {
    const message = (connections: unknown) => ({
      type: "CONNECTION",
      protocol: PARTY_PROTOCOL_VERSION,
      connections,
    });

    expect(decodeWireMessage(JSON.stringify(message([]))).ok).toBeFalse();
    expect(
      decodeWireMessage(
        JSON.stringify(
          message({ "guest-1": { transport: "carrier-pigeon", candidate: "host" } }),
        ),
      ).ok,
    ).toBeFalse();
    expect(
      decodeWireMessage(
        JSON.stringify(
          message({ "guest-1": { transport: "webrtc", candidate: "teleport" } }),
        ),
      ).ok,
    ).toBeFalse();
    expect(
      decodeWireMessage(
        JSON.stringify(
          message({ "bot-red": { transport: "webrtc", candidate: "host" } }),
        ),
      ).ok,
    ).toBeFalse();
  });

  test("rejects unknown types, wrong protocols and non-text input", () => {
    expect(decodeWireMessage(42).ok).toBeFalse();
    expect(decodeWireMessage("{not json").ok).toBeFalse();
    expect(
      decodeWireMessage(JSON.stringify({ type: "NOPE", protocol: PARTY_PROTOCOL_VERSION })).ok,
    ).toBeFalse();
    expect(
      decodeWireMessage(
        JSON.stringify({
          type: "START",
          protocol: 1,
          version: 0,
          roster: ROSTER,
          state: STATE,
        }),
      ),
    ).toMatchObject({ ok: false, code: "PROTOCOL_MISMATCH" });
  });

  test("rejects malformed actions", () => {
    const base = {
      type: "ACTION",
      protocol: PARTY_PROTOCOL_VERSION,
      version: 1,
      requestId: "r",
    };

    expect(
      decodeWireMessage(JSON.stringify({ ...base, action: { type: "ROLL", dice: [1, 2] } })).ok,
    ).toBeFalse();
    expect(
      decodeWireMessage(JSON.stringify({ ...base, action: { type: "MOVE", move: { type: "ADVANCE", tokenId: "x", to: 999, die: 1 } } })).ok,
    ).toBeFalse();
    expect(
      decodeWireMessage(JSON.stringify({ ...base, action: { type: "CHOOSE_BARRIER", progress: 1.5 } })).ok,
    ).toBeFalse();
    expect(
      decodeWireMessage(JSON.stringify({ ...base, action: { type: "MOVE" } })).ok,
    ).toBeFalse();
  });

  test("rejects a HELLO from the host or a bot seat", () => {
    for (const id of ["host", "bot-red"] as const) {
      const hello = {
        type: "HELLO",
        protocol: PARTY_PROTOCOL_VERSION,
        player: { id, name: "Ana", avatar: "/pictures/dog.png" },
      };
      expect(decodeWireMessage(JSON.stringify(hello)).ok).toBeFalse();
    }
  });

  test("rejects a LOBBY with duplicated seats or too many rows", () => {
    const duplicated = {
      type: "LOBBY",
      protocol: PARTY_PROTOCOL_VERSION,
      mode: "all",
      players: [
        { id: "host", name: "Ana", avatar: "/pictures/dog.png" },
        { id: "host", name: "Bruno", avatar: "/pictures/octupus.png" },
      ],
    };
    expect(decodeWireMessage(JSON.stringify(duplicated)).ok).toBeFalse();

    const oversized = {
      type: "LOBBY",
      protocol: PARTY_PROTOCOL_VERSION,
      mode: "all",
      players: [
        { id: "host", name: "Ana", avatar: "/pictures/dog.png" },
        { id: "guest-1", name: "B", avatar: "/pictures/dog.png" },
        { id: "guest-2", name: "C", avatar: "/pictures/dog.png" },
        { id: "guest-3", name: "D", avatar: "/pictures/dog.png" },
        { id: "guest-4", name: "E", avatar: "/pictures/dog.png" },
      ],
    };
    expect(decodeWireMessage(JSON.stringify(oversized)).ok).toBeFalse();
  });

  test("rejects non-allowlisted avatars and oversized names", () => {
    const hello = {
      type: "HELLO",
      protocol: PARTY_PROTOCOL_VERSION,
      player: { id: "guest-1", name: "x".repeat(25), avatar: "/pictures/dog.png" },
    };
    expect(decodeWireMessage(JSON.stringify(hello)).ok).toBeFalse();

    const remoteAvatar = {
      type: "HELLO",
      protocol: PARTY_PROTOCOL_VERSION,
      player: { id: "guest-1", name: "ok", avatar: "https://evil.example/x.png" },
    };
    expect(decodeWireMessage(JSON.stringify(remoteAvatar)).ok).toBeFalse();
  });

  test("rejects a message above the size cap", () => {
    const big = JSON.stringify({
      type: "STATE",
      protocol: PARTY_PROTOCOL_VERSION,
      version: 1,
      state: STATE,
      events: [],
      padding: "x".repeat(70_000),
    });
    expect(decodeWireMessage(big).ok).toBeFalse();
  });
});
