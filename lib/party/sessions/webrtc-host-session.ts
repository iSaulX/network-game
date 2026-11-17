import type {
  BonusMove,
  DieValue,
  GameEvent,
  GameState,
  Move,
} from "@/lib/parchis/types";
import { createGame } from "@/lib/parchis";
import { chooseBarrier, chooseBonusMove, chooseMove } from "../../bots/policy";
import {
  applyAction,
  createRateLimiter,
  cryptoDice,
  type AuthorityResult,
} from "../authority";
import {
  isBotId,
  isGuestId,
  PARTY_PROTOCOL_VERSION,
  type ClientAction,
  type GameMode,
  type LanPlayerInfo,
  type LanRoster,
  type PlayerId,
  type SeatConnection,
  type WireMessage,
} from "../protocol";
import {
  GameSession,
  SessionNotifier,
  type SessionSnapshot,
} from "../session";
import type { GameTransport, TransportKind } from "../transport";
import { buildConfigs, buildRoster, seatIdsFor } from "../seats";

/** A guest connection owned by the host. */
export interface HostPeer {
  readonly playerId: string;
  readonly transport: GameTransport;
}

export interface HostSessionOptions {
  /** The host's own seat. */
  readonly host: LanPlayerInfo;
  readonly mode: GameMode;
  /** Injected in tests; defaults to uniform crypto dice. */
  readonly rollDice?: () => [DieValue, DieValue];
  readonly rateLimit?: { readonly limit: number; readonly windowMs: number };
  readonly now?: () => number;
  /** Delay between two automatic bot actions, in ms. */
  readonly botDelayMs?: number;
  /** Injected in tests; defaults to `setTimeout`. */
  readonly schedule?: (run: () => void, delayMs: number) => unknown;
  readonly cancelSchedule?: (handle: unknown) => void;
}

interface PeerState {
  readonly playerId: string;
  readonly transport: GameTransport;
  info: LanPlayerInfo | null;
  readonly unsubscribe: () => void;
  readonly unsubscribeStatus: () => void;
}

/**
 * The authoritative peer. It owns the game state and version, opens one
 * transport per guest, applies both its own actions and guest intents through
 * the shared authority, and broadcasts every accepted state to everyone.
 *
 * The match starts only when the host calls `start()`; empty seats become bots
 * at that moment. Bots, and guests whose connection dropped mid-match, are
 * played by the host with the same policy as the offline mode.
 */
export class WebRTCHostSession extends GameSession {
  readonly playerId: string;
  readonly transportKind: TransportKind = "webrtc";

  private readonly host: LanPlayerInfo;
  private readonly mode: GameMode;
  private readonly drawDice: () => [DieValue, DieValue];
  private readonly allowAction: (key: string) => boolean;
  private readonly notifier = new SessionNotifier();
  private readonly peers = new Map<string, PeerState>();
  private readonly botDelayMs: number;
  private readonly schedule: (run: () => void, delayMs: number) => unknown;
  private readonly cancelSchedule: (handle: unknown) => void;

  private game: GameState | null = null;
  private version = 0;
  private status: SessionSnapshot["status"] = "idle";
  private error: SessionSnapshot["error"] = null;
  private events: readonly GameEvent[] = [];
  private lobby: readonly LanPlayerInfo[] = [];
  private emptySeats: readonly string[] = [];
  private connections: Readonly<Record<string, SeatConnection>> = {};
  private roster: LanRoster | null = null;
  private disconnected: readonly string[] = [];
  private disposed = false;
  private botTimer: unknown = null;

  constructor(options: HostSessionOptions) {
    super();
    this.host = { ...options.host, id: "host" };
    this.playerId = "host";
    this.mode = options.mode;
    this.drawDice = options.rollDice ?? cryptoDice();
    this.allowAction = createRateLimiter(
      options.rateLimit?.limit ?? 12,
      options.rateLimit?.windowMs ?? 1000,
      options.now,
    );
    this.botDelayMs = options.botDelayMs ?? 700;
    this.schedule =
      options.schedule ??
      ((run, delayMs) => globalThis.setTimeout(run, delayMs));
    this.cancelSchedule =
      options.cancelSchedule ??
      ((handle) => globalThis.clearTimeout(handle as number));
    this.lobby = [this.host];
  }

  get snapshot(): SessionSnapshot {
    return {
      state: this.game,
      version: this.version,
      status: this.status,
      events: this.events,
      error: this.error,
      lobby: this.lobby,
      emptySeats: this.emptySeats,
      roster: this.roster,
      disconnected: this.disconnected,
      mode: this.mode,
      connections: this.connections,
    };
  }

