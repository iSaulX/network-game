import { describe, expect, test } from "bun:test";
import {
  applyBonusMove,
  applyMove,
  createGame,
  getLegalBonusMoves,
  getLegalMoves,
  getWinnerId,
  isFinished,
  pass,
  roll,
  rollDie,
  validateState,
  type Color,
  type GameState,
} from "./index";
import { deepFreeze, errorCode, makeState, progressAt, progressOf } from "./test-helpers";

const players = (colors: Color[]) => colors.map((c) => ({ id: c, color: c }));

describe("1. createGame", () => {
  test("rejects invalid player lists", () => {
    expect(errorCode(() => createGame([]))).toBe("INVALID_PLAYERS");
    expect(errorCode(() => createGame(players(["red"])))).toBe("INVALID_PLAYERS");
    const five = [...players(["red", "blue", "yellow", "green"]), { id: "x", color: "red" as Color }];
    expect(errorCode(() => createGame(five))).toBe("INVALID_PLAYERS");
    expect(errorCode(() => createGame([{ id: "a", color: "red" }, { id: "a", color: "blue" }]))).toBe(
      "INVALID_PLAYERS",
    );
    expect(errorCode(() => createGame([{ id: "a", color: "red" }, { id: "b", color: "red" }]))).toBe(
      "INVALID_PLAYERS",
    );
    expect(
      errorCode(() => createGame([{ id: "a", color: "red" }, { id: "b", color: "purple" as Color }])),
    ).toBe("INVALID_PLAYERS");
    expect(errorCode(() => createGame([{ id: "", color: "red" }, { id: "b", color: "blue" }]))).toBe(
      "INVALID_PLAYERS",
    );
  });

  test("2–4 players start with four yard tokens each", () => {
    for (const colors of [
      ["red", "yellow"],
      ["red", "blue", "yellow"],
      ["red", "blue", "yellow", "green"],
    ] as Color[][]) {
      const g = createGame(players(colors));
      expect(g.players).toHaveLength(colors.length);
      expect(g.mode).toBe("classic");
      expect(g.phase).toBe("awaiting-roll");
      expect(g.turn).toBe(1);
      for (const p of g.players) {
        expect(p.tokens.map((t) => t.id)).toEqual([0, 1, 2, 3].map((i) => `${p.id}-${i}`));
        expect(p.tokens.every((t) => t.zone === "yard" && t.progress === null)).toBeTrue();
      }
      expect(validateState(g)).toEqual([]);
    }
  });
});

describe("rollDie", () => {
  test("maps [0, 1) onto 1–6", () => {
    expect(rollDie(() => 0)).toBe(1);
    expect(rollDie(() => 0.999999)).toBe(6);
    expect(rollDie(() => 0.5)).toBe(4);
  });
});

describe("2. entering from the yard", () => {
  test("only a 5 can enter; 6 never enters", () => {
    const g = deepFreeze(createGame(players(["red", "yellow"])));
    for (const v of [1, 2, 3, 4, 6] as const) expect(getLegalMoves(roll(g, v))).toEqual([]);
    const five = roll(g, 5);
    expect(getLegalMoves(five)).toEqual([0, 1, 2, 3].map((i) => ({ type: "ENTER", tokenId: `red-${i}` })));
  });

  test("entry on a 5 is mandatory even when a route token could move", () => {
    const s = roll(makeState(["red", "yellow"], { "red-0": 10 }), 5);
    const moves = getLegalMoves(s);
    expect(moves.every((m) => m.type === "ENTER")).toBeTrue();
    expect(moves).toHaveLength(3);
    const after = applyMove(s, { type: "ENTER", tokenId: "red-1" });
    expect(progressOf(after, "red-1")).toBe(0); // entry is a complete move, no extra 5 squares
    expect(after.currentPlayerIndex).toBe(1);
  });
});

