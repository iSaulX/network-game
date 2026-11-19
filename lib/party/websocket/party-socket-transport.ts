/**
 * Browser transport for the server-authoritative party socket.
 *
 * One WebSocket per client. It authenticates with the room credentials, sends
 * `HELLO`/`ACTION` messages through the existing `GameTransport` surface, and
 * reconnects with backoff. Vercel closes a function's sockets when it reaches
 * its maximum duration, so reconnection is part of normal play, not an error:
 * the server keeps the game in Redis and replays a snapshot after AUTH.
 */
import {
  PARTY_PROTOCOL_VERSION,
  decodeWireMessage,
  encodeWireMessage,
  type LanPlayerInfo,
  type WireMessage,
} from "../protocol";
import type {
  GameTransport,
  TransportKind,
  TransportStatus,
} from "../transport";
import {
  SOCKET_PROTOCOL_VERSION,
  type AuthFailureCode,
  type PartyControlMessage,
} from "./messages";

export const DEFAULT_HEARTBEAT_MS = 10_000;
export const DEFAULT_AUTH_TIMEOUT_MS = 8_000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;

export class PartySocketError extends Error {
  constructor(
    readonly code: AuthFailureCode | "timeout",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PartySocketError";
  }
}

export interface PartySocketTransportOptions {
  readonly code: string;
  readonly id: string;
  readonly token: string;
  readonly player: LanPlayerInfo;
  readonly url?: string;
  readonly socketFactory?: (url: string) => WebSocket;
  readonly heartbeatMs?: number;
  readonly authTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  /** Tests disable this to keep the transport deterministic. */
  readonly reconnectOnClose?: boolean;
}

/** Same-origin on Vercel; the local Bun server on development hosts. */
export function partySocketUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_PARTY_WS_URL;

  if (explicit) {
    return explicit;
  }

  if (typeof window === "undefined") {
    return "";
  }

  const { protocol, hostname, host } = window.location;
  const secure = protocol === "https:";
  const local =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]";

  if (local) {
    return `${secure ? "wss" : "ws"}://${hostname}:3001`;
  }

  return `${secure ? "wss" : "ws"}://${host}/api/party/socket`;
}

type MessageListener = (message: WireMessage) => void;
type StatusListener = (status: TransportStatus) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A control message the transport can send once authenticated. */
export type OutgoingControlMessage = PartyControlMessage;

export class PartySocketTransport implements GameTransport {
  readonly kind: TransportKind = "websocket";

  private readonly options: Required<
    Pick<
      PartySocketTransportOptions,
      "authTimeoutMs" | "connectTimeoutMs" | "heartbeatMs" | "reconnectOnClose"
    >
  > &
    PartySocketTransportOptions;
  private readonly url: string;
  private readonly messages = new Set<MessageListener>();
  private readonly statuses = new Set<StatusListener>();
  private readonly controlQueue: string[] = [];

  private socket: WebSocket | null = null;
  private statusValue: TransportStatus = "idle";
  private opened = false;
  private disposed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectPromise: Promise<void> | null = null;
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((error: Error) => void) | null = null;

  constructor(options: PartySocketTransportOptions) {
    this.options = {
      ...options,
      authTimeoutMs: options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS,
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      heartbeatMs: options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
      reconnectOnClose: options.reconnectOnClose ?? true,
    };
    this.url = options.url ?? partySocketUrl();
  }

  get status(): TransportStatus {
    return this.statusValue;
  }

