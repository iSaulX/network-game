import { describe, expect, test } from "bun:test";
import { createWebRTCTransport } from "./peer-connection";
import type { DataChannelLike, PeerConnectionLike } from "./types";
import type { WireMessage } from "../protocol";

const HELLO: WireMessage = {
  type: "HELLO",
  protocol: 1,
  role: "guest",
  player: { id: "guest", name: "Bruno", avatar: "/pictures/dog.png" },
};

function fakeChannel(readyState: DataChannelLike["readyState"] = "connecting") {
  const sent: string[] = [];
  const channel: DataChannelLike = {
    label: "parchis-v1",
    readyState,
    bufferedAmount: 0,
    send(data) {
      sent.push(data);
    },
    close() {
      (channel as { readyState: string }).readyState = "closed";
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  return { channel, sent };
}

function fakePeer() {
  const pc: PeerConnectionLike = {
    iceGatheringState: "complete",
    connectionState: "new",
    localDescription: null,
    remoteDescription: null,
    onicecandidate: null,
    onicegatheringstatechange: null,
    onconnectionstatechange: null,
    ondatachannel: null,
    createDataChannel: () => fakeChannel().channel,
    createOffer: async () => ({ type: "offer", sdp: "" }),
    createAnswer: async () => ({ type: "answer", sdp: "" }),
    async setLocalDescription() {},
    async setRemoteDescription() {},
    async addIceCandidate() {},
    close() {
      (pc as { connectionState: string }).connectionState = "closed";
    },
  };
  return pc;
}

describe("WebRTC transport", () => {
  test("queues outbound messages until the channel opens", async () => {
    const { channel, sent } = fakeChannel();
    const transport = createWebRTCTransport({ pc: fakePeer(), channel });

    transport.send(HELLO);
    expect(sent).toHaveLength(0);

    (channel as { readyState: string }).readyState = "open";
    channel.onopen?.();

    expect(transport.status).toBe("open");
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toMatchObject({ type: "HELLO" });
  });

  test("connect resolves once the channel opens", async () => {
    const { channel } = fakeChannel();
    const transport = createWebRTCTransport({ pc: fakePeer(), channel });
    const pending = transport.connect();

    (channel as { readyState: string }).readyState = "open";
    channel.onopen?.();

    await expect(pending).resolves.toBeUndefined();
  });

  test("connect rejects when the channel fails", async () => {
    const { channel } = fakeChannel();
    const transport = createWebRTCTransport({ pc: fakePeer(), channel });
    const pending = transport.connect();

    channel.onerror?.();

    await expect(pending).rejects.toThrow();
  });

  test("delivers only valid string messages and drops binary/nonsense", () => {
    const { channel } = fakeChannel("open");
    const transport = createWebRTCTransport({ pc: fakePeer(), channel });
    const received: WireMessage[] = [];
    transport.subscribe((message) => received.push(message));

    channel.onmessage?.({ data: JSON.stringify(HELLO) });
    channel.onmessage?.({ data: new Uint8Array([1, 2, 3]) });
    channel.onmessage?.({ data: "{not json" });
    channel.onmessage?.({ data: "x".repeat(70 * 1024) });

    expect(received).toEqual([HELLO]);
  });

  test("refuses to stack messages on a peer that stopped draining", () => {
    const { channel } = fakeChannel("open");
    const transport = createWebRTCTransport({ pc: fakePeer(), channel });
    (channel as { bufferedAmount: number }).bufferedAmount = 1_000_001;

    expect(() => transport.send(HELLO)).toThrow();
  });

  test("propagates channel close and connection state", () => {
    const pc = fakePeer();
    const { channel } = fakeChannel("open");
    const transport = createWebRTCTransport({ pc, channel });
    const statuses: string[] = [];
    const connections: string[] = [];

    transport.subscribeStatus((status) => statuses.push(status));
    transport.subscribeConnection((status) => connections.push(status));

    (pc as { connectionState: string }).connectionState = "disconnected";
    pc.onconnectionstatechange?.();
    (pc as { connectionState: string }).connectionState = "connected";
    pc.onconnectionstatechange?.();

    channel.onclose?.();

    expect(connections).toEqual(["reconnecting", "connected"]);
    expect(statuses).toContain("closed");
  });

  test("close detaches handlers and closes both layers", () => {
    const pc = fakePeer();
    const { channel } = fakeChannel("open");
    const transport = createWebRTCTransport({ pc, channel });

    transport.close();

    expect(transport.status).toBe("closed");
    expect(channel.onmessage).toBeNull();
    expect(pc.onconnectionstatechange).toBeNull();
    expect(pc.connectionState).toBe("closed");
  });
});
