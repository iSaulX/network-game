import { describe, expect, test } from "bun:test";
import {
  acceptHostAnswer,
  acceptHostOffer,
  createHostOffer,
  decodePairing,
  encodePairing,
  joinPairingParts,
  mapConnectionState,
  measurePairing,
  PAIRING_PREFIX,
  QR_PART_MAX_CHARS,
  selectIceServers,
  splitPairing,
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
  "a=candidate:1 1 udp 2122260223 192.168.1.21 51235 typ host generation 0",
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
  timeoutMs?: number;
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

describe("pairing codes", () => {
  test("round-trips an offer", () => {
    const encoded = encodePairing({ id: "abc123", kind: "offer", sdp: SDP });
    expect(encoded.startsWith(`${PAIRING_PREFIX}:`)).toBeTrue();
    expect(decodePairing(encoded)).toEqual({
      ok: true,
      description: { id: "abc123", kind: "offer", sdp: SDP },
    });
  });

  test("rejects a foreign prefix, corruption, and oversized payloads", () => {
    expect(decodePairing("SOMETHING-ELSE:abc")).toMatchObject({
      ok: false,
      reason: "bad-prefix",
    });
    expect(decodePairing(`${PAIRING_PREFIX}:!!!!`)).toMatchObject({
      ok: false,
      reason: "bad-payload",
    });
    expect(
      decodePairing(`${PAIRING_PREFIX}:${"A".repeat(33 * 1024)}`),
    ).toMatchObject({ ok: false, reason: "too-large" });
  });

  test("splits a long code into parts of at most 300 characters and reassembles", () => {
    const longSdp = `${SDP}\r\n${"a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level\r\n".repeat(20)}`;
    const encoded = encodePairing({ id: "hostid12", kind: "offer", sdp: longSdp });
    const parts = splitPairing(encoded);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.text.length).toBeLessThanOrEqual(QR_PART_MAX_CHARS);
    }

    const joined = joinPairingParts(parts.map((part) => part.text));
    expect(joined).toMatchObject({ status: "complete" });
    if (joined.status === "complete") {
      expect(joined.text).toBe(encoded);
      expect(decodePairing(joined.text)).toMatchObject({ ok: true });
    }
  });

  test("tolerates out-of-order and duplicate parts", () => {
    const encoded = encodePairing({ id: "hostid12", kind: "offer", sdp: SDP.repeat(20) });
    const parts = splitPairing(encoded).map((part) => part.text);
    const shuffled = [parts[0]!, parts[0]!, ...parts.slice(1).reverse()];

    expect(joinPairingParts(shuffled)).toMatchObject({ status: "complete" });
  });

  test("reports missing parts and mixed pairing ids", () => {
    const first = splitPairing(
      encodePairing({ id: "aaaa1111", kind: "offer", sdp: SDP.repeat(20) }),
    ).map((part) => part.text);
    const second = splitPairing(
      encodePairing({ id: "bbbb2222", kind: "offer", sdp: SDP.repeat(20) }),
    ).map((part) => part.text);

    const one = joinPairingParts([first[0]!]);
    expect(one).toMatchObject({ status: "incomplete", total: first.length });
    if (one.status === "incomplete") {
      expect(one.missing).toContain(2);
    }

    expect(joinPairingParts([first[0]!, second[1]!])).toEqual({
      status: "conflict",
      reason: "mixed-ids",
    });
  });

  test("detects a tampered chunk via the checksum", () => {
    const encoded = encodePairing({ id: "hostid12", kind: "offer", sdp: SDP });
    const parts = splitPairing(encoded).map((part) => part.text);
    const tampered = parts.map((text, index) =>
      index === 0 ? text.replace(/.$/, "X") : text,
    );

    expect(joinPairingParts(tampered)).toEqual({
      status: "conflict",
      reason: "checksum",
    });
  });

  test("measures a real-shaped description within QR limits", () => {
    const measured = measurePairing({ id: "abcdefgh", kind: "offer", sdp: SDP });
    expect(measured.parts).toBeGreaterThanOrEqual(1);
    expect(measured.maxPartChars).toBeLessThanOrEqual(QR_PART_MAX_CHARS);
  });
});

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

  test("guest answers a decoded offer and ignores a duplicate answer", async () => {
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