  subscribe(listener: Parameters<GameSession["subscribe"]>[0]): () => void {
    return this.notifier.subscribe(listener);
  }

  /**
   * Connects a guest transport. Call it once per seat as soon as the guest's
   * direct connection is up; the seat joins the lobby after its HELLO.
   */
  joinPeer(peer: HostPeer): void {
    if (this.disposed || this.peers.has(peer.playerId)) {
      return;
    }

    const unsubscribe = peer.transport.subscribe((message) => {
      this.receive(peer.playerId, message);
    });

    const unsubscribeStatus = peer.transport.subscribeStatus((next) => {
      if (next === "failed" || next === "closed") {
        this.handlePeerGone(peer.playerId);
      }
    });

    this.peers.set(peer.playerId, {
      playerId: peer.playerId,
      transport: peer.transport,
      info: null,
      unsubscribe,
      unsubscribeStatus,
    });

    const onOpen = () => {
      this.status = "connected";
      this.notifier.emit(this.snapshot);
    };

    if (peer.transport.status === "open") {
      onOpen();
    } else {
      peer.transport.subscribeStatus((next) => {
        if (next === "open") {
          onOpen();
        }
      });

      void peer.transport.connect().catch(() => {
        this.handlePeerGone(peer.playerId);
      });
    }
  }

  /** Drops a guest seat (the guest left the lobby, or its channel failed). */
  removePeer(playerId: string): void {
    this.handlePeerGone(playerId);
  }

  /**
   * Leaves an unoccupied seat empty (no bot) or fills it with a bot again.
   * Only guest seats can change, a human who already holds the seat keeps it,
   * and the room always keeps at least two seats for the engine.
   */
  setSeatEmpty(seatId: string, empty: boolean): void {
    if (this.disposed || this.game) {
      return;
    }

    const seats = seatIdsFor(this.mode);

    if (seatId === "host" || !seats.includes(seatId as PlayerId)) {
      return;
    }

    if (empty && this.lobby.some((player) => player.id === seatId)) {
      // A connected guest holds that seat; it cannot be emptied.
      return;
    }

    const next = empty
      ? [...new Set([...this.emptySeats, seatId])]
      : this.emptySeats.filter((item) => item !== seatId);

    // At least two seats must remain for the match to start.
    if (seats.length - next.length < 2) {
      return;
    }

    const unchanged =
      next.length === this.emptySeats.length &&
      next.every((item) => this.emptySeats.includes(item));

    if (unchanged) {
      return;
    }

    this.emptySeats = next;
    this.broadcastLobby();
    this.notifier.emit(this.snapshot);
  }

  /**
   * Records the ICE path a seat is using. The host learns each guest's pair
   * from its own peer connection and broadcasts the map so every screen shows
   * the same connection mode under each player.
   */
  setSeatConnection(seatId: string, connection: SeatConnection): void {
    if (this.disposed) {
      return;
    }

    if (seatId !== "host" && !isGuestId(seatId)) {
      return;
    }

    const previous = this.connections[seatId];

    if (
      previous &&
      previous.transport === connection.transport &&
      previous.candidate === connection.candidate
    ) {
      return;
    }

    this.connections = { ...this.connections, [seatId]: connection };
    this.broadcastConnections();
    this.notifier.emit(this.snapshot);
  }

  /** Starts the match. Empty seats become bots; nobody has to wait. */
  start(): void {
    if (this.disposed || this.game) {
      return;
    }

    this.roster = buildRoster(this.mode, this.lobby, this.emptySeats);
    this.game = createGame(buildConfigs(this.roster, this.mode));
    this.version = 0;
    this.status = "connected";
    this.error = null;
    this.events = [];
    this.disconnected = [];

    this.broadcastStart();
    this.scheduleBotIfNeeded();
    this.notifier.emit(this.snapshot);
  }

  roll(): void {
    this.act({ type: "ROLL" }, this.playerId);
  }

  move(move: Move): void {
    this.act({ type: "MOVE", move }, this.playerId);
  }

  bonusMove(move: BonusMove): void {
    this.act({ type: "BONUS_MOVE", move }, this.playerId);
  }

