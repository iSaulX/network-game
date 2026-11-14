import { describe, expect, test } from "bun:test";
import {
  acceptHostAnswer,
  acceptHostOffer,
  createHostOffer,
  waitForDataChannel,
} from "../webrtc/signaling";
import type {
  DataChannelLike,
  PeerConnectionLike,
  SessionDescriptionLike,
} from "../webrtc/types";
import { createWebRTCTransport } from "../webrtc/peer-connection";
import { WebRTCHostSession } from "./webrtc-host-session";
import { WebRTCGuestSession } from "./webrtc-guest-session";
import { createMemoryTransportPair } from "../transport";
import {
  decodeDescription,
  encodeDescription,
} from "../versus/description";
import { createVersusServer } from "@/lib/server/versus/rooms";
import { VersusSignalingClient } from "../versus/signaling-client";

function fakeChannel(label = "parchis-v1"): DataChannelLike {
  return {
    label,
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

function fakePeer(sdp: string): PeerConnectionLike {
  const pc: PeerConnectionLike = {
    iceGatheringState: "new",
    connectionState: "new",
    localDescription: null,
    remoteDescription: null,
    onicecandidate: null,
    onicegatheringstatechange: null,
    onconnectionstatechange: null,
    ondatachannel: null,
    createDataChannel: () => fakeChannel(),
    createOffer: async () => ({ type: "offer", sdp }),
    createAnswer: async () => ({ type: "answer", sdp }),
    async setLocalDescription(description: SessionDescriptionLike) {
      (pc as { localDescription: unknown }).localDescription = description;
      (pc as { iceGatheringState: string }).iceGatheringState = "complete";
    },
    async setRemoteDescription(description: SessionDescriptionLike) {
      (pc as { remoteDescription: unknown }).remoteDescription = description;
    },
    async addIceCandidate() {},
    close() {},
  };
  return pc;
}

/** An in-memory fetch that implements the `/api/versus` contract. */
function serverFetch(server: ReturnType<typeof createVersusServer>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : String(input),
      "http://localhost",
    );
    const token = (new Headers(init?.headers).get("Authorization") ?? "").replace(
      "Bearer ",
      "",
    );

    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}"));

      switch (body.action) {
        case "signal": {
          const sent = server.send(
            { code: body.code, id: body.id, token: body.token },
            body.kind,
            body.payload,
            body.to ?? null,
          );
          return sent.ok
            ? Response.json({ ok: true, ...sent.value })
            : Response.json({ ok: false }, { status: 401 });
        }
        case "leave":
          server.leave(body);
          return Response.json({ ok: true });
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

    return Response.json({ ok: true, ...(polled.ok ? polled.value : {}) });
  }) as typeof fetch;
}

describe("versus negotiation over the HTTP relay", () => {
  test("exchanges JSON-encoded SDP descriptions between two clients", async () => {
    let counter = 0;
    const server = createVersusServer({ newRoomCode: () => `ROOM${++counter}` });
    const fetcher = serverFetch(server);

    const created = server.create(2);
    const joined = server.join(created.ok ? created.value.code : "");
    if (!created.ok || !joined.ok) throw new Error("room");

    const hostClient = new VersusSignalingClient(created.value, { fetcher });
    const guestClient = new VersusSignalingClient(joined.value, { fetcher });

    const hostPc = fakePeer("HOST-SDP");
    const guestPc = fakePeer("GUEST-SDP");

    const offer = await createHostOffer({
      pcFactory: () => hostPc,
      newId: () => "hostid",
      gatherTimeoutMs: 10,
    });
    // Every offer is addressed to one seat: the host opens one channel each.
    await hostClient.send(
      "offer",
      encodeDescription(offer.description),
      joined.value.id,
    );

    const guestPoll = await guestClient.poll();
    if (!guestPoll.ok) throw new Error("poll");
    const offerSignal = guestPoll.value.signals.find(
      (signal) => signal.kind === "offer",
    )!;
    const offerText = offerSignal.payload;

    expect(decodeDescription(offerText)).toEqual({
      kind: "offer",
      id: "hostid",
      sdp: "HOST-SDP",
    });
    // Tampered or foreign payloads never reach `RTCPeerConnection`.
    expect(decodeDescription("not json")).toBeNull();
    expect(decodeDescription(JSON.stringify({ kind: "offer", id: "x" })))
      .toBeNull();

    const answer = await acceptHostOffer(
      { kind: "offer", id: "hostid", sdp: "HOST-SDP" },
      { pcFactory: () => guestPc, gatherTimeoutMs: 10 },
    );
    expect(guestPc.remoteDescription).toMatchObject({ sdp: "HOST-SDP" });

    await guestClient.send(
      "answer",
      encodeDescription(answer.description),
      "host",
    );

    const hostPoll = await hostClient.poll();
    if (!hostPoll.ok) throw new Error("poll");
    const answerSignal = hostPoll.value.signals.find(
      (signal) => signal.kind === "answer",
    )!;
    expect(JSON.parse(answerSignal.payload)).toMatchObject({
      kind: "answer",
      sdp: "GUEST-SDP",
    });

    await acceptHostAnswer(hostPc, answer.description);
    expect(hostPc.remoteDescription).toMatchObject({ sdp: "GUEST-SDP" });
  });
});

describe("versus transport independence", () => {
  test("the same sessions run over the in-memory transport", async () => {
    const pair = createMemoryTransportPair();

    const guestInfo = {
      id: "guest-1" as const,
      name: "Luis",
      avatar: "/pictures/octupus.png",
    };

    const host = new WebRTCHostSession({
      host: { id: "host", name: "Ana", avatar: "/pictures/dog.png" },
      mode: "1v1",
      rollDice: () => [3, 4],
      rateLimit: { limit: 100_000, windowMs: 1000 },
    });
    host.joinPeer({ playerId: "guest-1", transport: pair.host });

    const guest = new WebRTCGuestSession({
      transport: pair.guest,
      playerId: "guest-1",
      player: guestInfo,
    });

    guest.connect();
    // The host decides when the match starts.
    expect(host.snapshot.state).toBeNull();
    expect(guest.snapshot.state).toBeNull();

    host.start();

    expect(host.snapshot.state).not.toBeNull();
    expect(guest.snapshot.state).not.toBeNull();
    expect(guest.snapshot.roster?.players.map((item) => item.id)).toEqual([
      "host",
      "guest-1",
    ]);

    host.dispose();
    guest.dispose();
  });

  test("the WebRTC helpers keep their structural contract", () => {
    const channel = fakeChannel();
    expect(channel.label).toBe("parchis-v1");
    expect(typeof waitForDataChannel).toBe("function");
    expect(typeof createWebRTCTransport).toBe("function");
  });
});
