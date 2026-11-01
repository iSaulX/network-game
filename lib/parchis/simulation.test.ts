import { describe, expect, test } from "bun:test";
import {
  applyBonusMove,
  applyMove,
  chooseBarrier,
  createGame,
  getLegalBonusMoves,
  getLegalMoves,
  roll,
  rollDice,
  validateState,
  type Color,
  type GameState,
} from "./index";
import { mulberry32 } from "./test-helpers";

const GAMES = 500;
const ACTION_CAP = 30_000;
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
  let state = createGame(colors.map((color) => ({ id: `p-${color}`, color })));
  let actions = 0;

  while (state.phase !== "finished" && actions < ACTION_CAP) {
    const before = state;

    if (state.phase === "awaiting-roll") {
      state = roll(state, rollDice(random));
    } else if (state.phase === "awaiting-move") {
      const moves = getLegalMoves(state);
      if (moves.length === 0) throw new Error(`seed ${seed}: awaiting-move with no moves`);
      state = applyMove(state, moves[Math.floor(random() * moves.length)]);
    } else if (state.phase === "awaiting-barrier") {
      const squares = state.barrierChoice?.squares ?? [];
      if (squares.length === 0) throw new Error(`seed ${seed}: awaiting-barrier with no choices`);
      state = chooseBarrier(state, squares[Math.floor(random() * squares.length)]);
    } else {
      const bonus = getLegalBonusMoves(state);
      if (bonus.length === 0) throw new Error(`seed ${seed}: awaiting-bonus with no legal bonus move`);
      state = applyBonusMove(state, bonus[Math.floor(random() * bonus.length)]);
    }

    actions++;

    if (checkInvariants) {
      const problems = validateState(state);
      if (problems.length > 0) {
        throw new Error(`seed ${seed}, action ${actions}: ${problems.join("; ")}`);
      }
      if (state.log.length < before.log.length) throw new Error(`seed ${seed}: log shrank`);
      for (let index = 0; index < before.log.length; index++) {
        if (state.log[index] !== before.log[index]) {
          throw new Error(`seed ${seed}: log entry ${index} changed`);
        }
      }
    }
  }

  return { state, actions };
}

describe("simulation", () => {
  test(
    `${GAMES} seeded two-dice games finish with a winner and valid invariants`,
    () => {
      let totalActions = 0;
      let longest = 0;

      for (let seed = 1; seed <= GAMES; seed++) {
        const { state, actions } = simulate(seed, true);
        expect(state.phase).toBe("finished");
        expect(state.winnerId).not.toBeNull();
        const winner = state.players.find((player) => player.id === state.winnerId);
        expect(winner?.tokens.every((token) => token.zone === "goal")).toBeTrue();
        expect(state.log[state.log.length - 1]).toMatchObject({
          type: "win",
          playerId: state.winnerId,
        });
        expect(() => JSON.parse(JSON.stringify(state.log))).not.toThrow();
        totalActions += actions;
        longest = Math.max(longest, actions);
      }

      expect(longest).toBeLessThan(ACTION_CAP);
      console.log(
        `simulated ${GAMES} two-dice games, ${totalActions} actions, longest ${longest}`,
      );
    },
    180_000,
  );

  test("replaying the same seed is fully deterministic", () => {
    for (const seed of [7, 42, 1234]) {
      expect(JSON.stringify(simulate(seed, false).state)).toBe(
        JSON.stringify(simulate(seed, false).state),
      );
    }
  });
});