  chooseBarrier(progress: number): void {
    this.act({ type: "CHOOSE_BARRIER", progress }, this.playerId);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearBotTimer();

    if (this.game) {
      // Tell every guest the match is over before the channels disappear.
      for (const peer of this.peers.values()) {
        try {
          peer.transport.send({
            type: "BYE",
            protocol: PARTY_PROTOCOL_VERSION,
            reason: "host-closed",
          });
        } catch {
          // The channel may already be gone; closing below is enough.
        }
      }
    }

    for (const peer of this.peers.values()) {
      peer.unsubscribe();
      peer.unsubscribeStatus();
      peer.transport.close();
    }
    this.peers.clear();
    this.notifier.clear();
    this.status = "closed";
  }

  // -- internals -----------------------------------------------------------

  private act(action: ClientAction, actorId: string): void {
    if (!this.game || this.status !== "connected" || this.disposed) {
      return;
    }

    this.applyAndBroadcast(action, actorId);
  }

  private applyAndBroadcast(action: ClientAction, actorId: string): boolean {
    if (!this.game) {
      return false;
    }

    const result = applyAction(
      {
        state: this.game,
        version: this.version,
        actorId,
        action,
      },
      this.drawDice,
    );

    if (!result.ok) {
      return false;
    }

    this.commit(result);
    this.broadcastState();
    this.scheduleBotIfNeeded();

    return true;
  }

  private commit(result: Extract<AuthorityResult, { ok: true }>): void {
    this.game = result.state;
    this.version = result.version;
    this.events = result.events;
    this.error = null;
    this.notifier.emit(this.snapshot);
  }

  private receive(playerId: string, message: WireMessage): void {
    if (this.disposed) {
      return;
    }

    if (!this.peers.has(playerId)) {
      return;
    }

    if (message.type === "HELLO") {
      this.handleHello(playerId, message.player);
      return;
    }

    if (message.type !== "ACTION") {
      return;
    }

    if (!this.game) {
      this.sendTo(playerId, {
        type: "ERROR",
        protocol: PARTY_PROTOCOL_VERSION,
        version: this.version,
        code: "NOT_READY",
        message: "The match has not started yet.",
      });
      return;
    }

    if (!this.allowAction(playerId)) {
      this.sendTo(playerId, {
        type: "ERROR",
        protocol: PARTY_PROTOCOL_VERSION,
        version: this.version,
        code: "RATE_LIMITED",
        message: "Too many actions.",
      });
      return;
    }

    if (message.version !== this.version) {
      this.sendTo(playerId, {
        type: "ERROR",
        protocol: PARTY_PROTOCOL_VERSION,
        version: this.version,
        code: "STALE_VERSION",
        message: "The game state moved on.",
        state: this.game,
      });
      return;
    }

    const result = applyAction(
      {
        state: this.game,
        version: this.version,
        actorId: playerId,
        action: message.action,
        expectedVersion: message.version,
      },
      this.drawDice,
    );

    if (!result.ok) {
      this.sendTo(playerId, {
        type: "ERROR",
        protocol: PARTY_PROTOCOL_VERSION,
        version: this.version,
        code: result.code,
        message: result.message,
        state: this.game,
      });
      return;
    }

    this.commit(result);
    this.broadcastState();
    this.scheduleBotIfNeeded();
  }

  private handleHello(playerId: string, player: LanPlayerInfo): void {
    const peer = this.peers.get(playerId);

    if (!peer) {
      return;
    }

    peer.info = { ...player, id: playerId as LanPlayerInfo["id"] };
    this.refreshLobby();

    if (this.game) {
      // A late HELLO after the start: bring the guest up to date.
      this.sendTo(playerId, {
        type: "START",
        protocol: PARTY_PROTOCOL_VERSION,
        version: this.version,
        mode: this.mode,
        roster: this.roster ?? buildRoster(this.mode, this.lobby, this.emptySeats),
        state: this.game,
      });
    } else {
      this.broadcastLobby();
    }

    // A late guest needs the connection map too, not only the lobby.
    this.sendTo(playerId, {
      type: "CONNECTION",
      protocol: PARTY_PROTOCOL_VERSION,
      connections: this.connections,
    });

    this.notifier.emit(this.snapshot);
  }

  private refreshLobby(): void {
    if (this.game) {
      return;
    }

    const guests = [...this.peers.values()]
      .map((peer) => peer.info)
      .filter((info): info is LanPlayerInfo => info !== null)
      .sort((a, b) => a.id.localeCompare(b.id));

    this.lobby = [this.host, ...guests];

    // A human who takes a seat the host had left empty now occupies it.
    const occupied = new Set<string>(this.lobby.map((player) => player.id));
    const remaining = this.emptySeats.filter((seat) => !occupied.has(seat));
    if (remaining.length !== this.emptySeats.length) {
      this.emptySeats = remaining;
    }
  }

