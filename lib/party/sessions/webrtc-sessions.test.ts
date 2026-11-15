import { describe, expect, test } from "bun:test";
import { getLegalBonusMoves, getLegalMoves } from "@/lib/parchis";
import { mulberry32 } from "@/lib/parchis/test-helpers";
import { createMemoryTransportPair } from "../transport";
import type { GameTransport } from "../transport";
import { createWebRTCTransport } from "../webrtc/peer-connection";
import type { DataChannelLike, PeerConnectionLike } from "../webrtc/types";
import {
  PARTY_PROTOCOL_VERSION,
  type GameMode,
  type LanPlayerInfo,
} from "../protocol";
import { engineColorOf } from "../seats";
import { WebRTCHostSession } from "./webrtc-host-session";
import { WebRTCGuestSession } from "./webrtc-guest-session";
import type { GameSession } from "../session";

const HOST: LanPlayerInfo = { id: "host", name: "Ana", avatar: "/pictures/dog.png" };

const GUESTS: readonly LanPlayerInfo[] = [
  { id: "guest-1", name: "Bruno", avatar: "/pictures/octupus.png" },
  { id: "guest-2", name: "Carla", avatar: "/pictures/chicken.png" },
  { id: "guest-3", name: "Diego", avatar: "/pictures/bee.png" },
];