describe("3. blocked start", () => {
  test("two own tokens on the start: the 5 moves a route token instead", () => {
    const s = roll(makeState(["red", "yellow"], { "red-0": 0, "red-1": 0, "red-3": 10 }), 5);
    expect(getLegalMoves(s)).toEqual([
      { type: "ADVANCE", tokenId: "red-0", to: 5 },
      { type: "ADVANCE", tokenId: "red-1", to: 5 },
      { type: "ADVANCE", tokenId: "red-3", to: 15 },
    ]);
  });

  test("an opponent token or opponent barrier on the start blocks entry", () => {
    const b = progressAt("blue", 0);
    const single = roll(makeState(["red", "blue"], { "red-3": 10, "blue-0": b }), 5);
    expect(getLegalMoves(single)).toEqual([{ type: "ADVANCE", tokenId: "red-3", to: 15 }]);
    const barrier = roll(makeState(["red", "blue"], { "red-3": 10, "blue-0": b, "blue-1": b }), 5);
    expect(getLegalMoves(barrier)).toEqual([{ type: "ADVANCE", tokenId: "red-3", to: 15 }]);
    const nothing = roll(makeState(["red", "blue"], { "blue-0": b }), 5);
    expect(getLegalMoves(nothing)).toEqual([]);
    expect(pass(nothing).currentPlayerIndex).toBe(1);
  });
});

describe("4. entry onto own tokens", () => {
  test("entering next to one own token forms a barrier", () => {
    const s = roll(makeState(["red", "yellow"], { "red-0": 0 }), 5);
    expect(getLegalMoves(s)).toHaveLength(3);
    const after = applyMove(s, { type: "ENTER", tokenId: "red-1" });
    expect(progressOf(after, "red-0")).toBe(0);
    expect(progressOf(after, "red-1")).toBe(0);
    expect(validateState(after)).toEqual([]);
  });
});

describe("5. the six", () => {
  test("a 6 moves 6 while any token is in the yard", () => {
    const s = roll(makeState(["red", "yellow"], { "red-0": 10 }), 6);
    expect(s.moveDistance).toBe(6);
    expect(getLegalMoves(s)).toEqual([{ type: "ADVANCE", tokenId: "red-0", to: 16 }]);
  });

  test("a 6 moves 7 when all tokens are out (goal counts) but still grants the extra roll", () => {
    const s = roll(makeState(["red", "yellow"], { "red-0": 71, "red-1": 20, "red-2": 30, "red-3": 40 }), 6);
    expect(s.lastRoll).toBe(6);
    expect(s.moveDistance).toBe(7);
    expect(getLegalMoves(s)).toContainEqual({ type: "ADVANCE", tokenId: "red-1", to: 27 });
    const after = applyMove(s, { type: "ADVANCE", tokenId: "red-1", to: 27 });
    expect(after.currentPlayerIndex).toBe(0);
    expect(after.phase).toBe("awaiting-roll");
    expect(after.consecutiveSixes).toBe(1);
  });
});

describe("6. passing", () => {
  test("a 6 with no moves still grants another roll; a non-6 passes the turn", () => {
    const g = deepFreeze(createGame(players(["red", "yellow"])));
    const six = pass(roll(g, 6));
    expect(six.currentPlayerIndex).toBe(0);
    expect(six.phase).toBe("awaiting-roll");
    expect(six.consecutiveSixes).toBe(1);
    expect(six.turn).toBe(1);
    const three = pass(roll(g, 3));
    expect(three.currentPlayerIndex).toBe(1);
    expect(three.turn).toBe(2);
    expect(three.lastRoll).toBeNull();
  });
});