  private handlePeerGone(playerId: string): void {
    const peer = this.peers.get(playerId);

    if (!peer) {
      return;
    }

    this.peers.delete(playerId);
    peer.unsubscribe();
    peer.unsubscribeStatus();

    if (playerId in this.connections) {
      const next = { ...this.connections };
      delete next[playerId];
      this.connections = next;
      this.broadcastConnections();
    }

    if (this.game && this.game.players.some((item) => item.id === playerId)) {
      // Mid-match loss: the seat stays, but the host plays for it.
      if (!this.disconnected.includes(playerId)) {
        this.disconnected = [...this.disconnected, playerId];
      }
      this.scheduleBotIfNeeded();
    } else {
      this.refreshLobby();
      if (!this.game) {
        this.broadcastLobby();
      }
    }

    this.notifier.emit(this.snapshot);
  }

  private clearBotTimer(): void {
    if (this.botTimer !== null) {
      this.cancelSchedule(this.botTimer);
      this.botTimer = null;
    }
  }

  private isAutomated(playerId: string): boolean {
    return isBotId(playerId) || this.disconnected.includes(playerId);
  }

  /** Schedules one policy action when the current seat is not a human guest. */
  private scheduleBotIfNeeded(): void {
    this.clearBotTimer();

    if (!this.game || this.game.phase === "finished" || this.disposed) {
      return;
    }

    const current = this.game.players[this.game.currentPlayerIndex];

    if (!current || !this.isAutomated(current.id)) {
      return;
    }

    const playerId = current.id;
    this.botTimer = this.schedule(() => {
      this.botTimer = null;
      this.runBotStep(playerId);
    }, this.botDelayMs);
  }

  private runBotStep(playerId: string): void {
    if (!this.game || this.disposed || this.game.phase === "finished") {
      return;
    }

    const current = this.game.players[this.game.currentPlayerIndex];

    if (!current || current.id !== playerId) {
      this.scheduleBotIfNeeded();
      return;
    }

    switch (this.game.phase) {
      case "awaiting-roll":
        this.applyAndBroadcast({ type: "ROLL" }, playerId);
        return;
      case "awaiting-move": {
        const move = chooseMove(this.game, playerId);
        if (move) {
          this.applyAndBroadcast({ type: "MOVE", move }, playerId);
        }
        return;
      }
      case "awaiting-bonus": {
        const move = chooseBonusMove(this.game, playerId);
        if (move) {
          this.applyAndBroadcast({ type: "BONUS_MOVE", move }, playerId);
        }
        return;
      }
      case "awaiting-barrier": {
        const progress = chooseBarrier(this.game, playerId);
        if (progress !== null) {
          this.applyAndBroadcast(
            { type: "CHOOSE_BARRIER", progress },
            playerId,
          );
        }
        return;
      }
      default:
        return;
    }
  }

  private broadcastLobby(): void {
    const message: WireMessage = {
      type: "LOBBY",
      protocol: PARTY_PROTOCOL_VERSION,
      mode: this.mode,
      players: this.lobby,
      emptySeats: this.emptySeats,
    };

    for (const peer of this.peers.values()) {
      this.sendRaw(peer, message);
    }
  }

  private broadcastConnections(): void {
    const message: WireMessage = {
      type: "CONNECTION",
      protocol: PARTY_PROTOCOL_VERSION,
      connections: this.connections,
    };

    for (const peer of this.peers.values()) {
      this.sendRaw(peer, message);
    }
  }

  private broadcastStart(): void {
    if (!this.game || !this.roster) {
      return;
    }

    const message: WireMessage = {
      type: "START",
      protocol: PARTY_PROTOCOL_VERSION,
      version: this.version,
      mode: this.mode,
      roster: this.roster,
      state: this.game,
    };

    for (const peer of this.peers.values()) {
      this.sendRaw(peer, message);
    }
  }

  private broadcastState(): void {
    if (!this.game) {
      return;
    }

    const message: WireMessage = {
      type: "STATE",
      protocol: PARTY_PROTOCOL_VERSION,
      version: this.version,
      state: this.game,
      events: this.events,
    };

    for (const peer of this.peers.values()) {
      this.sendRaw(peer, message);
    }
  }

  private sendTo(playerId: string, message: WireMessage): void {
    const peer = this.peers.get(playerId);

    if (peer) {
      this.sendRaw(peer, message);
    }
  }

  private sendRaw(peer: PeerState, message: WireMessage): void {
    try {
      peer.transport.send(message);
    } catch {
      this.handlePeerGone(peer.playerId);
    }
  }
}
