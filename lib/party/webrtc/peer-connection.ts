"use client";

import {
  decodeWireMessage,
  encodeWireMessage,
  MAX_WIRE_CHARS,
  type WireMessage,
} from "../protocol";
import type { GameTransport, TransportStatus } from "../transport";
import { mapConnectionState, type ConnectionStatus } from "./signaling";
import type { DataChannelLike, PeerConnectionLike } from "./types";

/** Refuse to stack messages while a peer is not draining the channel. */
const MAX_BUFFERED_BYTES = 1_000_000;

export interface WebRTCTransportOptions {
  readonly pc: PeerConnectionLike;
  readonly channel: DataChannelLike;
}

export interface WebRTCTransport extends GameTransport {
  /** Reacts to connection loss without closing the data channel. */
  subscribeConnection(
    listener: (status: ConnectionStatus) => void,
  ): () => void;
}

/**
 * Wraps an `RTCPeerConnection` + one data channel as a `GameTransport`.
 * Only string messages are accepted in either direction.
 */
export function createWebRTCTransport(
  options: WebRTCTransportOptions,
): WebRTCTransport {
  const { pc, channel } = options;

  const messageListeners = new Set<(message: WireMessage) => void>();
  const statusListeners = new Set<(status: TransportStatus) => void>();
  const connectionListeners = new Set<(status: ConnectionStatus) => void>();
  const queue: string[] = [];

  let status: TransportStatus =
    channel.readyState === "open" ? "open" : "connecting";
  let connection: ConnectionStatus = mapConnectionState(pc.connectionState);

  const setStatus = (next: TransportStatus) => {
    if (status === next) {
      return;
    }
    status = next;
    for (const listener of statusListeners) {
      listener(next);
    }
  };

  const setConnection = (next: ConnectionStatus) => {
    if (connection === next) {
      return;
    }
    connection = next;
    for (const listener of connectionListeners) {
      listener(next);
    }
  };

  const flush = () => {
    while (queue.length > 0 && channel.readyState === "open") {
      const text = queue.shift();
      if (text !== undefined) {
        channel.send(text);
      }
    }
  };

  channel.onopen = () => {
    setStatus("open");
    flush();
  };

  channel.onclose = () => {
    setStatus("closed");
  };

  channel.onerror = () => {
    setStatus("failed");
  };

  channel.onmessage = (event) => {
    if (typeof event.data !== "string" || event.data.length > MAX_WIRE_CHARS) {
      return;
    }

    const decoded = decodeWireMessage(event.data);

    if (!decoded.ok) {
      return;
    }

    for (const listener of messageListeners) {
      listener(decoded.message);
    }
  };

  pc.onconnectionstatechange = () => {
    setConnection(mapConnectionState(pc.connectionState));
  };

  return {
    kind: "webrtc",
    get status() {
      return status;
    },
    async connect() {
      if (channel.readyState === "open") {
        setStatus("open");
        flush();
        return;
      }

      setStatus("connecting");

      await new Promise<void>((resolve, reject) => {
        const unsubscribe = this.subscribeStatus((next) => {
          if (next === "open") {
            unsubscribe();
            resolve();
          } else if (next === "failed" || next === "closed") {
            unsubscribe();
            reject(new Error("The connection could not be established."));
          }
        });
      });
    },
    send(message) {
      if (status !== "open" || channel.readyState !== "open") {
        if (queue.length >= 32) {
          throw new Error("The transport queue is full.");
        }
        queue.push(encodeWireMessage(message));
        return;
      }

      if (channel.bufferedAmount > MAX_BUFFERED_BYTES) {
        throw new Error("The peer is not draining the data channel.");
      }

      channel.send(encodeWireMessage(message));
    },
    subscribe(listener) {
      messageListeners.add(listener);
      return () => {
        messageListeners.delete(listener);
      };
    },
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    subscribeConnection(listener) {
      connectionListeners.add(listener);
      return () => {
        connectionListeners.delete(listener);
      };
    },
    close() {
      queue.length = 0;
      channel.onopen = null;
      channel.onmessage = null;
      channel.onclose = null;
      channel.onerror = null;
      pc.onconnectionstatechange = null;

      try {
        channel.close();
      } catch {
        // Already closed.
      }

      try {
        pc.close();
      } catch {
        // Already closed.
      }

      setStatus("closed");
      setConnection("closed");
    },
  };
}
