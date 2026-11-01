import { describe, expect, test } from "bun:test";
import {
  applyBonusMove,
  applyMove,
  chooseBarrier,
  createGame,
  getLegalBonusMoves,
  getLegalMoves,
  getOwnBarriers,
  getRemainingDice,
  getWinnerId,
  isFinished,
  roll,
  rollDice,
  validateState,
} from "./index";
import {
  errorCode,
  makeRolledState,
  makeState,
  move,
  progressAt,
  progressOf,
} from "./test-helpers";
import type { GameState } from "./types";

const TWO = [
  { id: "red", color: "red" as const },
  { id: "yellow", color: "yellow" as const },
];

const TWO_COLORS: Array<"red" | "yellow"> = ["red", "yellow"];

describe("1. setup", () => {
  test("2–4 players start with four yard tokens and blank dice", () => {
    for (const count of [2, 3, 4]) {
      const colors = ["red", "blue", "yellow", "green"].slice(0, count) as Array<
        "red" | "blue" | "yellow" | "green"
      >;
      const game = createGame(colors.map((color) => ({ id: color, color })));

      expect(game.schemaVersion).toBe(2);
      expect(game.phase).toBe("awaiting-roll");
      expect(game.dice).toBeNull();
      expect(game.consecutiveDoubles).toBe(0);
      expect(game.players).toHaveLength(count);
      expect(game.players.every((player) => player.tokens.length === 4)).toBeTrue();
      expect(
        game.players.every((player) =>
          player.tokens.every((token) => token.zone === "yard" && token.progress === null),
        ),
      ).toBeTrue();
      expect(validateState(game)).toEqual([]);
    }
  });

  test("rejects invalid rosters", () => {
    expect(errorCode(() => createGame([]))).toBe("INVALID_PLAYERS");
    expect(
      errorCode(() => createGame([{ id: "a", color: "red" }])),
    ).toBe("INVALID_PLAYERS");
    expect(
      errorCode(() =>
        createGame([
          { id: "a", color: "red" },
          { id: "a", color: "blue" },
        ]),
      ),
    ).toBe("INVALID_PLAYERS");
    expect(
      errorCode(() =>
        createGame([
          { id: "a", color: "red" },
          { id: "b", color: "red" },
        ]),
      ),
    ).toBe("INVALID_PLAYERS");
  });

  test("rollDice is deterministic with a seeded random", () => {
    expect(rollDice(() => 0)).toEqual([1, 1]);
    expect(rollDice(() => 0.999)).toEqual([6, 6]);
  });
});

describe("2. automatic entries", () => {
  test("a 5 die releases one token automatically and leaves the other die", () => {
    let state = createGame(TWO);
    state = roll(state, [5, 2]);

    expect(state.phase).toBe("awaiting-move");
    expect(progressOf(state, "red-0")).toBe(0);
    expect(getRemainingDice(state)).toEqual([2]);
    expect(state.lastMovedTokenId).toBe("red-0");
    expect(state.log.some((event) => event.type === "enter" && event.die === 5)).toBeTrue();

    const moves = getLegalMoves(state);
    expect(moves.every((item) => item.die === 2)).toBeTrue();
    expect(moves).toContainEqual(move(2, "red-0", 2));

    state = applyMove(state, move(2, "red-0", 2));
    expect(state.currentPlayerIndex).toBe(1);
    expect(validateState(state)).toEqual([]);
  });

  test("a total of 5 spends both dice and ends the turn", () => {
    let state = createGame(TWO);
    state = roll(state, [1, 4]);

    expect(state.phase).toBe("awaiting-roll");
    expect(state.currentPlayerIndex).toBe(1);
    expect(progressOf(state, "red-0")).toBe(0);
    expect(getRemainingDice(state)).toEqual([]);
    expect(
      state.log.some((event) => event.type === "enter" && event.die === null),
    ).toBeTrue();
    expect(validateState(state)).toEqual([]);
  });

  test("double 5 releases two tokens and grants an extra roll", () => {
    let state = createGame(TWO);
    state = roll(state, [5, 5]);

    expect(progressOf(state, "red-0")).toBe(0);
    expect(progressOf(state, "red-1")).toBe(0);
    expect(state.consecutiveDoubles).toBe(1);
    expect(state.phase).toBe("awaiting-roll");
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.dice).toBeNull();
    expect(
      state.log.filter((event) => event.type === "enter"),
    ).toHaveLength(2);
    expect(validateState(state)).toEqual([]);
  });

  test("double 5 with only one yard token leaves the second 5 as a move", () => {
    const base = makeState(TWO_COLORS, {
      "red-0": 10,
      "red-1": 20,
      "red-2": 30,
    });
    const state = roll(base, [5, 5]);

    expect(progressOf(state, "red-3")).toBe(0);
    expect(getRemainingDice(state)).toEqual([5]);
    expect(state.phase).toBe("awaiting-move");
    expect(getLegalMoves(state).some((item) => item.die === 5)).toBeTrue();
  });

  test("a blocked start leaves the 5 usable as a normal die", () => {
    // Blue tokens form a barrier on red's absolute start square 0.
    const base = makeState(
      ["red", "blue"],
      {
        "red-0": 10,
        "blue-0": progressAt("blue", 0),
        "blue-1": progressAt("blue", 0),
      },
    );
    const state = roll(base, [5, 2]);

    expect(state.phase).toBe("awaiting-move");
    expect(getRemainingDice(state)).toEqual([5, 2]);
    expect(getLegalMoves(state)).toContainEqual(move(5, "red-0", 15));
    expect(getLegalMoves(state)).toContainEqual(move(2, "red-0", 12));
  });

  test("no yard tokens means no automatic entry", () => {
    const base = makeState(TWO_COLORS, {
      "red-0": 10,
      "red-1": 20,
      "red-2": 30,
      "red-3": 40,
    });
    const state = roll(base, [5, 2]);

    expect(state.phase).toBe("awaiting-move");
    expect(getRemainingDice(state)).toEqual([5, 2]);
  });
});