/** Seeded dice so a whole match is deterministic. */
function seededDice(seed = 11) {
  const random = mulberry32(seed);
  return (): [1 | 2 | 3 | 4 | 5 | 6, 1 | 2 | 3 | 4 | 5 | 6] => {
    const draw = () => (Math.floor(random() * 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
    return [draw(), draw()];
  };
}

/** A controllable stand-in for `setTimeout` used by the bot scheduler. */
function createScheduler() {
  const queue: { run: () => void }[] = [];

  return {
    schedule(run: () => void): unknown {
      const handle = { run };
      queue.push(handle);
      return handle;
    },
    cancel(handle: unknown): void {
      const index = queue.indexOf(handle as { run: () => void });
      if (index !== -1) {
        queue.splice(index, 1);
      }
    },
    /** Runs every pending step, including the ones they schedule. */
    drain(): void {
      let guard = 0;
      while (queue.length > 0 && guard < 10_000) {
        guard += 1;
        queue.shift()!.run();
      }
    },
  };
}

interface Room {
  readonly host: WebRTCHostSession;
  readonly guests: readonly WebRTCGuestSession[];
  readonly scheduler: ReturnType<typeof createScheduler>;
  /** Guest transports, indexed by seat. */
  readonly pairs: readonly ReturnType<typeof createMemoryTransportPair>[];
}

/**
 * Builds a host and one direct transport per guest, mirroring the production
 * star topology: each guest only talks to the host.
 */
function openRoom(mode: GameMode, guestCount: number, seed = 11): Room {
  const scheduler = createScheduler();
  const host = new WebRTCHostSession({
    host: HOST,
    mode,
    rollDice: seededDice(seed),
    botDelayMs: 0,
    schedule: (run) => scheduler.schedule(run),
    cancelSchedule: (handle) => scheduler.cancel(handle),
    // A synchronous test loop acts far faster than a human.
    rateLimit: { limit: 100_000, windowMs: 1000 },
  });

  const pairs = [];
  const guests = [];

  for (let index = 0; index < guestCount; index += 1) {
    const pair = createMemoryTransportPair();
    const info = GUESTS[index]!;
    pairs.push(pair);
    host.joinPeer({ playerId: info.id, transport: pair.host });

    const guest = new WebRTCGuestSession({
      transport: pair.guest,
      playerId: info.id,
      player: info,
    });
    guests.push(guest);
    guest.connect();
  }

  return { host, guests, scheduler, pairs };
}

/** Plays the current player's turn on whichever seat owns it. */
function playOneStep(room: Room): boolean {
  const state = room.host.snapshot.state;
  if (!state || state.phase === "finished") {
    return false;
  }

  const current = state.players[state.currentPlayerIndex];
  if (!current) {
    return false;
  }

  const byId = new Map<string, GameSession>(
    room.guests
      .filter((guest) => !room.host.snapshot.disconnected.includes(guest.playerId))
      .map((guest) => [guest.playerId, guest] as const),
  );
  const session = current.id === "host" ? room.host : byId.get(current.id);

  if (!session) {
    // A seat the host plays for (a bot or a dropped guest).
    room.scheduler.drain();
    const next = room.host.snapshot.state;
    if (!next || next.players[next.currentPlayerIndex]?.id === current.id) {
      return false;
    }
    return true;
  }

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

function playToEnd(room: Room): number {
  let steps = 0;

  while (playOneStep(room) && steps < 20_000) {
    steps += 1;
  }

  expect(steps).toBeLessThan(20_000);
  return steps;
}

describe("party sessions", () => {
  test("the lobby lists the host and each guest that says hello", () => {
    const room = openRoom("all", 2);

    expect(room.host.snapshot.state).toBeNull();
    expect(room.host.snapshot.lobby.map((player) => player.id)).toEqual([
      "host",
      "guest-1",
      "guest-2",
    ]);
    // A guest can see the other humans in the lobby in real time.
    expect(
      room.guests[1]!.snapshot.lobby.map((player) => player.id),
    ).toEqual(["host", "guest-1", "guest-2"]);
  });

  test("only the host starts; the roster fills empty seats with bots", () => {
    const room = openRoom("all", 1);

    expect(() => room.guests[0]!.start()).toThrow();
    expect(room.host.snapshot.state).toBeNull();

    room.host.start();

    const roster = room.guests[0]!.snapshot.roster!;
    expect(roster.players.map((player) => player.id)).toEqual([
      "host",
      "guest-1",
      "bot-blue",
      "bot-green",
    ]);
    expect(roster.players.map((player) => engineColorOf(player.id))).toEqual([
      "yellow",
      "green",
      "blue",
      "red",
    ]);
    expect(room.guests[0]!.snapshot.mode).toBe("all");
  });

  test("a 1v1 room seats two players with no bots left over", () => {
    const room = openRoom("1v1", 1);
    room.host.start();

    expect(
      room.guests[0]!.snapshot.roster?.players.map((player) => player.id),
    ).toEqual(["host", "guest-1"]);
    expect(room.host.snapshot.mode).toBe("1v1");
    expect(room.guests[0]!.snapshot.state?.players).toHaveLength(2);
    // Host and guest take opposite corners: board red and green, not yellow.
    expect(
      room.guests[0]!.snapshot.roster?.players.map((player) =>
        engineColorOf(player.id, "1v1"),
      ),
    ).toEqual(["yellow", "red"]);
  });

  test("the host can leave seats empty instead of filling them with bots", () => {
    const room = openRoom("all", 1);

    room.host.setSeatEmpty("guest-2", true);
    room.host.setSeatEmpty("guest-3", true);

    expect(room.host.snapshot.emptySeats).toEqual(["guest-2", "guest-3"]);
    // Guests learn the choice before the match starts.
    expect(room.guests[0]!.snapshot.emptySeats).toEqual([
      "guest-2",
      "guest-3",
    ]);

    room.host.start();

    expect(
      room.guests[0]!.snapshot.roster?.players.map((player) => player.id),
    ).toEqual(["host", "guest-1"]);
    expect(room.guests[0]!.snapshot.state?.players).toHaveLength(2);
    // The room keeps its "all" colours even with only two seats.
    expect(room.guests[0]!.snapshot.mode).toBe("all");
  });

  test("empty seats never shrink the table below two players", () => {
    const room = openRoom("all", 1);

    room.host.setSeatEmpty("guest-1", true);
    room.host.setSeatEmpty("guest-2", true);
    room.host.setSeatEmpty("guest-3", true);

    // A connected guest's seat is never emptied; the other two are.
    expect(room.host.snapshot.emptySeats).toEqual(["guest-2", "guest-3"]);

    room.host.start();
    expect(room.host.snapshot.state?.players).toHaveLength(2);
  });

  test("the host cannot empty every rival seat", () => {
    const room = openRoom("all", 0);

    // With no guests, three of the four seats could be emptied; the room keeps
    // two seats so the engine can start.
    room.host.setSeatEmpty("guest-1", true);
    room.host.setSeatEmpty("guest-2", true);
    room.host.setSeatEmpty("guest-3", true);

    expect(room.host.snapshot.emptySeats).toHaveLength(2);

    room.host.start();
    expect(room.host.snapshot.state?.players).toHaveLength(2);
  });

  test("a four-human match plays to a win with identical state everywhere", () => {
    const room = openRoom("all", 3);
    room.host.start();

    playToEnd(room);

    const finished = room.host.snapshot.state!;
    expect(finished.phase).toBe("finished");
    expect(finished.winnerId).toBeTruthy();

    for (const guest of room.guests) {
      expect(guest.snapshot.state).toEqual(finished);
      expect(guest.snapshot.version).toBe(room.host.snapshot.version);
    }
  });

  test("an empty seat is played by the host until the match ends", () => {
    const room = openRoom("1v1", 0);
    room.host.start();

    // A 1v1 seat on the opposite corner, so an empty guest seat is the green bot.
    expect(
      room.host.snapshot.roster?.players.map((player) => player.id),
    ).toEqual(["host", "bot-green"]);

    playToEnd(room);
    expect(room.host.snapshot.state?.phase).toBe("finished");
  });

  test("the guest cannot roll out of turn", () => {
    const room = openRoom("1v1", 1);
    room.host.start();

    const hostState = room.host.snapshot.state!;
    expect(hostState.players[hostState.currentPlayerIndex]?.id).toBe("host");

    room.guests[0]!.roll();

    expect(room.host.snapshot.state).toBe(hostState);
    expect(room.host.snapshot.version).toBe(0);
    expect(room.guests[0]!.snapshot.error?.code).toBe("NOT_YOUR_TURN");
  });

  test("a stale version is rejected without touching the host state", () => {
    const room = openRoom("1v1", 1);
    room.host.start();

    // Move the state on so the guest's forged version is a valid, older one.
    room.host.roll();
    const before = room.host.snapshot.state!;
    const version = room.host.snapshot.version;
    expect(version).toBeGreaterThan(0);

    room.pairs[0]!.guest.send({
      type: "ACTION",
      protocol: PARTY_PROTOCOL_VERSION,
      version: version - 1,
      action: { type: "ROLL" },
      requestId: "stale-1",
    });

    expect(room.host.snapshot.state).toBe(before);
    expect(room.host.snapshot.version).toBe(version);
    expect(room.guests[0]!.snapshot.error?.code).toBe("STALE_VERSION");
  });

  test("rate limiting rejects a burst of guest actions", () => {
    const pair = createMemoryTransportPair();
    const host = new WebRTCHostSession({
      host: HOST,
      mode: "1v1",
      rollDice: seededDice(),
      rateLimit: { limit: 3, windowMs: 60_000 },
      now: () => 1000,
      schedule: () => null,
      cancelSchedule: () => {},
    });
    host.joinPeer({ playerId: "guest-1", transport: pair.host });

    const guest = new WebRTCGuestSession({
      transport: pair.guest,
      playerId: "guest-1",
      player: GUESTS[0]!,
    });
    guest.connect();
    host.start();

    // Drive the turn to the guest, then burst more actions than the limit.
    let state = host.snapshot.state!;
    while (state.players[state.currentPlayerIndex]!.id !== "guest-1") {
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

  test("a guest leaving the lobby removes it without ending the room", () => {
    const room = openRoom("all", 2);
    const pair = room.pairs[1]!;

    // Dropping the channel makes the host free the seat.
    pair.disconnect();

    expect(room.host.snapshot.lobby.map((player) => player.id)).toEqual([
      "host",
      "guest-1",
    ]);
    expect(room.host.snapshot.state).toBeNull();
  });

  test("a guest dropping mid-match leaves its seat to the host", () => {
    const room = openRoom("1v1", 1);
    room.host.start();

    room.pairs[0]!.disconnect();

    expect(room.host.snapshot.disconnected).toEqual(["guest-1"]);
    expect(room.host.snapshot.state).not.toBeNull();
    // The host finishes the match for the dropped seat.
    playToEnd(room);
    expect(room.host.snapshot.state?.phase).toBe("finished");
  });

  test("disposing the host disconnects every guest", () => {
    const room = openRoom("all", 2);
    room.host.start();
    room.host.dispose();

    expect(room.host.snapshot.status).toBe("closed");
    for (const guest of room.guests) {
      expect(guest.snapshot.status).toBe("disconnected");
    }
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
      host: HOST,
      mode: "1v1",
      rollDice: seededDice(5),
      rateLimit: { limit: 100_000, windowMs: 1000 },
      schedule: () => null,
      cancelSchedule: () => {},
    });
    host.joinPeer({ playerId: "guest-1", transport: hostTransport });

    const guest = new WebRTCGuestSession({
      transport: guestTransport,
      playerId: "guest-1",
      player: GUESTS[0]!,
    });

    open();
    guest.connect();
    host.start();

    const room: Room = { host, guests: [guest], scheduler: createScheduler(), pairs: [] };
    playToEnd(room);

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