  connect(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new PartySocketError("bad-request", "closed"));
    }

    if (this.statusValue === "open") {
      return Promise.resolve();
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
      this.connectTimer = setTimeout(() => {
        this.connectTimer = null;
        this.failTerminal(new PartySocketError("timeout"));
      }, this.options.connectTimeoutMs);
      this.openSocket();
    });

    return this.connectPromise;
  }

  send(message: WireMessage): void {
    const socket = this.socket;

    if (!this.opened || !socket || socket.readyState !== 1) {
      // The session sends HELLO again after every reconnect, so dropping an
      // action while the socket is down is safer than replaying it stale.
      return;
    }

    try {
      socket.send(encodeWireMessage(message));
    } catch {
      try {
        socket.close(1011, "send-failed");
      } catch {
        // The close event schedules the reconnect.
      }
    }
  }

  sendControl(message: OutgoingControlMessage): void {
    if (this.disposed) {
      return;
    }

    const socket = this.socket;
    const text = JSON.stringify(message);

    if (!this.opened || !socket || socket.readyState !== 1) {
      // A host START or an intentional LEAVE may be requested while the
      // socket is reconnecting; replay it once AUTH succeeds.
      if (this.controlQueue.length < 8) {
        this.controlQueue.push(text);
      }
      return;
    }

    try {
      socket.send(text);
    } catch {
      try {
        socket.close(1011, "send-failed");
      } catch {
        // The close event schedules the reconnect.
      }
    }
  }

  subscribe(listener: MessageListener): () => void {
    this.messages.add(listener);
    return () => {
      this.messages.delete(listener);
    };
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statuses.add(listener);
    return () => {
      this.statuses.delete(listener);
    };
  }

  close(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.opened = false;
    this.controlQueue.length = 0;
    this.clearTimers();

    const socket = this.socket;
    this.socket = null;

    if (socket) {
      try {
        socket.close(1000, "client-close");
      } catch {
        // Already closing.
      }
    }

    this.setStatus("closed");
  }

  private setStatus(next: TransportStatus): void {
    if (this.statusValue === next) {
      return;
    }

    this.statusValue = next;
    for (const listener of this.statuses) {
      listener(next);
    }
  }

  private openSocket(): void {
    if (this.disposed) {
      return;
    }

    if (!this.url) {
      this.failTerminal(new PartySocketError("bad-request", "Missing socket URL."));
      return;
    }

    let socket: WebSocket;

    try {
      socket = (this.options.socketFactory ?? ((url) => new WebSocket(url)))(
        this.url,
      );
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    this.opened = false;
    this.setStatus("connecting");

    socket.onopen = () => {
      if (this.socket !== socket || this.disposed) {
        return;
      }

      socket.send(
        JSON.stringify({
          type: "AUTH",
          protocol: PARTY_PROTOCOL_VERSION,
          code: this.options.code,
          id: this.options.id,
          token: this.options.token,
          player: this.options.player,
        } satisfies PartyControlMessage),
      );

      this.authTimer = setTimeout(() => {
        if (this.socket === socket && !this.opened) {
          this.authTimer = null;
          try {
            socket.close(1008, "auth-timeout");
          } catch {
            // The close event handles the retry.
          }
        }
      }, this.options.authTimeoutMs);
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket || this.disposed) {
        return;
      }

      this.receive(event.data);
    };

    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
      this.opened = false;
      this.clearTimers();

      if (this.disposed) {
        return;
      }

      if (this.statusValue !== "failed") {
        this.setStatus("connecting");
      }

      if (this.options.reconnectOnClose) {
        this.scheduleReconnect();
      }
    };

    socket.onerror = () => {
      // The close event follows and owns the retry.
    };
  }

  private receive(raw: unknown): void {
    const text = typeof raw === "string" ? raw : String(raw);
    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }

    if (isRecord(parsed) && parsed.type === "AUTH_OK") {
      this.opened = true;
      this.reconnectAttempts = 0;

      if (this.authTimer !== null) {
        clearTimeout(this.authTimer);
        this.authTimer = null;
      }

      if (this.connectTimer !== null) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }

      this.startHeartbeat();
      this.setStatus("open");

      // The session sends HELLO synchronously from the status listener, so
      // queued controls go after it.
      while (this.controlQueue.length > 0) {
        const text = this.controlQueue.shift();

        if (text !== undefined) {
          try {
            this.socket?.send(text);
          } catch {
            break;
          }
        }
      }

      this.resolveConnect?.();
      this.resolveConnect = null;
      this.rejectConnect = null;
      return;
    }

    if (isRecord(parsed) && parsed.type === "AUTH_ERROR") {
      const code =
        typeof parsed.code === "string"
          ? (parsed.code as AuthFailureCode)
          : "bad-request";
      this.failTerminal(new PartySocketError(code));
      return;
    }

    const decoded = decodeWireMessage(text);

    if (!decoded.ok) {
      if (decoded.code === "PROTOCOL_MISMATCH") {
        this.failTerminal(new PartySocketError("bad-request", decoded.message));
      }
      return;
    }

    for (const listener of this.messages) {
      listener(decoded.message);
    }

    // The server ended the room. Reconnecting would only receive the same
    // auth rejection, so stop instead of retrying.
    if (decoded.message.type === "BYE") {
      this.failTerminal(new PartySocketError("room-closed"));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendControl({
        type: "PING",
        protocol: SOCKET_PROTOCOL_VERSION,
      });
    }, this.options.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat();

    if (this.authTimer !== null) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) {
      return;
    }

    const attempt = Math.min(this.reconnectAttempts, 5);
    const delay =
      Math.min(8_000, 400 * 2 ** attempt) + Math.floor(Math.random() * 250);
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private failTerminal(error: PartySocketError): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.opened = false;
    this.controlQueue.length = 0;
    this.clearTimers();

    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    const socket = this.socket;
    this.socket = null;

    if (socket) {
      try {
        socket.close(1008, "auth-failed");
      } catch {
        // Already closing.
      }
    }

    this.setStatus("failed");
    this.rejectConnect?.(error);
    this.resolveConnect = null;
    this.rejectConnect = null;
  }
}
