/**
 * SDP description encoding for the signaling relay.
 *
 * Descriptions travel as one JSON string per signal, so both peers validate
 * the shape before handing anything to `RTCPeerConnection`. Peer input is
 * untrusted, so every field is checked structurally.
 */
import type { PairingDescription } from "../webrtc/signaling";

/** Matches the server's per-signal cap. */
export const MAX_DESCRIPTION_CHARS = 20_000;

export function encodeDescription(
  description: PairingDescription,
): string {
  return JSON.stringify({
    kind: description.kind,
    id: description.id,
    sdp: description.sdp,
  });
}

export function decodeDescription(text: string): PairingDescription | null {
  if (typeof text !== "string" || text.length > MAX_DESCRIPTION_CHARS) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;

  if (
    (record.kind !== "offer" && record.kind !== "answer") ||
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    record.id.length > 32 ||
    typeof record.sdp !== "string" ||
    record.sdp.length === 0
  ) {
    return null;
  }

  return { kind: record.kind, id: record.id, sdp: record.sdp };
}
