import { describe, expect, test } from "bun:test";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  fnv1aHex,
  packJson,
  unpackJson,
} from "./encoding";

describe("base64url", () => {
  test("round-trips every byte value and lengths 0–3 remainder", () => {
    const bytes = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) {
      bytes[index] = index;
    }

    for (const length of [0, 1, 2, 3, 4, 255, 256]) {
      const slice = bytes.slice(0, length);
      const text = bytesToBase64Url(slice);
      expect(text).not.toMatch(/[+/=]/);
      expect(Array.from(base64UrlToBytes(text))).toEqual(Array.from(slice));
    }
  });

  test("rejects invalid characters and lengths", () => {
    expect(() => base64UrlToBytes("a")).toThrow();
    expect(() => base64UrlToBytes("ab+c")).toThrow();
  });
});

describe("json packing", () => {
  test("round-trips and shrinks a representative SDP", () => {
    const sdp = [
      "v=0",
      "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
      "s=-",
      "t=0 0",
      "a=candidate:0 1 udp 2122260223 192.168.1.20 51234 typ host generation 0",
      "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
      "a=setup:actpass",
      "a=ice-ufrag:abcd",
      "a=ice-pwd:0123456789abcdef0123456789abcdef",
    ].join("\r\n");

    const value = { v: 1, k: "offer", i: "abc", s: sdp };
    const packed = packJson(value);

    expect(unpackJson(packed)).toEqual(value);
    expect(packed.length).toBeLessThan(JSON.stringify(value).length + 32);
  });

  test("rejects corrupt input", () => {
    expect(() => unpackJson("!!!!")).toThrow();
    expect(() => unpackJson("AAAA")).toThrow();
  });

  test("fnv checksum is 8 lowercase hex characters", () => {
    expect(fnv1aHex("hello")).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1aHex("hello")).not.toBe(fnv1aHex("hellp"));
  });
});