describe("7. three consecutive sixes", () => {
  test("the last moved outer-track token returns to the yard and the turn ends", () => {
    let s = makeState(["red", "yellow"], { "red-0": 10 });
    s = applyMove(roll(s, 6), { type: "ADVANCE", tokenId: "red-0", to: 16 });
    s = applyMove(roll(s, 6), { type: "ADVANCE", tokenId: "red-0", to: 22 });
    expect(s.consecutiveSixes).toBe(2);
    s = roll(s, 6);
    expect(progressOf(s, "red-0")).toBeNull();
    expect(s.currentPlayerIndex).toBe(1);
    expect(s.phase).toBe("awaiting-roll");
    expect(s.consecutiveSixes).toBe(0);
    expect(s.lastMovedTokenId).toBeNull();
    expect(s.log[s.log.length - 1]).toEqual({
      type: "three-sixes",
      turn: 1,
      playerId: "red",
      returnedTokenId: "red-0",
    });
  });

  test("a token in the home column is exempt", () => {
    let s = makeState(["red", "yellow"], { "red-0": 52 });
    s = applyMove(roll(s, 6), { type: "ADVANCE", tokenId: "red-0", to: 58 });
    s = applyMove(roll(s, 6), { type: "ADVANCE", tokenId: "red-0", to: 64 });
    s = roll(s, 6);
    expect(progressOf(s, "red-0")).toBe(64);
    expect(s.currentPlayerIndex).toBe(1);
  });

  test("with no token moved this turn nothing returns, and passed 6s count", () => {
    let s = deepFreeze(createGame(players(["red", "yellow"])));
    s = pass(roll(s, 6));
    s = pass(roll(s, 6));
    s = roll(s, 6);
    expect(s.currentPlayerIndex).toBe(1);
    expect(s.log[s.log.length - 1]).toMatchObject({ type: "three-sixes", returnedTokenId: null });
  });

  test("a bonus move counts as the most recently moved token", () => {
    const y = progressAt("yellow", 16);
    let s = makeState(["red", "yellow"], { "red-0": 10, "red-1": 30, "red-2": 40, "yellow-0": y });
    s = applyMove(roll(s, 6), { type: "ADVANCE", tokenId: "red-2", to: 46 });
    s = applyMove(roll(s, 6), { type: "ADVANCE", tokenId: "red-0", to: 16 }); // captures yellow-0
    expect(s.phase).toBe("awaiting-bonus");
    s = applyBonusMove(s, { kind: "capture-20", tokenId: "red-1", to: 50 });
    expect(s.phase).toBe("awaiting-roll");
    s = roll(s, 6);
    expect(progressOf(s, "red-1")).toBeNull();
    expect(progressOf(s, "red-0")).toBe(16);
  });
});

describe("8. invalid actions", () => {
  test("wrong phase, must move, illegal move, invalid roll, game over", () => {
    const g = deepFreeze(createGame(players(["red", "yellow"])));
    expect(errorCode(() => applyMove(g, { type: "ENTER", tokenId: "red-0" }))).toBe("WRONG_PHASE");
    expect(errorCode(() => pass(g))).toBe("WRONG_PHASE");
    expect(errorCode(() => applyBonusMove(g, { kind: "capture-20", tokenId: "red-0", to: 20 }))).toBe(
      "WRONG_PHASE",
    );
    for (const bad of [0, 7, 2.5, NaN]) {
      expect(errorCode(() => roll(g, bad as 1))).toBe("INVALID_ROLL");
    }
    const five = roll(g, 5);
    expect(errorCode(() => roll(five, 3))).toBe("WRONG_PHASE");
    expect(errorCode(() => pass(five))).toBe("MUST_MOVE");
    expect(errorCode(() => applyMove(five, { type: "ADVANCE", tokenId: "red-0", to: 5 }))).toBe(
      "ILLEGAL_MOVE",
    );
    expect(errorCode(() => applyMove(five, { type: "ENTER", tokenId: "yellow-0" }))).toBe("ILLEGAL_MOVE");
    const none = roll(g, 3);
    expect(errorCode(() => applyMove(none, { type: "ENTER", tokenId: "red-0" }))).toBe("ILLEGAL_MOVE");

    const won = makeState(["red", "yellow"], { "red-0": 71 }, { phase: "finished", winnerId: "red" });
    expect(errorCode(() => roll(won, 3))).toBe("GAME_OVER");
    expect(errorCode(() => pass(won))).toBe("GAME_OVER");
  });

  test("garbage state is rejected", () => {
    expect(errorCode(() => roll({} as GameState, 3))).toBe("INVALID_STATE");
  });
});

