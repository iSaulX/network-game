import { describe, expect, test } from "bun:test";
import {
  describeLobby,
  INITIAL_LOBBY_STATE,
  isLobbyFailure,
  LOBBY_FAILURE_COPY,
  reduceLobby,
  seatLabel,
  type LobbyState,
} from "./lobby";
import type { LanPlayerInfo } from "../protocol";

const HOST: LanPlayerInfo = {
  id: "host",
  name: "Ana",
  avatar: "/pictures/dog.png",
};
const GUEST: LanPlayerInfo = {
  id: "guest-1",
  name: "Bruno",
  avatar: "/pictures/octupus.png",
};

function hostLobby(mode: "1v1" | "all" = "1v1"): LobbyState {
  return reduceLobby(
    reduceLobby(INITIAL_LOBBY_STATE, { type: "CREATE", mode }),
    { type: "ROOM_CREATED", code: "ABC234", mode, players: [HOST] },
  );
}

describe("lobby reducer", () => {
  test("create moves to the host lobby with the room code", () => {
    const state = hostLobby();
    expect(state).toMatchObject({
      phase: "host-lobby",
      role: "host",
      code: "ABC234",
      capacity: 2,
      players: [HOST],
    });
  });

  test("the mode decides the capacity", () => {
    expect(hostLobby("1v1").capacity).toBe(2);
    expect(hostLobby("all").capacity).toBe(4);
  });

  test("guest form and joining keep the guest role", () => {
    const form = reduceLobby(INITIAL_LOBBY_STATE, {
      type: "OPEN_GUEST_FORM",
      mode: "all",
    });
    expect(form).toMatchObject({
      phase: "guest-form",
      role: "guest",
      capacity: 4,
    });

    const joining = reduceLobby(form, { type: "JOINING" });
    expect(joining.phase).toBe("joining");

    const joined = reduceLobby(joining, { type: "ROOM_JOINED", code: "ABC234" });
    expect(joined).toMatchObject({
      phase: "guest-lobby",
      code: "ABC234",
      capacity: 4,
    });

    // While connecting, the copy says so instead of implying a broken room.
    expect(describeLobby(joining).title).toContain("Conectando");
    expect(describeLobby(joined).title).toBe("Conectando…");

    const seated = reduceLobby(joined, {
      type: "LOBBY",
      players: [HOST, GUEST],
      mode: "all",
      capacity: 4,
    });
    expect(describeLobby(seated).title).toBe("Estás dentro");
  });

  test("lobby updates replace the live roster", () => {
    const state = reduceLobby(hostLobby("all"), {
      type: "LOBBY",
      players: [HOST, GUEST],
      mode: "all",
      capacity: 4,
    });

    expect(state.players).toEqual([HOST, GUEST]);
    // An identical update returns the same object.
    expect(
      reduceLobby(state, {
        type: "LOBBY",
        players: [HOST, GUEST],
        mode: "all",
        capacity: 4,
      }),
    ).toBe(state);
  });

  test("a failure overrides the phase and reset returns to choosing", () => {
    const failed = reduceLobby(hostLobby(), {
      type: "FAIL",
      failure: "ice-failed",
    });
    expect(failed.phase).toBe("failed");
    expect(failed.failure).toBe("ice-failed");

    expect(reduceLobby(failed, { type: "RESET" })).toEqual(INITIAL_LOBBY_STATE);
  });

  test("every failure has Spanish copy and passes the guard", () => {
    for (const key of Object.keys(LOBBY_FAILURE_COPY)) {
      expect(isLobbyFailure(key)).toBeTrue();
      expect(LOBBY_FAILURE_COPY[key as keyof typeof LOBBY_FAILURE_COPY].length)
        .toBeGreaterThan(0);
    }
    expect(isLobbyFailure("nope")).toBeFalse();
  });

  test("described copy reports the failure text", () => {
    const failed = reduceLobby(hostLobby(), {
      type: "FAIL",
      failure: "room-not-found",
    });
    const described = describeLobby(failed);
    expect(described.tone).toBe("error");
    expect(described.detail).toBe(LOBBY_FAILURE_COPY["room-not-found"]);
  });

  test("the host lobby copy counts the guests", () => {
    const empty = describeLobby(hostLobby("all"));
    expect(empty.detail).toContain("bots");

    const partial = describeLobby(
      reduceLobby(hostLobby("all"), {
        type: "LOBBY",
        players: [HOST, GUEST],
        mode: "all",
        capacity: 4,
      }),
    );
    expect(partial.detail).toContain("1 de 3");
  });

  test("seat labels name the host and each guest", () => {
    expect(seatLabel("host")).toBe("Anfitrión");
    expect(seatLabel("guest-2")).toBe("Invitado 2");
  });
});
