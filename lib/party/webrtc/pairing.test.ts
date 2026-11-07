import { describe, expect, test } from "bun:test";
import { encodePairing, splitPairing } from "./signaling";
import {
  INITIAL_PAIRING_STATE,
  isPairingFailure,
  PAIRING_FAILURE_COPY,
  describePairing,
  reducePairing,
  type PairingFailure,
} from "./pairing";

const FAILURES: PairingFailure[] = [
  "insecure-context",
  "no-webrtc",
  "camera-denied",
  "camera-missing",
  "bad-code",
  "mixed-codes",
  "incomplete-code",
  "ice-failed",
  "timeout",
  "protocol-mismatch",
  "host-left",
  "peer-left",
];

function offerParts(id = "hostid12"): string[] {
  return splitPairing(
    encodePairing({ id, kind: "offer", sdp: "v=0\r\ns=-" }),
  ).map((part) => part.text);
}

function answerParts(id = "hostid12"): string[] {
  return splitPairing(
    encodePairing({ id, kind: "answer", sdp: "v=0\r\ns=-" }),
  ).map((part) => part.text);
}

describe("pairing copy", () => {
  test("every failure has distinct Spanish copy", () => {
    const seen = new Set<string>();

    for (const failure of FAILURES) {
      const copy = PAIRING_FAILURE_COPY[failure];
      expect(typeof copy).toBe("string");
      expect(copy.length).toBeGreaterThan(20);
      // Spanish copy, not an English placeholder.
      expect(copy).not.toMatch(/\b(the|connection|failed)\b/i);
      expect(seen.has(copy)).toBeFalse();
      seen.add(copy);
      expect(isPairingFailure(failure)).toBeTrue();
    }

    expect(isPairingFailure("nope")).toBeFalse();
    expect(isPairingFailure(7)).toBeFalse();
  });

  test("the failure state uses the matching copy", () => {
    for (const failure of FAILURES) {
      const described = describePairing({
        ...INITIAL_PAIRING_STATE,
        phase: "failed",
        failure,
      });
      expect(described.tone).toBe("error");
      expect(described.detail).toBe(PAIRING_FAILURE_COPY[failure]);
    }
  });

  test("every phase has a title and never leaks English", () => {
    const state = { ...INITIAL_PAIRING_STATE };
    const phases = [
      "role-choice",
      "host-creating-offer",
      "host-showing-offer",
      "host-entering-answer",
      "guest-entering-offer",
      "guest-creating-answer",
      "guest-showing-answer",
      "connecting",
      "connected",
      "failed",
      "aborted",
    ] as const;

    for (const phase of phases) {
      const described = describePairing({ ...state, phase });
      expect(described.title.length).toBeGreaterThan(0);
      expect(`${described.title} ${described.detail}`).not.toMatch(
        /\b(the|scan|connect|copy)\b/i,
      );
    }
  });
});

describe("pairing reducer", () => {
  test("choosing the host opens offer preparation; the guest starts with input", () => {
    const host = reducePairing(INITIAL_PAIRING_STATE, {
      type: "CHOOSE_ROLE",
      role: "host",
    });
    expect(host).toMatchObject({ role: "host", phase: "host-creating-offer" });

    const guest = reducePairing(INITIAL_PAIRING_STATE, {
      type: "CHOOSE_ROLE",
      role: "guest",
    });
    expect(guest).toMatchObject({ role: "guest", phase: "guest-entering-offer" });
  });

  test("host: offer ready → show parts → collect answer", () => {
    const parts = offerParts();
    let state = reducePairing(INITIAL_PAIRING_STATE, {
      type: "CHOOSE_ROLE",
      role: "host",
    });

    state = reducePairing(state, { type: "OFFER_READY", parts });
    expect(state).toMatchObject({
      phase: "host-showing-offer",
      outgoing: parts,
      outgoingIndex: 0,
    });

    state = reducePairing(state, { type: "SHOW_PART", index: 99 });
    expect(state.outgoingIndex).toBe(parts.length - 1);
    expect(state.phase).toBe("host-entering-answer");

    state = reducePairing(state, { type: "CODE_INPUT", parts: answerParts() });
    expect(state).toMatchObject({
      incoming: answerParts(),
      phase: "host-entering-answer",
      failure: null,
    });

    state = reducePairing(state, { type: "CONNECTING" });
    expect(state.phase).toBe("connecting");

    state = reducePairing(state, { type: "CONNECTED" });
    expect(state.phase).toBe("connected");
  });

  test("guest: collecting an offer keeps its phase and dedupes parts", () => {
    const parts = offerParts();
    let state = reducePairing(INITIAL_PAIRING_STATE, {
      type: "CHOOSE_ROLE",
      role: "guest",
    });

    state = reducePairing(state, { type: "CODE_INPUT", parts });
    state = reducePairing(state, { type: "CODE_INPUT", parts });

    expect(state.incoming).toEqual(parts);
    expect(state.phase).toBe("guest-entering-offer");

    state = reducePairing(state, { type: "ANSWER_READY", parts: answerParts() });
    expect(state.phase).toBe("guest-showing-answer");
    expect(state.outgoing.length).toBeGreaterThan(0);
  });

  test("a foreign part is a mixed code and fails the pairing", () => {
    let state = reducePairing(INITIAL_PAIRING_STATE, {
      type: "CHOOSE_ROLE",
      role: "host",
    });

    state = reducePairing(state, {
      type: "CODE_INPUT",
      parts: [...answerParts("aaaaaaaa"), ...answerParts("bbbbbbbb")],
    });

    expect(state).toMatchObject({ phase: "failed", failure: "mixed-codes" });
  });

  test("nonsense input is a bad code", () => {
    const state = reducePairing(
      reducePairing(INITIAL_PAIRING_STATE, { type: "CHOOSE_ROLE", role: "guest" }),
      { type: "CODE_INPUT", parts: ["not-a-code"] },
    );
    expect(state).toMatchObject({ phase: "failed", failure: "bad-code" });
  });

  test("retry clears the pairing but keeps the role; abort cancels", () => {
    const failed = { ...INITIAL_PAIRING_STATE, role: "host" as const };
    const retried = reducePairing(
      { ...failed, phase: "failed", failure: "timeout", incoming: ["x"] },
      { type: "RETRY" },
    );
    expect(retried).toMatchObject({
      phase: "host-creating-offer",
      role: "host",
      incoming: [],
      failure: null,
    });

    const aborted = reducePairing(failed, { type: "ABORT" });
    expect(aborted).toMatchObject({ phase: "aborted", outgoing: [], incoming: [] });
  });

  test("ignores empty part lists and out-of-range part indices", () => {
    const state = reducePairing(INITIAL_PAIRING_STATE, {
      type: "CHOOSE_ROLE",
      role: "host",
    });

    expect(reducePairing(state, { type: "CODE_INPUT", parts: [] })).toBe(state);
    expect(reducePairing(state, { type: "SHOW_PART", index: 2 })).toBe(state);
  });
});
