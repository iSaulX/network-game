import { describe, expect, test } from "bun:test";
import {
  PARTY_PROTOCOL_VERSION,
  type LanPlayerInfo,
  type WireMessage,
} from "../protocol";
import { PartySocketTransport } from "./party-socket-transport";

const PLAYER: LanPlayerInfo = {
  id: "host",
  name: "Anfitrión",
  avatar: "/pictures/chicken.png",
};

class FakeSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: string[] = [];

  send(value: string): void {
    this.sent.push(value);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function transportFor(socket: FakeSocket): PartySocketTransport {
  return new PartySocketTransport({
    code: "ABC234",
    id: "host",
    token: "a".repeat(64),
    player: PLAYER,
    url: "ws://test",
    socketFactory: () => socket as unknown as WebSocket,
    heartbeatMs: 10 * 60_000,
    connectTimeoutMs: 2_000,
    reconnectOnClose: false,
  });
}

describe("party socket transport", () => {
  test("authenticates, relays wire messages and closes", async () => {
    const socket = new FakeSocket();
    const transport = transportFor(socket);
    const received: WireMessage[] = [];
    transport.subscribe((message) => received.push(message));

    const connecting = transport.connect();
    socket.open();

    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      type: "AUTH",
      protocol: PARTY_PROTOCOL_VERSION,
      code: "ABC234",
      id: "host",
      token: "a".repeat(64),
    });

    socket.receive({ type: "AUTH_OK", protocol: PARTY_PROTOCOL_VERSION });
    await connecting;
    expect(transport.status).toBe("open");

    transport.send({
      type: "HELLO",
      protocol: PARTY_PROTOCOL_VERSION,
      player: PLAYER,
    });
    expect(JSON.parse(socket.sent[1]!)).toMatchObject({
      type: "HELLO",
      protocol: PARTY_PROTOCOL_VERSION,
    });

    socket.receive({
      type: "LOBBY",
      protocol: PARTY_PROTOCOL_VERSION,
      mode: "1v1",
      players: [PLAYER],
      emptySeats: [],
    });
    expect(received.map((message) => message.type)).toEqual(["LOBBY"]);

    transport.close();
    expect(transport.status).toBe("closed");
  });

  test("rejects with the server's auth failure", async () => {
    const socket = new FakeSocket();
    const transport = transportFor(socket);

    const connecting = transport.connect();
    socket.open();
    socket.receive({
      type: "AUTH_ERROR",
      protocol: PARTY_PROTOCOL_VERSION,
      code: "room-not-found",
    });

    await expect(connecting).rejects.toThrow("room-not-found");
    expect(transport.status).toBe("failed");
  });
});