describe("9. exact goal", () => {
  test("70 needs exactly 1; overshoot is illegal; goal tokens cannot move", () => {
    const base = { "red-0": 70, "red-1": 10 };
    expect(getLegalMoves(roll(makeState(["red", "yellow"], base), 1))).toContainEqual({
      type: "ADVANCE",
      tokenId: "red-0",
      to: 71,
    });
    expect(getLegalMoves(roll(makeState(["red", "yellow"], base), 2)).some((m) => m.tokenId === "red-0")).toBeFalse();
    const goal = roll(makeState(["red", "yellow"], { "red-0": 71, "red-1": 10 }), 3);
    expect(getLegalMoves(goal)).toEqual([{ type: "ADVANCE", tokenId: "red-1", to: 13 }]);
  });
});

describe("10. winning", () => {
  test("the fourth token at the goal ends the game: no bonus, no extra roll", () => {
    const s = roll(makeState(["red", "yellow"], { "red-0": 71, "red-1": 71, "red-2": 71, "red-3": 64 }), 6);
    expect(s.moveDistance).toBe(7);
    const won = applyMove(s, { type: "ADVANCE", tokenId: "red-3", to: 71 });
    expect(won.phase).toBe("finished");
    expect(isFinished(won)).toBeTrue();
    expect(getWinnerId(won)).toBe("red");
    expect(won.bonus).toBeNull();
    expect(won.log[won.log.length - 1]).toEqual({ type: "win", turn: 1, playerId: "red" });
    expect(validateState(won)).toEqual([]);
  });
});

describe("11. home bonus (10)", () => {
  test("reaching the goal with a non-final token grants a mandatory 10", () => {
    const s = applyMove(roll(makeState(["red", "yellow"], { "red-0": 68, "red-1": 10 }), 3), {
      type: "ADVANCE",
      tokenId: "red-0",
      to: 71,
    });
    expect(s.phase).toBe("awaiting-bonus");
    expect(s.bonus).toEqual({ kind: "home-10", playerId: "red" });
    expect(getLegalBonusMoves(s)).toEqual([{ kind: "home-10", tokenId: "red-1", to: 20 }]);
    expect(errorCode(() => roll(s, 3))).toBe("WRONG_PHASE");
    const after = applyBonusMove(s, { kind: "home-10", tokenId: "red-1", to: 20 });
    expect(progressOf(after, "red-1")).toBe(20);
    expect(after.currentPlayerIndex).toBe(1);
  });

  test("with no legal 10 the bonus is forfeited and logged", () => {
    const s = applyMove(roll(makeState(["red", "yellow"], { "red-0": 68, "red-1": 65 }), 3), {
      type: "ADVANCE",
      tokenId: "red-0",
      to: 71,
    });
    expect(s.phase).toBe("awaiting-roll");
    expect(s.currentPlayerIndex).toBe(1);
    expect(s.log.some((e) => e.type === "bonus-forfeited" && e.kind === "home-10")).toBeTrue();
  });
});

