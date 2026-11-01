import { describe, expect, test } from "bun:test";
import {
  getLegalBonusMoves,
  getLegalMoves,
  type GameState,
} from "../parchis";
import { makeRolledState, progressAt } from "../parchis/test-helpers";
import {
  BOT_WEIGHTS,
  chooseBonusMove,
  chooseBarrier,
  chooseMove,
} from "./policy";

function expectLegalMove(state: GameState, playerId: string) {
  const move = chooseMove(state, playerId);
  expect(move).not.toBeNull();
  expect(getLegalMoves(state)).toContainEqual(move);
  return move;
}

describe("bot policy", () => {
  test("captures an opponent before forming a barrier", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      {
        "red-0": 10,
        "red-1": 12,
        "yellow-0": progressAt("yellow", 11),
      },
      [1, 2],
    );

    const move = expectLegalMove(state, "red");
    expect(move).toEqual({
      type: "ADVANCE",
      tokenId: "red-0",
      to: 11,
      die: 1,
    });
  });

  test("forms a barrier when there is no capture", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 10, "red-1": 12 },
      [2, 3],
    );

    const move = expectLegalMove(state, "red");
    expect(move).toEqual({
      type: "ADVANCE",
      tokenId: "red-0",
      to: 12,
      die: 2,
    });
  });

  test("prefers an exact goal", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 70, "red-1": 30 },
      [1, 2],
    );

    const move = expectLegalMove(state, "red");
    expect(move).toEqual({
      type: "ADVANCE",
      tokenId: "red-0",
      to: 71,
      die: 1,
    });
  });

  test("does not break an owned barrier for simple progress", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 12, "red-1": 12, "red-2": 20 },
      [1, 2],
    );

    const move = expectLegalMove(state, "red");
    expect(move?.tokenId).toBe("red-2");
    expect(move?.to).toBe(22);
  });

  test("avoids a non-safe landing threatened by a token 1–6 behind", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 10, "yellow-0": 44 },
      [1, 2],
    );

    const move = expectLegalMove(state, "red");
    expect(move).toEqual({
      type: "ADVANCE",
      tokenId: "red-0",
      to: 12,
      die: 2,
    });
  });

  test("is deterministic and never returns an illegal move", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 20, "red-1": 31, "yellow-0": 44 },
      [3, 4],
    );

    const first = expectLegalMove(state, "red");
    const second = chooseMove(state, "red");
    expect(second).toEqual(first);
  });

  test("chooses the highest-value legal bonus move", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 10, "red-1": 20 },
      [1, 2],
      {
        phase: "awaiting-bonus",
        bonus: { kind: "capture-20", playerId: "red" },
      },
    );

    const move = chooseBonusMove(state, "red");
    expect(move).not.toBeNull();
    expect(getLegalBonusMoves(state)).toContainEqual(move);
    expect(move).toEqual({
      kind: "capture-20",
      tokenId: "red-1",
      to: 40,
    });
  });

  test("returns null when it is not the requested player's turn", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      { "red-0": 10 },
      [1, 2],
    );

    expect(chooseMove(state, "yellow")).toBeNull();
    expect(chooseBonusMove(state, "red")).toBeNull();
  });

  test("selects a legal barrier when several can be broken", () => {
    const state = makeRolledState(
      ["red", "yellow"],
      {
        "red-0": 12,
        "red-1": 12,
        "red-2": 20,
        "red-3": 20,
      },
      [2, 2],
      {
        phase: "awaiting-barrier",
        barrierChoice: { playerId: "red", squares: [12, 20] },
      },
    );

    const choice = chooseBarrier(state, "red");
    expect(choice).not.toBeNull();
    expect([12, 20]).toContain(choice as number);
    expect(BOT_WEIGHTS.capture).toBeGreaterThan(BOT_WEIGHTS.barrier);
  });
});
