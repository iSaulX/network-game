import { describe, expect, test } from "bun:test";
import { getLegalBonusMoves, getLegalMoves } from "@/lib/parchis";
import { mulberry32 } from "@/lib/parchis/test-helpers";
import { createMemoryTransportPair } from "../transport";
import type { GameTransport } from "../transport";
import { createWebRTCTransport } from "../webrtc/peer-connection";
import type { DataChannelLike, PeerConnectionLike } from "../webrtc/types";
import {
  DEFAULT_GUEST_INFO,
  DEFAULT_HOST_INFO,
  createLanRoster,
} from "@/components/lan/roster";
import { WebRTCHostSession } from "./webrtc-host-session";
import { WebRTCGuestSession } from "./webrtc-guest-session";
import type { GameSession } from "../session";

const roster = createLanRoster(DEFAULT_HOST_INFO, DEFAULT_GUEST_INFO);

/** Seeded dice so a whole match is deterministic. */
function seededDice(seed = 11) {
  const random = mulberry32(seed);
  return (): [1 | 2 | 3 | 4 | 5 | 6, 1 | 2 | 3 | 4 | 5 | 6] => {
    const draw = () => (Math.floor(random() * 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
    return [draw(), draw()];
  };
}

interface Pair {
  readonly host: WebRTCHostSession;
  readonly guest: WebRTCGuestSession;
  readonly transport: ReturnType<typeof createMemoryTransportPair>;
}

function connectPair(seed = 11): Pair {
  const transport = createMemoryTransportPair();
  const host = new WebRTCHostSession({
    transport: transport.host,
    roster,
    rollDice: seededDice(seed),
    // A synchronous test loop acts far faster than a human; the production
    // limit is exercised in its own test below.
    rateLimit: { limit: 100_000, windowMs: 1000 },
  });
  const guest = new WebRTCGuestSession({
    transport: transport.guest,
    player: DEFAULT_GUEST_INFO,
  });

  host.start();
  guest.connect();
  return { host, guest, transport };
}

/** Plays the current player's turn on whichever side owns it. */
function playOneStep(
  host: WebRTCHostSession,
  guest: WebRTCGuestSession,
): boolean {
  const state = host.snapshot.state;
  if (!state || state.phase === "finished") {
    return false;
  }

  const current = state.players[state.currentPlayerIndex];
  if (!current) {
    return false;
  }

  const session: GameSession = current.id === "host" ? host : guest;

  switch (state.phase) {
    case "awaiting-roll":
      session.roll();
      break;
    case "awaiting-move": {
      const move = getLegalMoves(state)[0];
      if (!move) throw new Error("No legal move.");
      session.move(move);
      break;
    }
    case "awaiting-bonus": {
      const move = getLegalBonusMoves(state)[0];
      if (!move) throw new Error("No legal bonus.");
      session.bonusMove(move);
      break;
    }
    case "awaiting-barrier":
      session.chooseBarrier(state.barrierChoice!.squares[0]!);
      break;
  }

  return true;
}

function playToEnd(host: WebRTCHostSession, guest: WebRTCGuestSession) {
  let steps = 0;

  while (playOneStep(host, guest) && steps < 5000) {
    steps += 1;
  }

  expect(steps).toBeLessThan(5000);
  return steps;
}

describe("WEBRTC sessions", () => {
  test("host starts the match on HELLO and both sides agree", () => {
    const { host, guest } = connectPair();
    const guestSnapshot = guest.snapshot;

    expect(host.snapshot.status).toBe("connected");
    expect(host.snapshot.state).not.toBeNull();
    expect(guestSnapshot.state).not.toBeNull();
    expect(guestSnapshot.roster).toEqual(roster);
    expect(guestSnapshot.version).toBe(host.snapshot.version);
    expect(guestSnapshot.state?.players.map((player) => player.color)).toEqual([
      "yellow",
      "green",
    ]);
    // Board red/yellow maps to those engine colours.
    expect(guestSnapshot.state?.players.map((player) => player.id)).toEqual([
      "host",
      "guest",
    ]);
  });

  test("plays a full match to a win with identical state on both sides", () => {
    const { host, guest } = connectPair();
    playToEnd(host, guest);

    const hostSnapshot = host.snapshot;
    const guestSnapshot = guest.snapshot;

    expect(hostSnapshot.state?.phase).toBe("finished");
    expect(hostSnapshot.state?.winnerId).toBeTruthy();
    expect(guestSnapshot.state).toEqual(hostSnapshot.state!);
    expect(guestSnapshot.version).toBe(hostSnapshot.version);
    expect(guestSnapshot.state?.log).toEqual(hostSnapshot.state?.log);
  });

  test("the guest never rolls dice and cannot start", () => {
    const { host, guest } = connectPair();
    expect(() => guest.start()).toThrow();

    const before = host.snapshot.state!;
    expect(before.phase).toBe("awaiting-roll");
    // Host moves first, so a guest ROLL is rejected without touching state.
    guest.roll();
    expect(host.snapshot.state).toBe(before);
    expect(host.snapshot.version).toBe(0);
    expect(guest.snapshot.error?.code).toBe("NOT_YOUR_TURN");
    expect(guest.snapshot.state).toEqual(before);
  });

  test("a stale guest version is rejected without touching the host state", () => {
    const { host, guest, transport } = connectPair();
    let state = host.snapshot.state!;

    // Get the turn to the guest so only the version can be wrong.
    while (state.players[state.currentPlayerIndex]!.id !== "guest") {
      host.roll();
      state = host.snapshot.state!;
      if (state.phase === "awaiting-move") {
        host.move(getLegalMoves(state)[0]!);
        state = host.snapshot.state!;
      }
    }

    const before = host.snapshot.state!;
    const version = host.snapshot.version;

    // Bypass the guest session to forge a stale action on the wire.
    transport.guest.send({
      type: "ACTION",
      protocol: 1,
      version: version - 1,
      action: { type: "ROLL" },
      requestId: "stale-1",
    });

    expect(host.snapshot.state).toBe(before);
    expect(host.snapshot.version).toBe(version);
    expect(guest.snapshot.error?.code).toBe("STALE_VERSION");
  });

  test("rate limiting rejects a burst of guest actions", () => {
    const transport = createMemoryTransportPair();
    const host = new WebRTCHostSession({
      transport: transport.host,
      roster,
      rollDice: seededDice(),
      rateLimit: { limit: 3, windowMs: 60_000 },
      now: () => 1000,
    });
    const guest = new WebRTCGuestSession({
      transport: transport.guest,
      player: DEFAULT_GUEST_INFO,
    });
    host.start();
    guest.connect();

    // Drive the turn to the guest, then burst more actions than the limit.
    let state = host.snapshot.state!;
    while (state.players[state.currentPlayerIndex]!.id !== "guest") {
      host.roll();
      state = host.snapshot.state!;
      if (state.phase === "awaiting-move") {
        host.move(getLegalMoves(state)[0]!);
        state = host.snapshot.state!;
      }
    }

    for (let index = 0; index < 6; index += 1) {
      guest.roll();
    }

    expect(guest.snapshot.error?.code).toBe("RATE_LIMITED");
  });

  test("disconnecting the transport leaves both sessions terminal", () => {
    const { host, guest, transport } = connectPair();
    transport.disconnect();

    expect(host.snapshot.status).toBe("failed");
    expect(guest.snapshot.status).toBe("failed");
  });

  test("disposing the host fails the guest", () => {
    const { host, guest } = connectPair();
    host.dispose();

    expect(host.snapshot.status).toBe("closed");
    expect(guest.snapshot.status).toBe("disconnected");
  });

  test("start before a guest arrives leaves the host connected with no game", () => {
    const transport = createMemoryTransportPair();
    const host = new WebRTCHostSession({ transport: transport.host, roster });
    host.start();

    expect(host.snapshot.status).toBe("connected");
    expect(host.snapshot.state).toBeNull();
  });
});

interface FakePair {
  readonly host: GameTransport;
  readonly guest: GameTransport;
  /** Opens both data channels, flushing anything queued meanwhile. */
  open(): void;
}

/** Two WebRTC transports wired to each other with no network in between. */
function createFakeWebRTCPair(): FakePair {
  // The structural interfaces declare `readyState` readonly; the fake needs to
  // mutate it, so it keeps its own mutable view of the same object.
  const makeChannel = () => {
    const channel = {
      label: "parchis-v1",
      readyState: "connecting" as DataChannelLike["readyState"],
      bufferedAmount: 0,
      send: (data: string) => {
        void data;
      },
      close: () => {
        channel.readyState = "closed";
      },
      onopen: null as (() => void) | null,
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onclose: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    return channel;
  };

  const makePeer = (): PeerConnectionLike => ({
    iceGatheringState: "complete",
    connectionState: "connected",
    localDescription: null,
    remoteDescription: null,
    onicecandidate: null,
    onicegatheringstatechange: null,
    onconnectionstatechange: null,
    ondatachannel: null,
    createDataChannel: makeChannel,
    createOffer: async () => ({ type: "offer", sdp: "" }),
    createAnswer: async () => ({ type: "answer", sdp: "" }),
    async setLocalDescription() {},
    async setRemoteDescription() {},
    async addIceCandidate() {},
    close() {},
  });

  const hostChannel = makeChannel();
  const guestChannel = makeChannel();

  // Wire each channel's send into the other's message handler.
  hostChannel.send = (data: string) => guestChannel.onmessage?.({ data });
  guestChannel.send = (data: string) => hostChannel.onmessage?.({ data });

  const host = createWebRTCTransport({ pc: makePeer(), channel: hostChannel });
  const guest = createWebRTCTransport({ pc: makePeer(), channel: guestChannel });

  return {
    host,
    guest,
    open() {
      hostChannel.readyState = "open";
      guestChannel.readyState = "open";
      hostChannel.onopen?.();
      guestChannel.onopen?.();
    },
  };
}

/**
 * The same intent sequence must produce identical results whether it travels
 * through the synchronous memory pair or the WebRTC transport.
 */
describe("transport independence", () => {
  function runOn(
    hostTransport: GameTransport,
    guestTransport: GameTransport,
    open: () => void = () => {},
  ) {
    const host = new WebRTCHostSession({
      transport: hostTransport,
      roster,
      rollDice: seededDice(5),
      rateLimit: { limit: 100_000, windowMs: 1000 },
    });
    const guest = new WebRTCGuestSession({
      transport: guestTransport,
      player: DEFAULT_GUEST_INFO,
    });

    host.start();
    guest.connect();
    open();
    playToEnd(host, guest);

    return {
      host: host.snapshot.state,
      guest: guest.snapshot.state,
      version: host.snapshot.version,
      log: host.snapshot.state?.log,
    };
  }

  test("memory and WebRTC transports agree step for step", () => {
    const pair = createMemoryTransportPair();
    const memory = runOn(pair.host, pair.guest);

    const webrtc = createFakeWebRTCPair();
    const overWebRTC = runOn(webrtc.host, webrtc.guest, webrtc.open);

    expect(memory.guest).toEqual(memory.host);
    expect(memory.host?.phase).toBe("finished");
    expect(overWebRTC).toEqual(memory);
  });
});