describe("3. two-dice movement", () => {
  test("dice are separate: 4 and 5 never sum to 9 in one move", () => {
    const state = makeRolledState(TWO_COLORS, { "red-0": 10 }, [4, 5]);
    const moves = getLegalMoves(state);

    expect(moves).toContainEqual(move(4, "red-0", 14));
    expect(moves).toContainEqual(move(5, "red-0", 15));
    expect(moves.some((item) => item.to === 19)).toBeFalse();
  });

  test("both dice can be used on the same token in either order", () => {
    let state = makeRolledState(TWO_COLORS, { "red-0": 10 }, [5, 4]);
    state = applyMove(state, move(5, "red-0", 15));
    expect(getRemainingDice(state)).toEqual([4]);
    expect(state.phase).toBe("awaiting-move");
    state = applyMove(state, move(4, "red-0", 19));
    expect(state.currentPlayerIndex).toBe(1);
  });

  test("the two dice can be split between tokens", () => {
    let state = makeRolledState(
      TWO_COLORS,
      { "red-0": 10, "red-1": 30 },
      [4, 5],
    );
    state = applyMove(state, move(4, "red-0", 14));
    expect(state.phase).toBe("awaiting-move");
    expect(getLegalMoves(state)).toContainEqual(move(5, "red-1", 35));
    state = applyMove(state, move(5, "red-1", 35));
    expect(state.currentPlayerIndex).toBe(1);
  });

  test("both dice must be used while the remaining die has a legal move", () => {
    let state = makeRolledState(TWO_COLORS, { "red-0": 10 }, [1, 2]);
    state = applyMove(state, move(1, "red-0", 11));

    expect(state.phase).toBe("awaiting-move");
    expect(state.currentPlayerIndex).toBe(0);
    expect(getRemainingDice(state)).toEqual([2]);
    expect(getLegalMoves(state)).toContainEqual(move(2, "red-0", 13));
  });

  test("an unusable die is lost and the turn passes automatically", () => {
    let state = makeRolledState(TWO_COLORS, { "red-0": 70 }, [1, 2]);
    expect(getLegalMoves(state)).toEqual([move(1, "red-0", 71)]);

    state = applyMove(state, move(1, "red-0", 71));
    expect(state.phase).toBe("awaiting-roll");
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.log.some((event) => event.type === "bonus-forfeited")).toBeTrue();
    expect(state.log.some((event) => event.type === "pass")).toBeTrue();
  });

  test("a 6 moves 6, never 7", () => {
    const state = makeRolledState(TWO_COLORS, { "red-0": 10 }, [6, 1]);
    expect(getLegalMoves(state)).toContainEqual(move(6, "red-0", 16));
    expect(getLegalMoves(state).some((item) => item.to === 17)).toBeFalse();
  });

  test("no legal move passes automatically", () => {
    let state = createGame(TWO);
    state = roll(state, [2, 4]); // no 5, no entry; both even but no own barrier

    expect(state.phase).toBe("awaiting-roll");
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.log.some((event) => event.type === "pass")).toBeTrue();
  });
});

