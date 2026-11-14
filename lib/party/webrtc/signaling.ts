/**
 * WebRTC peer setup for the online 1v1 mode.
 *
 * Signaling now travels over HTTP (`/api/versus`), so negotiation is still
 * non-trickle: each side waits for ICE gathering to finish (or a short
 * timeout) and sends a single complete description, which the server relays.
 * That keeps the server stateless per message and avoids a second transport.
 */
import type {
  DataChannelLike,
  PeerConnectionFactory,
  PeerConnectionLike,
  SessionDescriptionLike,
} from "./types";
import { DATA_CHANNEL_LABEL } from "../protocol";

export interface PairingDescription {
  readonly id: string;
  readonly kind: "offer" | "answer";
  readonly sdp: string;
}

export interface PairingTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultTimers: PairingTimers = {
  setTimeout: (callback, delayMs) =>
    globalThis.setTimeout(callback, delayMs) as unknown,
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
};

export const OFFLINE_ICE_SERVERS: readonly RTCIceServer[] = Object.freeze([]);
export const ONLINE_ICE_SERVERS: readonly RTCIceServer[] = Object.freeze([
  { urls: "stun:stun.cloudflare.com:3478" },
]);

/** STUN only when the device may have internet; an empty list is valid. */
export function selectIceServers(options: {
  online: boolean;
  allowStun?: boolean;
}): RTCIceServer[] {
  if (options.online && options.allowStun !== false) {
    return [...ONLINE_ICE_SERVERS];
  }
  return [...OFFLINE_ICE_SERVERS];
}

/**
 * Resolves when ICE gathering ends. A timeout is not an error: the caller uses
 * whatever `localDescription` already holds. Safari's end-of-candidates event
 * (`candidate === null`) is honoured as a fallback.
 */
export function waitForIceGathering(
  pc: PeerConnectionLike,
  timeoutMs = 2500,
  timers: PairingTimers = defaultTimers,
): Promise<"complete" | "timeout"> {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve("complete");
  }

  return new Promise((resolve) => {
    let settled = false;
    // Assigned after the handlers exist; `finish` may run before then.
    const timer: { handle: unknown } = { handle: undefined };

    const previousGathering = pc.onicegatheringstatechange;
    const previousCandidate = pc.onicecandidate;

    const finish = (result: "complete" | "timeout") => {
      if (settled) {
        return;
      }
      settled = true;
      timers.clearTimeout(timer.handle);
      pc.onicegatheringstatechange = previousGathering;
      pc.onicecandidate = previousCandidate;
      resolve(result);
    };

    pc.onicegatheringstatechange = () => {
      previousGathering?.();
      if (pc.iceGatheringState === "complete") {
        finish("complete");
      }
    };

    pc.onicecandidate = (event) => {
      previousCandidate?.(event);
      if (event.candidate === null) {
        finish("complete");
      }
    };

    const handle = timers.setTimeout(() => finish("timeout"), timeoutMs);
    timer.handle = handle;
  });
}

function localDescription(pc: PeerConnectionLike): SessionDescriptionLike {
  const description = pc.localDescription;

  if (!description || typeof description.sdp !== "string" || !description.sdp) {
    throw new Error("The peer connection has no local description.");
  }

  return { type: description.type, sdp: description.sdp };
}

export interface CreatePartnerOptions {
  readonly pcFactory: PeerConnectionFactory;
  readonly iceServers?: readonly RTCIceServer[];
  readonly gatherTimeoutMs?: number;
  readonly timers?: PairingTimers;
  readonly newId?: () => string;
}

function defaultPairingId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createHostOffer(
  options: CreatePartnerOptions,
): Promise<{
  readonly pc: PeerConnectionLike;
  readonly channel: ReturnType<PeerConnectionLike["createDataChannel"]>;
  readonly description: PairingDescription;
  readonly gathered: "complete" | "timeout";
}> {
  const pc = options.pcFactory({
    iceServers: [...(options.iceServers ?? OFFLINE_ICE_SERVERS)],
  });
  const channel = pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });

  await pc.setLocalDescription(await pc.createOffer());

  const gathered = await waitForIceGathering(
    pc,
    options.gatherTimeoutMs ?? 2500,
    options.timers,
  );
  const local = localDescription(pc);

  return {
    pc,
    channel,
    gathered,
    description: {
      id: (options.newId ?? defaultPairingId)(),
      kind: "offer",
      sdp: local.sdp as string,
    },
  };
}

export async function acceptHostOffer(
  offer: PairingDescription,
  options: Omit<CreatePartnerOptions, "newId">,
): Promise<{
  readonly pc: PeerConnectionLike;
  readonly description: PairingDescription;
  readonly gathered: "complete" | "timeout";
}> {
  const pc = options.pcFactory({
    iceServers: [...(options.iceServers ?? OFFLINE_ICE_SERVERS)],
  });

  await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
  await pc.setLocalDescription(await pc.createAnswer());

  const gathered = await waitForIceGathering(
    pc,
    options.gatherTimeoutMs ?? 2500,
    options.timers,
  );
  const local = localDescription(pc);

  return {
    pc,
    gathered,
    description: { id: offer.id, kind: "answer", sdp: local.sdp as string },
  };
}

export async function acceptHostAnswer(
  pc: PeerConnectionLike,
  answer: PairingDescription,
): Promise<void> {
  if (pc.remoteDescription) {
    // Duplicate or out-of-order signaling is ignored rather than fatal.
    return;
  }

  await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
}

/**
 * The guest has no channel of its own: it arrives through `ondatachannel` once
 * the host applies the answer. Rejects on timeout or a failed connection.
 */
export function waitForDataChannel(
  pc: PeerConnectionLike,
  timeoutMs = 20_000,
  timers: PairingTimers = defaultTimers,
): Promise<DataChannelLike> {
  return new Promise((resolve, reject) => {
    const previous = pc.ondatachannel;
    let settled = false;

    const cleanup = (handle: unknown) => {
      settled = true;
      timers.clearTimeout(handle);
      pc.ondatachannel = previous;
    };

    pc.ondatachannel = (event) => {
      if (settled) {
        return;
      }
      previous?.(event);
      cleanup(handle);
      resolve(event.channel);
    };

    const handle = timers.setTimeout(() => {
      if (settled) {
        return;
      }
      cleanup(handle);
      reject(new Error("Data channel timeout."));
    }, timeoutMs);
  });
}

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "closed";

export function mapConnectionState(
  state: PeerConnectionLike["connectionState"],
): ConnectionStatus {
  switch (state) {
    case "new":
      return "idle";
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "disconnected":
      return "reconnecting";
    case "failed":
      return "failed";
    case "closed":
      return "closed";
  }
}
