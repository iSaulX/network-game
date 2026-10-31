import { describe, expect, test } from "bun:test";
import {
  applyBonusMove,
  applyMove,
  createGame,
  getLegalBonusMoves,
  getLegalMoves,
  pass,
  roll,
  rollDie,
  validateState,
  type Color,
  type GameState,
} from "./index";
import { mulberry32 } from "./test-helpers";

const GAMES = 500;
const ACTION_CAP = 20_000;
const SEATINGS: Color[][] = [
  ["red", "yellow"],
  ["red", "blue", "yellow"],
  ["red", "blue", "yellow", "green"],
];

interface SimResult {
  state: GameState;
  actions: number;
}

/** Plays one full game with random legal actions from a seeded PRNG. */
function simulate(seed: number, checkInvariants: boolean): SimResult {
  const random = mulberry32(seed);
  const colors = SEATINGS[seed % SEATINGS.length];
  let state = createGame(colors.map((c) => ({ id: `p-${c}`, color: c })));
  let actions = 0;

  while (state.phase !== "finished" && actions < ACTION_CAP) {
    const before = state;
    if (state.phase === "awaiting-roll") {
      state = roll(state, rollDie(random));
    } else if (state.phase === "awaiting-move") {
      const moves = getLegalMoves(state);
      state = moves.length === 0 ? pass(state) : applyMove(state, moves[Math.floor(random() * moves.length)]);
    } else {
      const bonus = getLegalBonusMoves(state);
      if (bonus.length === 0) throw new Error(`seed ${seed}: awaiting-bonus with no legal bonus move`);
      state = applyBonusMove(state, bonus[Math.floor(random() * bonus.length)]);
    }
    actions++;

    if (checkInvariants) {
      const problems = validateState(state);
      if (problems.length > 0) throw new Error(`seed ${seed}, action ${actions}: ${problems.join("; ")}`);
      // Log is append-only: previous entries are kept untouched.
      if (state.log.length < before.log.length) throw new Error(`seed ${seed}: log shrank`);
      for (let i = 0; i < before.log.length; i++) {
        if (state.log[i] !== before.log[i]) throw new Error(`seed ${seed}: log entry ${i} changed`);
      }
    }
  }
  return { state, actions };
}

describe("27. simulation", () => {
  test(
    `${GAMES} seeded random games finish with a winner and valid invariants`,
    () => {
      let totalActions = 0;
      let longest = 0;
      for (let seed = 1; seed <= GAMES; seed++) {
        const { state, actions } = simulate(seed, true);
        expect(state.phase).toBe("finished");
        expect(state.winnerId).not.toBeNull();
        const winner = state.players.find((p) => p.id === state.winnerId);
        expect(winner?.tokens.every((t) => t.zone === "goal")).toBeTrue();
        expect(state.log[state.log.length - 1]).toMatchObject({ type: "win", playerId: state.winnerId });
        expect(() => JSON.parse(JSON.stringify(state.log))).not.toThrow();
        totalActions += actions;
        longest = Math.max(longest, actions);
      }
      expect(longest).toBeLessThan(ACTION_CAP);
      console.log(`simulated ${GAMES} games, ${totalActions} actions, longest ${longest}`);
    },
    120_000,
  );

  test("replaying the same seed is fully deterministic", () => {
    for (const seed of [7, 42, 1234]) {
      expect(JSON.stringify(simulate(seed, false).state)).toBe(JSON.stringify(simulate(seed, false).state));
    }
  });
});
