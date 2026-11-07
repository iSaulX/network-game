import { describe, expect, test } from "bun:test";
import { createGame } from "@/lib/parchis";
import { deepFreeze } from "@/lib/parchis/test-helpers";
import {
  applyAction,
  createRateLimiter,
  cryptoDice,
  newEvents,
} from "./authority";

function newGame() {
  return createGame([
    { id: "host", color: "red" },
    { id: "guest", color: "yellow" },
  ]);
}

const dice = (): [3, 3] => [3, 3];

describe("authority", () => {
  test("rolls with the supplied dice and bumps the version", () => {
    const state = newGame();
    const result = applyAction(
      { state, version: 0, actorId: "host", action: { type: "ROLL" } },
      dice,
    );

    expect(result.ok).toBeTrue();
    if (!result.ok) return;

    expect(result.version).toBe(1);
    expect(result.events[0]).toMatchObject({ type: "roll", dice: [3, 3] });
    // 3+3 with every token in the yard is an automatic pass, so the dice are
    // consumed; the roll event still records the drawn faces.
    expect(result.state.log[0]).toMatchObject({ type: "roll", dice: [3, 3] });
  });

  test("only the current player may act", () => {
    const state = newGame();
    const result = applyAction(
      { state, version: 0, actorId: "guest", action: { type: "ROLL" } },
      dice,
    );

    expect(result).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
    if (!result.ok) {
      expect(result.state).toBe(state);
      expect(result.version).toBe(0);
    }
  });

  test("rejects an unknown actor and a finished game", () => {
    const state = newGame();
    expect(
      applyAction({ state, version: 0, actorId: "nobody", action: { type: "ROLL" } }, dice),
    ).toMatchObject({ ok: false, code: "BAD_MESSAGE" });

    const finished = { ...state, phase: "finished" as const, winnerId: "host" };
    expect(
      applyAction({ state: finished, version: 0, actorId: "host", action: { type: "ROLL" } }, dice),
    ).toMatchObject({ ok: false, code: "GAME_OVER" });
  });

  test("rejects an action that does not fit the phase", () => {
    const state = newGame();
    const result = applyAction(
      {
        state,
        version: 0,
        actorId: "host",
        action: { type: "MOVE", move: { type: "ADVANCE", tokenId: "host-0", to: 0, die: 3 } },
      },
      dice,
    );
    expect(result).toMatchObject({ ok: false, code: "WRONG_PHASE" });
  });

  test("rejects stale versions without touching the state", () => {
    const state = newGame();
    const result = applyAction(
      {
        state,
        version: 4,
        expectedVersion: 3,
        actorId: "host",
        action: { type: "ROLL" },
      },
      dice,
    );

    expect(result).toMatchObject({ ok: false, code: "STALE_VERSION" });
    if (!result.ok) {
      expect(result.state).toBe(state);
      expect(result.version).toBe(4);
    }
  });

  test("never mutates a frozen input state", () => {
    const state = deepFreeze(newGame());
    const result = applyAction(
      { state, version: 0, actorId: "host", action: { type: "ROLL" } },
      dice,
    );
    expect(result.ok).toBeTrue();
    expect(state.phase).toBe("awaiting-roll");
  });

  test("newEvents returns only the appended tail", () => {
    const state = newGame();
    const result = applyAction(
      { state, version: 0, actorId: "host", action: { type: "ROLL" } },
      dice,
    );
    if (!result.ok) throw new Error("unexpected");
    expect(newEvents(state, result.state)).toEqual(result.state.log.slice(state.log.length));
    expect(newEvents(state, result.state).length).toBeGreaterThan(0);
  });
});

describe("crypto dice", () => {
  test("maps every byte window to 1–6 and never exceeds the bias cutoff", () => {
    const seen = new Set<number>();
    let cursor = 0;

    const draw = cryptoDice((into) => {
      // Walk 250…255 so the rejection path is exercised, then cycle 0…5.
      into[0] = cursor < 6 ? 250 + cursor : (cursor - 6) % 6;
      cursor += 1;
      return into;
    });

    for (let index = 0; index < 60; index += 1) {
      for (const value of draw()) {
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(6);
        seen.add(value);
      }
    }

    expect(seen.size).toBe(6);
  });
});

describe("rate limiter", () => {
  test("allows the limit and denies the next call in the window", () => {
    let now = 0;
    const allow = createRateLimiter(2, 1000, () => now);

    expect(allow("guest")).toBeTrue();
    expect(allow("guest")).toBeTrue();
    expect(allow("guest")).toBeFalse();

    now = 1500;
    expect(allow("guest")).toBeTrue();
  });
});