describe("12. capture and the 20 bonus", () => {
  test("capture on a non-safe square sends the opponent home and grants a 20", () => {
    const y = progressAt("yellow", 13);
    const s = applyMove(roll(makeState(["red", "yellow"], { "red-0": 10, "red-1": 30, "yellow-0": y }), 3), {
      type: "ADVANCE",
      tokenId: "red-0",
      to: 13,
    });
    expect(progressOf(s, "yellow-0")).toBeNull();
    expect(s.phase).toBe("awaiting-bonus");
    expect(getLegalBonusMoves(s)).toEqual([
      { kind: "capture-20", tokenId: "red-0", to: 33 },
      { kind: "capture-20", tokenId: "red-1", to: 50 },
    ]);
    expect(s.log.find((e) => e.type === "capture")).toEqual({
      type: "capture",
      turn: 1,
      playerId: "red",
      tokenId: "red-0",
      capturedPlayerId: "yellow",
      capturedTokenId: "yellow-0",
      trackIndex: 13,
    });
  });

  test("with no legal 20 the capture bonus is forfeited", () => {
    const y = progressAt("yellow", 53);
    const s = applyMove(roll(makeState(["red", "yellow"], { "red-0": 50, "yellow-0": y }), 3), {
      type: "ADVANCE",
      tokenId: "red-0",
      to: 53,
    });
    expect(progressOf(s, "yellow-0")).toBeNull();
    expect(s.phase).toBe("awaiting-roll");
    expect(s.log.some((e) => e.type === "bonus-forfeited" && e.kind === "capture-20")).toBeTrue();
  });
});

describe("13. the 20 bonus rules", () => {
  test("exactly 20, never split, may capture, a bonus capture grants nothing more", () => {
    const s = applyMove(
      roll(
        makeState(["red", "yellow", "green"], {
          "red-0": 10,
          "yellow-0": progressAt("yellow", 13),
          "green-0": progressAt("green", 33),
        }),
        3,
      ),
      { type: "ADVANCE", tokenId: "red-0", to: 13 },
    );
    expect(errorCode(() => applyBonusMove(s, { kind: "capture-20", tokenId: "red-0", to: 23 }))).toBe(
      "INVALID_BONUS",
    );
    expect(errorCode(() => applyBonusMove(s, { kind: "home-10", tokenId: "red-0", to: 23 }))).toBe(
      "INVALID_BONUS",
    );
    expect(errorCode(() => applyMove(s, { type: "ADVANCE", tokenId: "red-0", to: 33 }))).toBe("WRONG_PHASE");
    const after = applyBonusMove(s, { kind: "capture-20", tokenId: "red-0", to: 33 });
    expect(progressOf(after, "green-0")).toBeNull();
    expect(after.phase).toBe("awaiting-roll");
    expect(after.bonus).toBeNull();
    expect(after.currentPlayerIndex).toBe(1);
    expect(after.log.filter((e) => e.type === "capture")).toHaveLength(2);
  });
});

describe("14. the 10 bonus rules", () => {
  test("exactly 10, may capture without chaining", () => {
    const s = applyMove(
      roll(makeState(["red", "yellow"], { "red-0": 68, "red-1": 10, "yellow-0": progressAt("yellow", 20) }), 3),
      { type: "ADVANCE", tokenId: "red-0", to: 71 },
    );
    expect(errorCode(() => applyBonusMove(s, { kind: "home-10", tokenId: "red-1", to: 15 }))).toBe(
      "INVALID_BONUS",
    );
    const after = applyBonusMove(s, { kind: "home-10", tokenId: "red-1", to: 20 });
    expect(progressOf(after, "yellow-0")).toBeNull();
    expect(after.phase).toBe("awaiting-roll");
    expect(after.currentPlayerIndex).toBe(1);
  });

  test("a bonus move reaching the goal grants no further home bonus", () => {
    const s = applyMove(roll(makeState(["red", "yellow"], { "red-0": 68, "red-1": 61 }), 3), {
      type: "ADVANCE",
      tokenId: "red-0",
      to: 71,
    });
    const after = applyBonusMove(s, { kind: "home-10", tokenId: "red-1", to: 71 });
    expect(after.phase).toBe("awaiting-roll");
    expect(after.currentPlayerIndex).toBe(1);
  });

  test("a bonus move that brings home the fourth token wins", () => {
    const s = applyMove(
      roll(makeState(["red", "yellow"], { "red-0": 71, "red-1": 71, "red-2": 68, "red-3": 61 }), 3),
      { type: "ADVANCE", tokenId: "red-2", to: 71 },
    );
    const won = applyBonusMove(s, { kind: "home-10", tokenId: "red-3", to: 71 });
    expect(won.phase).toBe("finished");
    expect(won.winnerId).toBe("red");
  });
});

