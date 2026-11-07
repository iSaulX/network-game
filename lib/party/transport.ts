/**
 * Transport abstraction. The host and guest sessions never touch WebRTC
 * directly: they send and receive `WireMessage` values over a `GameTransport`.
 * The in-memory pair below proves transport independence in tests.
 */
import {
  decodeWireMessage,
  encodeWireMessage,
  type WireMessage,
} from "./protocol";

export type TransportStatus =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "failed";

export type TransportKind = "memory" | "webrtc";

/** Outbound messages are queued while connecting, up to this many. */
const MAX_QUEUED_MESSAGES = 32;

type MessageListener = (message: WireMessage) => void;
type StatusListener = (status: TransportStatus) => void;

export interface GameTransport {
  readonly kind: TransportKind;
  readonly status: TransportStatus;
  connect(): Promise<void>;
  send(message: WireMessage): void;
  subscribe(listener: MessageListener): () => void;
  subscribeStatus(listener: StatusListener): () => void;
  close(): void;
}

export interface MemoryTransportPair {
  readonly host: GameTransport;
  readonly guest: GameTransport;
  /** Simulates the peer connection dropping for both ends. */
  disconnect(): void;
}

interface End {
  status: TransportStatus;
  readonly queue: WireMessage[];
  readonly messages: Set<MessageListener>;
  readonly statuses: Set<StatusListener>;
}

function createEnd(): End {
  return {
    status: "idle",
    queue: [],
    messages: new Set(),
    statuses: new Set(),
  };
}

function setStatus(end: End, next: TransportStatus): void {
  if (end.status === next) {
    return;
  }

  end.status = next;

  for (const listener of end.statuses) {
    listener(next);
  }
}

function deliver(end: End, message: WireMessage): void {
  for (const listener of end.messages) {
    listener(message);
  }
}

function buildTransport(
  self: End,
  peer: End,
  onClose: () => void,
): GameTransport {
  const flush = () => {
    while (self.queue.length > 0 && peer.status === "open") {
      const message = self.queue.shift();
      if (message) {
        deliver(peer, message);
      }
    }
  };

  return {
    kind: "memory",
    get status() {
      return self.status;
    },
    async connect() {
      setStatus(self, "open");
      flush();
    },
    send(message) {
      // Validate exactly like the network path so tests cannot pass a shape
      // the real transport would reject.
      if (!decodeWireMessage(encodeWireMessage(message)).ok) {
        throw new Error("Invalid transport message.");
      }

      if (self.status === "closed" || self.status === "failed") {
        return;
      }

      if (self.status === "open" && peer.status === "open") {
        deliver(peer, message);
        return;
      }

      if (self.queue.length >= MAX_QUEUED_MESSAGES) {
        throw new Error("The transport queue is full.");
      }

      self.queue.push(message);
    },
    subscribe(listener) {
      self.messages.add(listener);
      return () => {
        self.messages.delete(listener);
      };
    },
    subscribeStatus(listener) {
      self.statuses.add(listener);
      return () => {
        self.statuses.delete(listener);
      };
    },
    close() {
      self.queue.length = 0;
      setStatus(self, "closed");
      onClose();
    },
  };
}

/** Two ends wired together. Delivery is synchronous and deterministic. */
export function createMemoryTransportPair(): MemoryTransportPair {
  const hostEnd = createEnd();
  const guestEnd = createEnd();

  const host = buildTransport(hostEnd, guestEnd, () => {});
  const guest = buildTransport(guestEnd, hostEnd, () => {});

  return {
    host,
    guest,
    disconnect() {
      hostEnd.queue.length = 0;
      guestEnd.queue.length = 0;
      setStatus(hostEnd, "failed");
      setStatus(guestEnd, "failed");
    },
  };
}
