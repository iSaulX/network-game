import { describe, expect, test } from "bun:test";
import { BOARD_TO_ENGINE_COLOR } from "@/lib/parchis";
import {
  BOARD_COLOR_ORDER,
  OPPOSITE_COLOR,
  createGameSetup,
  getGameSettingsFromSearchParams,
} from "./game-players";

describe("local game setup", () => {
  test("builds the chosen human and the three bots in colour order", () => {
    const setup = createGameSetup({
      mode: "all",
      color: "red",
      name: "  Ana  ",
      avatar: "/pictures/bee.png",
    });

    expect(setup.human).toMatchObject({
      id: "human",
      name: "Ana",
      avatar: "/pictures/bee.png",
      color: "red",
      engineColor: BOARD_TO_ENGINE_COLOR.red,
    });
    expect(setup.seats.map((seat) => seat.color)).toEqual([
      "blue",
      "red",
      "yellow",
      "green",
    ]);
    expect(setup.seats.map((seat) => seat.id)).toEqual([
      "bruno",
      "human",
      "diego",
      "ana",
    ]);
    expect(setup.configs).toHaveLength(4);
    expect(setup.configs.map((config) => config.color)).toEqual([
      "blue",
      "yellow",
      "green",
      "red",
    ]);
  });

  test("1v1 uses the opposite-corner colour and filters the turn order", () => {
    expect(OPPOSITE_COLOR).toEqual({
      blue: "yellow",
      yellow: "blue",
      red: "green",
      green: "red",
    });

    for (const color of BOARD_COLOR_ORDER) {
      const setup = createGameSetup({
        mode: "1v1",
        color,
        name: "Jugador",
        avatar: "/pictures/dog.png",
      });

      expect(setup.seats).toHaveLength(2);
      expect(setup.seats.map((seat) => seat.color)).toEqual(
        BOARD_COLOR_ORDER.filter(
          (item) => item === color || item === OPPOSITE_COLOR[color],
        ),
      );
      expect(setup.human.id).toBe("human");
      expect(setup.human.color).toBe(color);
      expect(
        setup.seats.some(
          (seat) => seat.id !== "human" && seat.color === OPPOSITE_COLOR[color],
        ),
      ).toBeTrue();
    }
  });

  test("parses and validates URL settings", () => {
    const parsed = getGameSettingsFromSearchParams(
      new URLSearchParams(
        "mode=1v1&color=green&name=Alex&avatar=%2Fpictures%2Funicorn.png",
      ),
    );
    expect(parsed).toEqual({
      mode: "1v1",
      color: "green",
      name: "Alex",
      avatar: "/pictures/unicorn.png",
    });

    const defaults = getGameSettingsFromSearchParams(
      new URLSearchParams("mode=unknown&color=purple&name=&avatar=%2Fevil"),
    );
    expect(defaults).toEqual({
      mode: "all",
      color: "blue",
      name: "Bruno",
      avatar: "/pictures/octupus.png",
    });

    const longName = getGameSettingsFromSearchParams(
      new URLSearchParams(`name=${"x".repeat(40)}`),
    );
    expect(longName.name).toHaveLength(24);
  });
});