describe("15. bonus moves obey barriers, safe sharing, occupancy and exact goal", () => {
  test("only the unobstructed 20 is offered", () => {
    const blueBarrier = progressAt("blue", 30);
    const s = applyMove(
      roll(
        makeState(["red", "blue", "yellow"], {
          "red-0": 10,
          "red-1": 31,
          "red-2": 55,
          "red-3": 40,
          "blue-0": blueBarrier,
          "blue-1": blueBarrier,
          "yellow-0": progressAt("yellow", 13),
          "yellow-1": progressAt("yellow", 51),
        }),
        3,
      ),
      { type: "ADVANCE", tokenId: "red-0", to: 13 },
    );
    // red-0 13→33 passes the barrier on 30; red-1 31→51 lands on an opponent on a safe square;
    // red-2 55→75 overshoots; red-3 40→60 passes the single yellow token on 51.
    expect(getLegalBonusMoves(s)).toEqual([{ kind: "capture-20", tokenId: "red-3", to: 60 }]);
  });
});

describe("24. purity", () => {
  test("deep-frozen inputs are never mutated", () => {
    const start = makeState(["red", "yellow"], { "red-0": 10, "red-1": 30, "yellow-0": progressAt("yellow", 13) });
    const snapshot = JSON.stringify(start);
    const rolled = roll(start, 3);
    deepFreeze(rolled);
    const moved = applyMove(rolled, { type: "ADVANCE", tokenId: "red-0", to: 13 });
    deepFreeze(moved);
    applyBonusMove(moved, { kind: "capture-20", tokenId: "red-1", to: 50 });
    pass(deepFreeze(roll(deepFreeze(createGame(players(["red", "yellow"]))), 2)));
    expect(JSON.stringify(start)).toBe(snapshot);
    expect(rolled.phase).toBe("awaiting-move");
    expect(moved.phase).toBe("awaiting-bonus");
  });
});

describe("25. serialization and determinism", () => {
  test("JSON round-trip preserves state and future behaviour", () => {
    let s: GameState = createGame(players(["red", "blue", "yellow"]));
    const script: Array<(st: GameState) => GameState> = [
      (st) => roll(st, 5),
      (st) => applyMove(st, { type: "ENTER", tokenId: "red-0" }),
      (st) => roll(st, 3),
      (st) => pass(st),
      (st) => roll(st, 5),
      (st) => applyMove(st, { type: "ENTER", tokenId: "yellow-2" }),
    ];
    for (const step of script) s = step(s);
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    expect(copy).toEqual(s);
    const a = applyMove(roll(s, 6), { type: "ADVANCE", tokenId: "red-0", to: 6 });
    const b = applyMove(roll(copy, 6), { type: "ADVANCE", tokenId: "red-0", to: 6 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("26. seat order and turn counter", () => {
  test("seats rotate in array order; extra rolls keep the seat and the turn", () => {
    for (const colors of [
      ["yellow", "red"],
      ["green", "red", "blue"],
      ["blue", "green", "red", "yellow"],
    ] as Color[][]) {
      let s = createGame(players(colors));
      const order: string[] = [];
      for (let i = 0; i < colors.length * 2; i++) {
        order.push(s.players[s.currentPlayerIndex].id);
        expect(s.turn).toBe(i + 1);
        const six = pass(roll(s, 6)); // extra roll: same seat, same turn
        expect(six.currentPlayerIndex).toBe(s.currentPlayerIndex);
        expect(six.turn).toBe(s.turn);
        s = pass(roll(six, 2));
      }
      expect(order).toEqual([...colors, ...colors]);
      expect(s.players.map((p) => p.seat)).toEqual(colors.map((_, i) => i));
    }
  });
});
