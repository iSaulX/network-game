import { describe, expect, test } from "bun:test";
import {
  acceptHostAnswer,
  acceptHostOffer,
  createHostOffer,
  mapConnectionState,
  selectIceServers,
  waitForIceGathering,
  type PairingTimers,
} from "./signaling";
import type {
  DataChannelLike,
  PeerConnectionLike,
  SessionDescriptionLike,
} from "./types";

const SDP = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=candidate:0 1 udp 2122260223 192.168.1.20 51234 typ host generation 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
].join("\r\n");

function fakeChannel(): DataChannelLike {
  return {
    label: "parchis-v1",
    readyState: "connecting",
    bufferedAmount: 0,
    send() {},
    close() {},
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
}

interface FakeOptions {
  gather?: "complete" | "timeout" | "event" | "end-of-candidates";
}

function fakePeer(options: FakeOptions = {}): PeerConnectionLike {
  const channel = fakeChannel();
  const pc: PeerConnectionLike = {
    iceGatheringState: "new",
    connectionState: "new",
    localDescription: null,
    remoteDescription: null,
    onicecandidate: null,
    onicegatheringstatechange: null,
    onconnectionstatechange: null,
    ondatachannel: null,
    createDataChannel: () => channel,
    createOffer: async () => ({ type: "offer", sdp: SDP }),
    createAnswer: async () => ({ type: "answer", sdp: SDP }),
    async setLocalDescription(description: SessionDescriptionLike) {
      (pc as { localDescription: SessionDescriptionLike | null }).localDescription =
        description;
      // Kick gathering asynchronously, like a real implementation.
      queueMicrotask(() => startGathering(pc, options));
    },
    async setRemoteDescription(description: SessionDescriptionLike) {
      (pc as { remoteDescription: SessionDescriptionLike | null }).remoteDescription =
        description;
    },
    async addIceCandidate() {},
    close() {},
  };
  return pc;
}

/** Drives the fake's gathering handlers the way a real peer would. */
function startGathering(pc: PeerConnectionLike, options: FakeOptions = {}): void {
  (pc as { iceGatheringState: string }).iceGatheringState = "gathering";
  pc.onicegatheringstatechange?.();
  if (options.gather === "complete") {
    (pc as { iceGatheringState: string }).iceGatheringState = "complete";
    pc.onicegatheringstatechange?.();
  } else if (options.gather === "end-of-candidates") {
    pc.onicecandidate?.({ candidate: null });
  }
}

function manualTimers() {
  const callbacks: Array<() => void> = [];
  const timers: PairingTimers = {
    setTimeout(callback) {
      callbacks.push(callback);
      return callbacks.length - 1;
    },
    clearTimeout(handle) {
      callbacks[handle as number] = () => {};
    },
  };
  return {
    timers,
    fire: () => callbacks.forEach((callback) => callback()),
  };
}

describe("ICE gathering", () => {
  test("resolves immediately when gathering is already complete", async () => {
    const pc = fakePeer();
    (pc as { iceGatheringState: string }).iceGatheringState = "complete";
    expect(await waitForIceGathering(pc)).toBe("complete");
  });

  test("resolves on the gathering-state transition", async () => {
    const pc = fakePeer();
    const pending = waitForIceGathering(pc, 2500);
    startGathering(pc, { gather: "complete" });
    expect(await pending).toBe("complete");
  });

  test("honours an end-of-candidates null candidate", async () => {
    const pc = fakePeer();
    const pending = waitForIceGathering(pc, 2500);
    startGathering(pc, { gather: "end-of-candidates" });
    expect(await pending).toBe("complete");
  });

  test("times out and restores the previous handlers", async () => {
    const { timers, fire } = manualTimers();
    const pc = fakePeer({ gather: "timeout" });
    const previous = () => {};
    pc.onicecandidate = previous;

    const pending = waitForIceGathering(pc, 2500, timers);
    fire();

    expect(await pending).toBe("timeout");
    expect(pc.onicecandidate).toBe(previous);
    expect(pc.onicegatheringstatechange).toBeNull();
  });
});

describe("negotiation order", () => {
  test("host creates the data channel before the offer and gathers", async () => {
    const calls: string[] = [];
    const pc = fakePeer({ gather: "complete" });
    const channel = pc.createDataChannel("parchis-v1");
    const originalCreate = pc.createDataChannel;
    pc.createDataChannel = (label) => {
      calls.push("channel");
      return originalCreate(label);
    };
    const originalLocal = pc.setLocalDescription;
    pc.setLocalDescription = async (description) => {
      calls.push("local");
      return originalLocal(description);
    };

    const result = await createHostOffer({
      pcFactory: () => pc,
      newId: () => "hostid12",
      gatherTimeoutMs: 100,
    });

    expect(calls).toEqual(["channel", "local"]);
    expect(result.gathered).toBe("complete");
    expect(result.description).toMatchObject({ id: "hostid12", kind: "offer" });
    expect(result.channel).toBe(channel);
  });

  test("guest answers an offer and ignores a duplicate answer", async () => {
    const pc = fakePeer({ gather: "complete" });
    const result = await acceptHostOffer(
      { id: "hostid12", kind: "offer", sdp: SDP },
      { pcFactory: () => pc },
    );

    expect(pc.remoteDescription).toMatchObject({ type: "offer", sdp: SDP });
    expect(result.description.kind).toBe("answer");
    expect(result.description.id).toBe("hostid12");

    await acceptHostAnswer(pc, result.description);
    const first = pc.remoteDescription;
    await acceptHostAnswer(pc, { id: "other", kind: "answer", sdp: "x" });
    expect(pc.remoteDescription).toBe(first);
  });
});

describe("ice servers and state mapping", () => {
  test("uses Cloudflare STUN only when online", () => {
    expect(selectIceServers({ online: true })).toEqual([
      { urls: "stun:stun.cloudflare.com:3478" },
    ]);
    expect(selectIceServers({ online: true, allowStun: false })).toEqual([]);
    expect(selectIceServers({ online: false })).toEqual([]);
  });

  test("maps every connection state", () => {
    expect(mapConnectionState("new")).toBe("idle");
    expect(mapConnectionState("connecting")).toBe("connecting");
    expect(mapConnectionState("connected")).toBe("connected");
    expect(mapConnectionState("disconnected")).toBe("reconnecting");
    expect(mapConnectionState("failed")).toBe("failed");
    expect(mapConnectionState("closed")).toBe("closed");
  });
});
