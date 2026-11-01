import { describe, expect, test } from "bun:test";
import { getGameResultSummary } from "./game-result";

describe("game result summary", () => {
  test("uses the trophy and victory copy when the human wins", () => {
    const result = getGameResultSummary(true, "Bruno");

    expect(result.humanWon).toBe(true);
    expect(result.title).toBe("¡Has ganado!");
    expect(result.description).toContain("cuatro fichas");
    expect(result.image).toBe("/game-results/win.png");
    expect(result.alt).toContain("victoria");
  });

  test("uses the crying artwork and names the winner when the human loses", () => {
    const result = getGameResultSummary(false, "Carla");

    expect(result.humanWon).toBe(false);
    expect(result.title).toBe("Has perdido");
    expect(result.description).toContain("Carla");
    expect(result.description).toContain("ha ganado la partida");
    expect(result.image).toBe("/game-results/loser.png");
    expect(result.alt).toContain("derrota");
  });

  test("falls back to a neutral rival name for a blank winner", () => {
    const result = getGameResultSummary(false, "   ");

    expect(result.description).toContain("El rival");
    expect(result.description).not.toContain("  ");
  });
});
