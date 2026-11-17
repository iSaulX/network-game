/**
 * Reads which ICE path a peer connection actually selected.
 *
 * `getStats()` exposes the nominated candidate pair; each side's candidate
 * type tells the player whether the link is a direct LAN connection (`host`),
 * a NAT traversal through STUN (`srflx`/`prflx`) or a TURN relay (`relay`).
 * The UI shows this under each player so a fallback to TURN is visible.
 */
import type { IceCandidateType } from "../protocol";
import type { PeerConnectionLike } from "./types";

export interface SelectedCandidatePair {
  /** Candidate type of this device. */
  readonly local: IceCandidateType;
  /** Candidate type of the remote peer. */
  readonly remote: IceCandidateType;
}

type StatRecord = Record<string, unknown>;

const CANDIDATE_TYPES = new Set<string>([
  "host",
  "srflx",
  "prflx",
  "relay",
]);

function normalize(value: unknown): IceCandidateType {
  return typeof value === "string" && CANDIDATE_TYPES.has(value)
    ? (value as IceCandidateType)
    : "unknown";
}

function readRecord(value: unknown): StatRecord | null {
  return typeof value === "object" && value !== null
    ? (value as StatRecord)
    : null;
}

/** Snapshot of every stat report, keyed by `id`. */
function collectStats(report: {
  forEach(callback: (entry: unknown) => void): void;
}): Map<string, StatRecord> {
  const byId = new Map<string, StatRecord>();

  report.forEach((entry) => {
    const record = readRecord(entry);

    if (record && typeof record.id === "string") {
      byId.set(record.id, record);
    }
  });

  return byId;
}

function selectedPair(byId: Map<string, StatRecord>): StatRecord | null {
  // Chromium exposes the chosen pair on the transport report.
  for (const record of byId.values()) {
    if (
      record.type === "transport" &&
      typeof record.selectedCandidatePairId === "string"
    ) {
      const pair = byId.get(record.selectedCandidatePairId);

      if (pair) {
        return pair;
      }
    }
  }

  // Firefox and Safari may only mark the nominated pair.
  for (const record of byId.values()) {
    if (
      record.type === "candidate-pair" &&
      record.state === "succeeded" &&
      (record.nominated === true || record.selected === true)
    ) {
      return record;
    }
  }

  return null;
}

/** Resolves the selected pair once, or `null` while ICE is still choosing. */
export async function readSelectedCandidatePair(
  pc: PeerConnectionLike,
): Promise<SelectedCandidatePair | null> {
  if (typeof pc.getStats !== "function") {
    return null;
  }

  let report;

  try {
    report = await pc.getStats();
  } catch {
    return null;
  }

  const byId = collectStats(report);
  const pair = selectedPair(byId);

  if (!pair) {
    return null;
  }

  const local =
    typeof pair.localCandidateId === "string"
      ? byId.get(pair.localCandidateId)
      : undefined;
  const remote =
    typeof pair.remoteCandidateId === "string"
      ? byId.get(pair.remoteCandidateId)
      : undefined;

  return {
    local: normalize(local?.candidateType),
    remote: normalize(remote?.candidateType),
  };
}

export interface WaitForCandidatePairOptions {
  readonly attempts?: number;
  readonly delayMs?: number;
  readonly wait?: (ms: number) => Promise<void>;
}

const defaultWait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * ICE may still be nominating right after the channel opens, so retry a few
 * times instead of showing "unknown" forever.
 */
export async function waitForSelectedCandidatePair(
  pc: PeerConnectionLike,
  options: WaitForCandidatePairOptions = {},
): Promise<SelectedCandidatePair | null> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = options.delayMs ?? 400;
  const wait = options.wait ?? defaultWait;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const pair = await readSelectedCandidatePair(pc);

    if (pair) {
      return pair;
    }

    if (attempt < attempts - 1) {
      await wait(delayMs);
    }
  }

  return null;
}
