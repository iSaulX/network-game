import { describe, expect, test } from "bun:test";
import { GOAL_PROGRESS } from "@/lib/parchis";
import { getFeedbackCue, type FeedbackEvent } from "./game-feedback-cues";

const HUMAN = "human";
const BOT = "bot";

const roll = (playerId = HUMAN): FeedbackEvent => ({
  type: "roll",
  turn: 1,
  playerId,
  dice: [2, 3],
});

const enter = (playerId = HUMAN): FeedbackEvent => ({
  type: "enter",
  turn: 1,
  playerId,
  tokenId: `${playerId}-0`,
  die: null,
});

const advance = (playerId = HUMAN, to = 5): FeedbackEvent => ({
  type: "advance",
  turn: 1,
  playerId,
  tokenId: `${playerId}-0`,
  from: to - 3,
  to,
  die: 3,
});

const capture = (
  playerId = HUMAN,
  capturedPlayerId = BOT,
): FeedbackEvent => ({
  type: "capture",
  turn: 1,
  playerId,
  tokenId: `${playerId}-0`,
  capturedPlayerId,
  capturedTokenId: `${capturedPlayerId}-0`,
  trackIndex: 9,
});

const barrierBreak = (playerId = HUMAN, to = 4): FeedbackEvent => ({
  type: "barrier-break",
  turn: 1,
  playerId,
  tokenId: `${playerId}-0`,
  from: 1,
  to,
  die: 3,
  square: 1,
  automatic: true,
});

const bonusMove = (playerId = HUMAN, to = 5): FeedbackEvent => ({
  type: "bonus-move",
  turn: 1,
  playerId,
  kind: "capture-20",
  tokenId: `${playerId}-1`,
  from: 2,
  to,
});

const threeDoubles = (playerId = HUMAN): FeedbackEvent => ({
  type: "three-doubles",
  turn: 1,
  playerId,
  returnedTokenId: null,
});

const win = (playerId = HUMAN): FeedbackEvent => ({
  type: "win",
  turn: 1,
  playerId,
});

describe("game feedback cues", () => {
  test("returns no cue for an empty batch", () => {
    expect(getFeedbackCue([], HUMAN)).toBeNull();
  });

  test("a roll settles and a roll with an automatic entry pings", () => {
    expect(getFeedbackCue([roll()], HUMAN)).toEqual({ type: "roll" });
    expect(getFeedbackCue([roll(), enter()], HUMAN)).toEqual({
      type: "entry",
    });
  });

  test("normal and bonus moves identify the actor", () => {
    expect(getFeedbackCue([advance()], HUMAN)).toEqual({
      type: "move",
      actor: "human",
    });
    expect(getFeedbackCue([bonusMove(BOT)], HUMAN)).toEqual({
      type: "move",
      actor: "bot",
    });
  });

  test("captures distinguish the attacker, the victim and bot-only captures", () => {
    expect(getFeedbackCue([advance(), capture()], HUMAN)).toEqual({
      type: "capture",
      outcome: "human",
    });
    expect(getFeedbackCue([advance(BOT), capture(BOT, HUMAN)], HUMAN)).toEqual(
      { type: "capture", outcome: "victim" },
    );
    expect(getFeedbackCue([advance(BOT), capture(BOT, "third")], HUMAN)).toEqual(
      { type: "capture", outcome: "bot" },
    );
  });

  test("a move to the goal is a goal cue, before a barrier cue", () => {
    expect(getFeedbackCue([advance(HUMAN, GOAL_PROGRESS)], HUMAN)).toEqual({
      type: "goal",
      actor: "human",
    });
    expect(
      getFeedbackCue([barrierBreak(BOT, GOAL_PROGRESS)], HUMAN),
    ).toEqual({ type: "goal", actor: "bot" });
  });

  test("three doubles and barrier breaks report their actor", () => {
    expect(getFeedbackCue([roll(), threeDoubles()], HUMAN)).toEqual({
      type: "three-doubles",
      actor: "human",
    });
    expect(getFeedbackCue([barrierBreak(BOT)], HUMAN)).toEqual({
      type: "barrier",
      actor: "bot",
    });
  });

  test("victory wins over every other event in the same batch", () => {
    expect(
      getFeedbackCue(
        [advance(HUMAN, GOAL_PROGRESS), capture(HUMAN, BOT), win()],
        HUMAN,
      ),
    ).toEqual({ type: "win", actor: "human" });
    expect(getFeedbackCue([threeDoubles(BOT), win(BOT)], HUMAN)).toEqual({
      type: "win",
      actor: "bot",
    });
  });

  test("capture wins over goal, and pass-only batches produce no cue", () => {
    expect(
      getFeedbackCue(
        [advance(HUMAN, GOAL_PROGRESS), capture(HUMAN, BOT)],
        HUMAN,
      ),
    ).toEqual({ type: "capture", outcome: "human" });

    expect(
      getFeedbackCue(
        [{ type: "pass", turn: 1, playerId: BOT, dice: null }],
        HUMAN,
      ),
    ).toBeNull();
  });
});
