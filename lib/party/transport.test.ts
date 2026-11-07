import { describe, expect, test } from "bun:test";
import { createMemoryTransportPair } from "./transport";
import type { WireMessage } from "./protocol";

const HELLO: WireMessage = {
  type: "HELLO",
  protocol: 1,
  role: "guest",
  player: { id: "guest", name: "Bruno", avatar: "/pictures/dog.png" },
};

const BYE: WireMessage = { type: "BYE", protocol: 1, reason: "host-closed" };

describe("memory transport pair", () => {
  test("queues messages until both ends are connected", async () => {
    const pair = createMemoryTransportPair();
    const received: WireMessage[] = [];

    pair.host.subscribe((message) => received.push(message));
    pair.guest.send(HELLO);
    expect(received).toHaveLength(0);

    await pair.host.connect();
    expect(received).toHaveLength(0);

    await pair.guest.connect();
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(HELLO);
  });

  test("delivers in both directions", async () => {
    const pair = createMemoryTransportPair();
    const toHost: WireMessage[] = [];
    const toGuest: WireMessage[] = [];

    pair.host.subscribe((message) => toHost.push(message));
    pair.guest.subscribe((message) => toGuest.push(message));
    await pair.host.connect();
    await pair.guest.connect();

    pair.guest.send(HELLO);
    pair.host.send(BYE);

    expect(toHost).toHaveLength(1);
    expect(toGuest).toHaveLength(1);
  });

  test("rejects messages that fail protocol validation", async () => {
    const pair = createMemoryTransportPair();
    await pair.host.connect();
    await pair.guest.connect();

    expect(() =>
      pair.guest.send({ type: "NOPE", protocol: 1 } as unknown as WireMessage),
    ).toThrow();
  });

  test("unsubscribing stops delivery and disconnect closes both ends", async () => {
    const pair = createMemoryTransportPair();
    const received: WireMessage[] = [];
    const hostStatuses: string[] = [];
    const guestStatuses: string[] = [];

    const unsubscribe = pair.host.subscribe((message) => received.push(message));
    pair.host.subscribeStatus((status) => hostStatuses.push(status));
    pair.guest.subscribeStatus((status) => guestStatuses.push(status));
    await pair.host.connect();
    await pair.guest.connect();
    unsubscribe();

    pair.guest.send(HELLO);
    expect(received).toHaveLength(0);

    pair.disconnect();
    expect(pair.host.status).toBe("failed");
    expect(pair.guest.status).toBe("failed");
    expect(hostStatuses).toContain("failed");
    expect(guestStatuses).toContain("failed");
  });
});
