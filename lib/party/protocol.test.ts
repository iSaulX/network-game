import { describe, expect, test } from "bun:test";
import {
  decodeWireMessage,
  encodeWireMessage,
  type LanRoster,
  type WireMessage,
} from "./protocol";
import { createGame } from "@/lib/parchis";

const ROSTER: LanRoster = {
  host: { id: "host", name: "Ana", avatar: "/pictures/dog.png" },
  guest: { id: "guest", name: "Bruno", avatar: "/pictures/octupus.png" },
};

const STATE = createGame([
  { id: "host", color: "red" },
  { id: "guest", color: "yellow" },
]);

describe("wire protocol", () => {
  test("round-trips every message type", () => {
    const messages: WireMessage[] = [
      {
        type: "HELLO",
        protocol: 1,
        role: "guest",
        player: ROSTER.guest,
      },
      {
        type: "ACTION",
        protocol: 1,
        version: 3,
        action: { type: "ROLL" },
        requestId: "req-1",
      },
      { type: "START", protocol: 1, version: 0, roster: ROSTER, state: STATE },
      {
        type: "STATE",
        protocol: 1,
        version: 1,
        state: STATE,
        events: [],
      },
      {
        type: "ERROR",
        protocol: 1,
        version: 2,
        code: "STALE_VERSION",
        message: "stale",
        state: STATE,
      },
      { type: "BYE", protocol: 1, reason: "host-closed" },
    ];

    for (const message of messages) {
      const decoded = decodeWireMessage(encodeWireMessage(message));
      expect(decoded.ok).toBeTrue();
      if (decoded.ok) {
        expect(decoded.message).toEqual(message);
      }
    }
  });

  test("rejects unknown types, wrong protocols and non-text input", () => {
    expect(decodeWireMessage(42).ok).toBeFalse();
    expect(decodeWireMessage("{not json").ok).toBeFalse();
    expect(decodeWireMessage(JSON.stringify({ type: "NOPE", protocol: 1 })).ok).toBeFalse();
    expect(
      decodeWireMessage(JSON.stringify({ type: "START", protocol: 2, version: 0, roster: ROSTER, state: STATE })),
    ).toMatchObject({ ok: false, code: "PROTOCOL_MISMATCH" });
  });

  test("rejects malformed actions", () => {
    const base = { type: "ACTION", protocol: 1, version: 1, requestId: "r" };

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

  test("rejects a HELLO that does not identify the guest", () => {
    const hello = {
      type: "HELLO",
      protocol: 1,
      role: "guest",
      player: { ...ROSTER.guest, id: "host" },
    };
    expect(decodeWireMessage(JSON.stringify(hello)).ok).toBeFalse();
  });

  test("rejects non-allowlisted avatars and oversized names", () => {
    const hello = {
      type: "HELLO",
      protocol: 1,
      role: "guest",
      player: { id: "guest", name: "x".repeat(25), avatar: "/pictures/dog.png" },
    };
    expect(decodeWireMessage(JSON.stringify(hello)).ok).toBeFalse();

    const remoteAvatar = {
      type: "HELLO",
      protocol: 1,
      role: "guest",
      player: { id: "guest", name: "ok", avatar: "https://evil.example/x.png" },
    };
    expect(decodeWireMessage(JSON.stringify(remoteAvatar)).ok).toBeFalse();
  });

  test("rejects a message above the size cap", () => {
    const big = JSON.stringify({
      type: "STATE",
      protocol: 1,
      version: 1,
      state: STATE,
      events: [],
      padding: "x".repeat(70_000),
    });
    expect(decodeWireMessage(big).ok).toBeFalse();
  });
});
