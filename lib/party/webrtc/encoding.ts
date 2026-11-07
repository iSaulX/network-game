/**
 * Compact, URL- and QR-safe encoding for pairing payloads.
 *
 * Pairing codes are exchanged by scanning or pasting, so the SDP is deflated
 * and base64url-encoded. Base64url is hand-rolled because the pairing codec
 * must also run under Bun, where `btoa`/`atob` are not always present with the
 * same semantics.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LOOKUP = new Map<string, number>(
  [...ALPHABET].map((character, index) => [character, index]),
);

/** Largest payload we will ever inflate from peer input. */
export const MAX_PAIRING_BYTES = 16 * 1024;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const chunk = (first << 16) | (second << 8) | third;
    const remaining = bytes.length - index;

    output += ALPHABET[(chunk >> 18) & 63];
    output += ALPHABET[(chunk >> 12) & 63];
    if (remaining > 1) {
      output += ALPHABET[(chunk >> 6) & 63];
    }
    if (remaining > 2) {
      output += ALPHABET[chunk & 63];
    }
  }

  return output;
}

export function base64UrlToBytes(text: string): Uint8Array {
  const clean = text.trim();
  const bytes: number[] = [];

  if (clean.length % 4 === 1) {
    throw new Error("Invalid base64url length.");
  }

  for (let index = 0; index < clean.length; index += 4) {
    const slots = Math.min(4, clean.length - index);
    const values = [0, 0, 0, 0];

    for (let slot = 0; slot < slots; slot += 1) {
      const value = LOOKUP.get(clean[index + slot]);

      if (value === undefined) {
        throw new Error("Invalid base64url character.");
      }

      values[slot] = value;
    }

    const chunk =
      (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];

    bytes.push((chunk >> 16) & 255);
    if (slots > 2) {
      bytes.push((chunk >> 8) & 255);
    }
    if (slots > 3) {
      bytes.push(chunk & 255);
    }
  }

  return new Uint8Array(bytes);
}

/** 32-bit FNV-1a as 8 lowercase hex characters; a typo detector, not a MAC. */
export function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

/** JSON → deflate → base64url. */
export function packJson(value: unknown): string {
  return bytesToBase64Url(deflateSync(strToU8(JSON.stringify(value))));
}

/** base64url → inflate (size-capped) → JSON. Throws on any malformed input. */
export function unpackJson(text: string): unknown {
  const compressed = base64UrlToBytes(text);
  const inflated = inflateSync(compressed);

  if (inflated.length > MAX_PAIRING_BYTES) {
    throw new Error("Pairing payload is too large.");
  }

  return JSON.parse(strFromU8(inflated));
}