describe("4. doubles and the three-doubles penalty", () => {
  test("a double grants another roll after both dice resolve", () => {
    let state = makeRolledState(TWO_COLORS, { "red-0": 10 }, [4, 4], {
      consecutiveDoubles: 1,
    });
    const turn = state.turn;

    state = applyMove(state, move(4, "red-0", 14));
    state = applyMove(state, move(4, "red-0", 18));

    expect(state.phase).toBe("awaiting-roll");
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.turn).toBe(turn);
    expect(state.consecutiveDoubles).toBe(1);
  });

  test("the third double sends the last moved outer-track token to the yard", () => {
    const base = makeState(
      TWO_COLORS,
      { "red-0": 10, "red-1": 20 },
      {
        phase: "awaiting-roll",
        consecutiveDoubles: 2,
        lastMovedTokenId: "red-0",
      },
    );
    const state = roll(base, [3, 3]);

    expect(state.phase).toBe("awaiting-roll");
    expect(state.currentPlayerIndex).toBe(1);
    expect(progressOf(state, "red-0")).toBeNull();
    expect(
      state.log.some(
        (event) =>
          event.type === "three-doubles" && event.returnedTokenId === "red-0",
      ),
    ).toBeTrue();
    expect(validateState(state)).toEqual([]);
  });

  test("a last moved token in the home column is exempt from the penalty", () => {
    const base = makeState(
      TWO_COLORS,
      { "red-0": 64, "red-1": 20 },
      {
        phase: "awaiting-roll",
        consecutiveDoubles: 2,
        lastMovedTokenId: "red-0",
      },
    );
    const state = roll(base, [3, 3]);

    expect(progressOf(state, "red-0")).toBe(64);
    expect(
      state.log.some(
        (event) =>
          event.type === "three-doubles" && event.returnedTokenId === null,
      ),
    ).toBeTrue();
  });
});

describe("5. own barriers on two even dice", () => {
  test("one eligible barrier is broken automatically with the first legal die", () => {
    const base = makeState(TWO_COLORS, {
      "red-0": 10,
      "red-1": 10,
    });
    const state = roll(base, [2, 4]);

    expect(state.phase).toBe("awaiting-move");
    expect(progressOf(state, "red-0")).toBe(12);
    expect(progressOf(state, "red-1")).toBe(10);
    expect(getRemainingDice(state)).toEqual([4]);
    expect(getOwnBarriers(state, state.players[0])).toHaveLength(0);

    const event = state.log.find((item) => item.type === "barrier-break");
    expect(event).toBeDefined();
    expect(event?.type === "barrier-break" && event.automatic).toBeTrue();
    expect(event?.type === "barrier-break" && event.square).toBe(10);
  });

  test("two eligible barriers wait for the player's choice", () => {
    const base = makeState(TWO_COLORS, {
      "red-0": 10,
      "red-1": 10,
      "red-2": 30,
      "red-3": 30,
    });
    let state = roll(base, [2, 4]);

    expect(state.phase).toBe("awaiting-barrier");
    expect(state.barrierChoice?.squares).toEqual([10, 30]);

    state = chooseBarrier(state, 30);
    expect(state.phase).toBe("awaiting-move");
    expect(progressOf(state, "red-2")).toBe(32);
    expect(progressOf(state, "red-0")).toBe(10);
    expect(getRemainingDice(state)).toEqual([4]);
    expect(
      state.log.some(
        (event) => event.type === "barrier-break" && event.automatic === false,
      ),
    ).toBeTrue();
  });

  test("no legal break skips the turn without spending the dice", () => {
    // Red barrier at progress 10; blue barrier at absolute 12 blocks both
    // the 2 landing and the 4 passage.
    const base = makeState(["red", "blue"], {
      "red-0": 10,
      "red-1": 10,
      "blue-0": 63,
      "blue-1": 63,
    });
    const state = roll(base, [2, 4]);

    expect(state.phase).toBe("awaiting-roll");
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.log.some((event) => event.type === "pass")).toBeTrue();
    expect(validateState(state)).toEqual([]);
  });

  test("an opponent barrier alone does not trigger the rule", () => {
    const base = makeState(["red", "blue"], {
      "red-0": 20,
      "blue-0": 63,
      "blue-1": 63,
    });
    const state = roll(base, [2, 4]);

    expect(state.phase).toBe("awaiting-move");
    expect(state.log.some((event) => event.type === "barrier-break")).toBeFalse();
    expect(getLegalMoves(state).some((item) => item.die === 2)).toBeTrue();
  });
});

