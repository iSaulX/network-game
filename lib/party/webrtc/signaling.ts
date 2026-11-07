/**
 * WebRTC peer setup with non-trickle ICE.
 *
 * A manual pairing step cannot stream candidates, so both descriptions are
 * complete when they are shown: each side waits for ICE gathering to finish
 * (or a short timeout) and embeds its candidates in the SDP.
 */
import { fnv1aHex, packJson, unpackJson } from "./encoding";
import type {
  DataChannelLike,
  PeerConnectionFactory,
  PeerConnectionLike,
  SessionDescriptionLike,
} from "./types";
import { DATA_CHANNEL_LABEL } from "../protocol";

export const PAIRING_PREFIX = "PARCHIS-LAN-1";

/** Target size of one QR part. Keeps QR versions comfortably scannable. */
export const QR_PART_MAX_CHARS = 300;

export interface PairingDescription {
  readonly id: string;
  readonly kind: "offer" | "answer";
  readonly sdp: string;
}

export interface PairingPart {
  readonly id: string;
  readonly index: number;
  readonly total: number;
  readonly text: string;
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

export type PairingFailureReason =
  | "bad-prefix"
  | "bad-payload"
  | "unsupported-version"
  | "too-large";

export type DecodedPairing =
  | { readonly ok: true; readonly description: PairingDescription }
  | { readonly ok: false; readonly reason: PairingFailureReason };

const PAIRING_VERSION = 1;

export function encodePairing(description: PairingDescription): string {
  return `${PAIRING_PREFIX}:${packJson({
    v: PAIRING_VERSION,
    k: description.kind,
    i: description.id,
    s: description.sdp,
  })}`;
}

export function decodePairing(text: string): DecodedPairing {
  const clean = text.trim();
  const head = `${PAIRING_PREFIX}:`;

  if (!clean.startsWith(head)) {
    return { ok: false, reason: "bad-prefix" };
  }

  const payloadText = clean.slice(head.length);

  if (payloadText.length > 32 * 1024) {
    return { ok: false, reason: "too-large" };
  }

  let payload: unknown;

  try {
    payload = unpackJson(payloadText);
  } catch {
    return { ok: false, reason: "bad-payload" };
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return { ok: false, reason: "bad-payload" };
  }

  const record = payload as Record<string, unknown>;

  if (record.v !== PAIRING_VERSION) {
    return { ok: false, reason: "unsupported-version" };
  }

  if (
    (record.k !== "offer" && record.k !== "answer") ||
    typeof record.i !== "string" ||
    record.i.length === 0 ||
    record.i.length > 32 ||
    typeof record.s !== "string" ||
    record.s.length === 0 ||
    record.s.length > 20_000
  ) {
    return { ok: false, reason: "bad-payload" };
  }

  return {
    ok: true,
    description: { id: record.i, kind: record.k, sdp: record.s },
  };
}

/**
 * Cuts one encoded pairing code into numbered parts, each carrying the pairing
 * id and a checksum so scans can be reassembled in any order.
 * Format: `PARCHIS-LAN-1.<id8>.<i>.<n>.<fnv8>.<chunk>`
 */
export function splitPairing(
  text: string,
  maxChars = QR_PART_MAX_CHARS,
): PairingPart[] {
  const decoded = decodePairing(text);

  if (!decoded.ok) {
    throw new Error("Cannot split an invalid pairing code.");
  }

  const id = decoded.description.id.slice(0, 8);
  const checksum = fnv1aHex(text);
  const overhead = PAIRING_PREFIX.length + id.length + checksum.length + 16;
  const chunkSize = Math.max(32, maxChars - overhead);
  const total = Math.max(1, Math.ceil(text.length / chunkSize));
  const parts: PairingPart[] = [];

  for (let index = 0; index < total; index += 1) {
    const chunk = text.slice(index * chunkSize, (index + 1) * chunkSize);
    parts.push({
      id,
      index,
      total,
      text: `${PAIRING_PREFIX}.${id}.${index + 1}.${total}.${checksum}.${chunk}`,
    });
  }

  return parts;
}

export type JoinedParts =
  | {
      readonly status: "incomplete";
      readonly id: string;
      readonly seen: number;
      readonly total: number;
      readonly missing: readonly number[];
    }
  | { readonly status: "complete"; readonly id: string; readonly text: string }
  | {
      readonly status: "conflict";
      readonly reason: "mixed-ids" | "bad-part" | "checksum";
    };

interface ParsedPart {
  readonly id: string;
  readonly index: number;
  readonly total: number;
  readonly checksum: string;
  readonly chunk: string;
}

function parsePart(text: string): ParsedPart | null {
  const clean = text.trim();
  const head = `${PAIRING_PREFIX}.`;

  if (!clean.startsWith(head)) {
    return null;
  }

  const fields = clean.slice(head.length).split(".");

  if (fields.length !== 5) {
    return null;
  }

  const [id, indexText, totalText, checksum, chunk] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  const index = Number(indexText);
  const total = Number(totalText);

  if (
    !/^[A-Za-z0-9_-]{1,16}$/.test(id) ||
    !Number.isInteger(index) ||
    !Number.isInteger(total) ||
    index < 1 ||
    total < 1 ||
    index > total ||
    !/^[0-9a-f]{8}$/.test(checksum) ||
    chunk.length === 0
  ) {
    return null;
  }

  return { id, index, total, checksum, chunk };
}

/**
 * Reassembles scanned/pasted parts. Duplicates are idempotent and parts may
 * arrive in any order; parts from two different pairings are a conflict.
 */
export function joinPairingParts(
  parts: readonly string[],
): JoinedParts {
  const parsed = new Map<number, ParsedPart>();
  let id: string | null = null;
  let total = 0;

  for (const raw of parts) {
    const part = parsePart(raw);

    if (!part) {
      return { status: "conflict", reason: "bad-part" };
    }

    if (id === null) {
      id = part.id;
      total = part.total;
    } else if (part.id !== id) {
      return { status: "conflict", reason: "mixed-ids" };
    }

    if (part.total !== total) {
      return { status: "conflict", reason: "bad-part" };
    }

    const existing = parsed.get(part.index);

    if (existing && existing.chunk !== part.chunk) {
      return { status: "conflict", reason: "bad-part" };
    }

    parsed.set(part.index, part);
  }

  if (id === null || total === 0) {
    return { status: "incomplete", id: "", seen: 0, total: 0, missing: [] };
  }

  const missing: number[] = [];

  for (let index = 1; index <= total; index += 1) {
    if (!parsed.has(index)) {
      missing.push(index);
    }
  }

  if (missing.length > 0) {
    return { status: "incomplete", id, seen: parsed.size, total, missing };
  }

  let text = "";
  let checksum = "";

  for (let index = 1; index <= total; index += 1) {
    const part = parsed.get(index);
    if (!part) {
      return { status: "incomplete", id, seen: parsed.size, total, missing: [index] };
    }
    text += part.chunk;
    checksum = part.checksum;
  }

  if (fnv1aHex(text) !== checksum) {
    return { status: "conflict", reason: "checksum" };
  }

  return { status: "complete", id, text };
}

export function measurePairing(description: PairingDescription): {
  encodedChars: number;
  parts: number;
  maxPartChars: number;
} {
  const encoded = encodePairing(description);
  const parts = splitPairing(encoded);

  return {
    encodedChars: encoded.length,
    parts: parts.length,
    maxPartChars: Math.max(...parts.map((part) => part.text.length)),
  };
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
