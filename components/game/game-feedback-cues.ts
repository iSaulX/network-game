import { GOAL_PROGRESS, type GameState } from "@/lib/parchis";

export type FeedbackEvent = GameState["log"][number];

export type FeedbackActor = "human" | "bot";
export type FeedbackCapture = "human" | "victim" | "bot";

/**
 * The single feedback cue a batch of game-log events should produce.
 *
 * One turn can append several events at once (roll + enter, advance +
 * capture, advance + goal + win). The cue intentionally picks the most
 * meaningful one so a single state change never stacks several haptics.
 */
export type FeedbackCue =
  | { type: "win"; actor: FeedbackActor }
  | { type: "capture"; outcome: FeedbackCapture }
  | { type: "goal"; actor: FeedbackActor }
  | { type: "three-doubles"; actor: FeedbackActor }
  | { type: "barrier"; actor: FeedbackActor }
  | { type: "move"; actor: FeedbackActor }
  | { type: "entry" }
  | { type: "roll" };

function actorFor(playerId: string, humanId: string): FeedbackActor {
  return playerId === humanId ? "human" : "bot";
}

export function getFeedbackCue(
  newEvents: readonly FeedbackEvent[],
  humanId: string,
): FeedbackCue | null {
  if (newEvents.length === 0) return null;

  const win = newEvents.find((event) => event.type === "win");
  if (win) {
    return { type: "win", actor: actorFor(win.playerId, humanId) };
  }

  const capture = newEvents.find((event) => event.type === "capture");
  if (capture) {
    const outcome: FeedbackCapture =
      capture.capturedPlayerId === humanId
        ? "victim"
        : capture.playerId === humanId
          ? "human"
          : "bot";
    return { type: "capture", outcome };
  }

  const goal = newEvents.find(
    (event) =>
      (event.type === "advance" ||
        event.type === "bonus-move" ||
        event.type === "barrier-break") &&
      event.to === GOAL_PROGRESS,
  );
  if (goal) {
    return { type: "goal", actor: actorFor(goal.playerId, humanId) };
  }

  const threeDoubles = newEvents.find(
    (event) => event.type === "three-doubles",
  );
  if (threeDoubles) {
    return {
      type: "three-doubles",
      actor: actorFor(threeDoubles.playerId, humanId),
    };
  }

  const barrier = newEvents.find((event) => event.type === "barrier-break");
  if (barrier) {
    return { type: "barrier", actor: actorFor(barrier.playerId, humanId) };
  }

  const move = newEvents.find(
    (event) => event.type === "advance" || event.type === "bonus-move",
  );
  if (move) {
    return { type: "move", actor: actorFor(move.playerId, humanId) };
  }

  if (newEvents.some((event) => event.type === "enter")) {
    return { type: "entry" };
  }

  if (newEvents.some((event) => event.type === "roll")) {
    return { type: "roll" };
  }

  return null;
}
