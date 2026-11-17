import { describe, expect, test } from "bun:test";
import {
  readSelectedCandidatePair,
  waitForSelectedCandidatePair,
} from "./connection";
import type { PeerConnectionLike, StatsReportLike } from "./types";

function report(entries: Record<string, unknown>[]): StatsReportLike {
  return {
    forEach(callback) {
      for (const entry of entries) {
        callback(entry);
      }
    },
    get(id) {
      return entries.find((entry) => entry.id === id);
    },
  };
}

function peerWith(stats: StatsReportLike | (() => StatsReportLike)): PeerConnectionLike {
  return {
    getStats: async () => (typeof stats === "function" ? stats() : stats),
  } as unknown as PeerConnectionLike;
}

describe("selected ICE candidate pair", () => {
  test("reads the pair selected by the transport report", async () => {
    const pc = peerWith(
      report([
        { id: "T01", type: "transport", selectedCandidatePairId: "CP01" },
        {
          id: "CP01",
          type: "candidate-pair",
          state: "succeeded",
          localCandidateId: "L01",
          remoteCandidateId: "R01",
        },
        { id: "L01", type: "local-candidate", candidateType: "srflx" },
        { id: "R01", type: "remote-candidate", candidateType: "host" },
      ]),
    );

    expect(await readSelectedCandidatePair(pc)).toEqual({
      local: "srflx",
      remote: "host",
    });
  });

  test("detects a TURN relay path", async () => {
    const pc = peerWith(
      report([
        { id: "CP01", type: "candidate-pair", state: "succeeded", nominated: true, localCandidateId: "L01", remoteCandidateId: "R01" },
        { id: "L01", type: "local-candidate", candidateType: "relay" },
        { id: "R01", type: "remote-candidate", candidateType: "relay" },
      ]),
    );

    expect(await readSelectedCandidatePair(pc)).toEqual({
      local: "relay",
      remote: "relay",
    });
  });

  test("reports unknown for a candidate type it does not recognise", async () => {
    const pc = peerWith(
      report([
        { id: "CP01", type: "candidate-pair", state: "succeeded", selected: true, localCandidateId: "L01", remoteCandidateId: "R01" },
        { id: "L01", type: "local-candidate", candidateType: "weird" },
        { id: "R01", type: "remote-candidate", candidateType: "host" },
      ]),
    );

    expect(await readSelectedCandidatePair(pc)).toEqual({
      local: "unknown",
      remote: "host",
    });
  });

  test("returns null while ICE has not nominated a pair", async () => {
    expect(await readSelectedCandidatePair(peerWith(report([])))).toBeNull();
    expect(
      await readSelectedCandidatePair({} as PeerConnectionLike),
    ).toBeNull();
  });

  test("retries until ICE nominates a pair", async () => {
    let calls = 0;
    const pc = peerWith(() => {
      calls += 1;
      return calls < 3
        ? report([])
        : report([
            { id: "CP01", type: "candidate-pair", state: "succeeded", nominated: true, localCandidateId: "L01", remoteCandidateId: "R01" },
            { id: "L01", type: "local-candidate", candidateType: "host" },
            { id: "R01", type: "remote-candidate", candidateType: "srflx" },
          ]);
    });

    const pair = await waitForSelectedCandidatePair(pc, {
      attempts: 3,
      delayMs: 1,
      wait: async () => {},
    });

    expect(pair).toEqual({ local: "host", remote: "srflx" });
    expect(calls).toBe(3);
  });
});