describe("6. bonuses and winning", () => {
  test("a capture grants a mandatory +20 bonus and preserves the second die", () => {
    const base = makeRolledState(
      TWO_COLORS,
      { "red-0": 10, "red-1": 30, "yellow-0": progressAt("yellow", 14) },
      [4, 2],
    );
    let state = applyMove(base, move(4, "red-0", 14));

    expect(progressOf(state, "yellow-0")).toBeNull();
    expect(state.phase).toBe("awaiting-bonus");
    expect(state.bonus?.kind).toBe("capture-20");
    expect(getRemainingDice(state)).toEqual([2]);
    expect(state.log.some((event) => event.type === "capture")).toBeTrue();
    expect(getLegalBonusMoves(state).length).toBeGreaterThan(0);

    const bonus = getLegalBonusMoves(state)[0];
    state = applyBonusMove(state, bonus);
    expect(state.phase).toBe("awaiting-move");
    expect(getRemainingDice(state)).toEqual([2]);
  });

  test("a capture with no legal +20 is forfeited and the die continues", () => {
    const base = makeRolledState(
      TWO_COLORS,
      { "red-0": 55, "yellow-0": progressAt("yellow", 60) },
      [5, 2],
    );
    const state = applyMove(base, move(5, "red-0", 60));

    expect(progressOf(state, "yellow-0")).toBeNull();
    expect(state.log.some((event) => event.type === "bonus-forfeited")).toBeTrue();
    expect(state.phase).toBe("awaiting-move");
    expect(getRemainingDice(state)).toEqual([2]);
  });

  test("reaching the goal with a non-final token grants a +10 bonus", () => {
    const base = makeRolledState(
      TWO_COLORS,
      { "red-0": 70, "red-1": 30 },
      [1, 2],
    );
    let state = applyMove(base, move(1, "red-0", 71));

    expect(state.phase).toBe("awaiting-bonus");
    expect(state.bonus?.kind).toBe("home-10");
    expect(getRemainingDice(state)).toEqual([2]);

    const bonus = getLegalBonusMoves(state)[0];
    state = applyBonusMove(state, bonus);
    expect(state.phase).toBe("awaiting-move");
  });

  test("the fourth goal wins immediately without a bonus or second die", () => {
    const base = makeRolledState(
      TWO_COLORS,
      { "red-0": 71, "red-1": 71, "red-2": 71, "red-3": 70 },
      [1, 2],
    );
    const state = applyMove(base, move(1, "red-3", 71));

    expect(state.phase).toBe("finished");
    expect(getWinnerId(state)).toBe("red");
    expect(isFinished(state)).toBeTrue();
    expect(state.log.some((event) => event.type === "win")).toBeTrue();
    expect(state.log.some((event) => event.type === "bonus-move")).toBeFalse();
  });
});

describe("7. state, purity, and errors", () => {
  test("actions do not mutate frozen inputs and survive JSON round-trips", () => {
    const base = makeRolledState(TWO_COLORS, { "red-0": 10 }, [4, 2]);
    const before = JSON.stringify(base);

    const after = applyMove(base, move(4, "red-0", 14));
    expect(JSON.stringify(base)).toBe(before);
    expect(after).not.toBe(base);

    const clone = JSON.parse(JSON.stringify(after)) as GameState;
    expect(validateState(clone)).toEqual([]);
    expect(clone.players[0].tokens[0].progress).toBe(14);
  });

  test("invalid dice, phases, moves, bonuses, and barrier choices throw stable codes", () => {
    const game = createGame(TWO);
    expect(errorCode(() => roll(game, [0, 3] as never))).toBe("INVALID_ROLL");
    expect(errorCode(() => applyMove(game, move(4, "red-0", 4)))).toBe("WRONG_PHASE");

    const moved = makeRolledState(TWO_COLORS, { "red-0": 10 }, [4, 2]);
    expect(errorCode(() => applyMove(moved, move(3, "red-0", 13)))).toBe("ILLEGAL_MOVE");
    expect(errorCode(() => applyBonusMove(moved, { kind: "capture-20", tokenId: "red-0", to: 14 }))).toBe("WRONG_PHASE");

    const barrier = makeState(TWO_COLORS, {
      "red-0": 10,
      "red-1": 10,
      "red-2": 30,
      "red-3": 30,
    });
    const waiting = roll(barrier, [2, 4]);
    expect(waiting.phase).toBe("awaiting-barrier");
    expect(errorCode(() => chooseBarrier(waiting, 20))).toBe("INVALID_BARRIER");
  });

  test("validateState reports structural problems without throwing", () => {
    const state = createGame(TWO);
    state.players[0].tokens[0] = {
      ...state.players[0].tokens[0],
      zone: "path",
      progress: -1,
    };

    expect(() => validateState(state)).not.toThrow();
    expect(
      validateState(state).some((problem) => problem.includes("invalid progress")),
    ).toBeTrue();
  });
});
