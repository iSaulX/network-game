"use client";

/**
 * Online party orchestration for the server-authoritative mode.
 *
 * Room creation/join still use the HTTP signaling endpoint (it allocates the
 * seat and token in Redis). Gameplay then runs over one authenticated
 * WebSocket per client: the server owns the state, validates actions and
 * broadcasts snapshots. The client session is the same adapter used by the
 * in-memory and WebRTC transports, so the UI stays transport-agnostic.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameFeedback } from "@/components/game/game-feedback";
import {
  capacityForMode,
  createVersusRoom,
  joinVersusRoom,
  type VersusClientFailure,
  type VersusCredentials,
} from "@/lib/party/versus/signaling-client";
import {
  INITIAL_LOBBY_STATE,
  reduceLobby,
  type LobbyEvent,
  type LobbyFailure,
  type LobbyState,
} from "@/lib/party/versus/lobby";
import type { GameMode, LanPlayerInfo } from "@/lib/party/protocol";
import type { GameSession, SessionSnapshot } from "@/lib/party/session";
import { ServerGameSession } from "@/lib/party/sessions/server-game-session";
import {
  PartySocketError,
  PartySocketTransport,
} from "@/lib/party/websocket/party-socket-transport";

/** The guest retries its join while the room is still being created. */
const JOIN_RETRY_LIMIT = 3;

/** How long an intentional LEAVE may take before the socket is closed. */
const LEAVE_GRACE_MS = 80;

export interface PartyProfile {
  readonly name: string;
  readonly avatar: string;
}

export interface PartyApi {
  readonly lobby: LobbyState;
  readonly snapshot: SessionSnapshot | null;
  readonly session: GameSession | null;
  /** Host: opens a room for the chosen mode and waits for guests. */
  createGame(mode: GameMode): void;
  /** Guest: shows the code form (no mode is needed to join). */
  openJoin(): void;
  joinGame(code: string): void;
  /** Host only: starts the match; empty seats become bots. */
  startGame(): void;
  /** Host only: leaves a seat empty (no bot) or fills it with a bot again. */
  setSeatEmpty(seatId: string, empty: boolean): void;
  retry(): void;
  abort(): void;
}

function mapClientFailure(failure: VersusClientFailure): LobbyFailure {
  switch (failure) {
    case "offline":
      return "offline";
    case "room-not-found":
      return "room-not-found";
    case "room-full":
      return "room-full";
    case "room-closed":
      return "room-closed";
    case "room-started":
      return "room-started";
    case "bad-request":
      // A malformed signaling request is never the user's typed code; the
      // join form validates the length before calling the server.
      return "protocol-error";
    case "peer-gone":
    case "too-many-signals":
    case "unauthorized":
    case "server-error":
    case "network":
      return "server-unreachable";
  }
}

function mapSocketFailure(code: PartySocketError["code"]): LobbyFailure {
  switch (code) {
    case "room-not-found":
      return "room-not-found";
    case "room-full":
      return "room-full";
    case "room-closed":
      return "room-closed";
    case "unauthorized":
      return "room-closed";
    case "timeout":
      return "timeout";
    case "bad-request":
      return "protocol-error";
    case "server-error":
      return "server-unreachable";
  }
}

export function usePartySession(
  self: PartyProfile,
  feedback: GameFeedback,
): PartyApi {
  const [lobby, setLobby] = useState<LobbyState>(INITIAL_LOBBY_STATE);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [session, setSession] = useState<GameSession | null>(null);

  const lobbyRef = useRef<LobbyState>(INITIAL_LOBBY_STATE);
  const transportRef = useRef<PartySocketTransport | null>(null);
  const sessionRef = useRef<ServerGameSession | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const unmountedRef = useRef(false);
  const joiningRef = useRef(false);

  const profile = useMemo<LanPlayerInfo>(
    () => ({
      id: "host",
      name: self.name.trim().slice(0, 24) || "Anfitrión",
      avatar: self.avatar,
    }),
    [self.avatar, self.name],
  );
  const profileRef = useRef(profile);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const dispatch = useCallback((event: LobbyEvent) => {
    setLobby((current) => {
      const next = reduceLobby(current, event);
      lobbyRef.current = next;
      return next;
    });
  }, []);

  const fail = useCallback(
    (failure: LobbyFailure) => {
      if (lobbyRef.current.phase === "connected") {
        return;
      }

      dispatch({ type: "FAIL", failure });
    },
    [dispatch],
  );

  const attachSession = useCallback(
    (next: ServerGameSession) => {
      sessionRef.current = next;
      setSession(next);
      unsubscribeRef.current?.();
      unsubscribeRef.current = next.subscribe((nextSnapshot) => {
        if (unmountedRef.current) {
          return;
        }

        setSnapshot(nextSnapshot);
        // The session is the source of truth for the seated humans.
        setLobby((current) => {
          const reduced = reduceLobby(current, {
            type: "LOBBY",
            players: nextSnapshot.lobby,
            mode: nextSnapshot.mode,
            capacity: capacityForMode(nextSnapshot.mode),
            emptySeats: nextSnapshot.emptySeats,
          });
          lobbyRef.current = reduced;
          return reduced;
        });

        if (nextSnapshot.state !== null) {
          setLobby((current) => {
            const reduced = reduceLobby(current, { type: "CONNECTED" });
            lobbyRef.current = reduced;
            return reduced;
          });
        }

        if (
          lobbyRef.current.phase !== "connected" &&
          lobbyRef.current.phase !== "failed"
        ) {
          if (nextSnapshot.status === "failed") {
            dispatch({ type: "FAIL", failure: "server-unreachable" });
          } else if (
            nextSnapshot.status === "disconnected" &&
            nextSnapshot.state === null
          ) {
            dispatch({ type: "FAIL", failure: "room-closed" });
          }
        }
      });
      setSnapshot(next.snapshot);
    },
    [dispatch],
  );

  const teardown = useCallback(() => {
    joiningRef.current = false;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;

    const currentSession = sessionRef.current;
    const currentTransport = transportRef.current;
    sessionRef.current = null;
    transportRef.current = null;
    setSession(null);
    setSnapshot(null);

    if (!currentSession || !currentTransport) {
      return;
    }

    // Best-effort intentional LEAVE so the seat is freed immediately; a
    // socket that is already down is handled by the server as a disconnect.
    currentSession.leave();

    setTimeout(() => {
      currentSession.dispose();
      currentTransport.close();
    }, LEAVE_GRACE_MS);
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      teardown();
    };
  }, [teardown]);

  const connectParty = useCallback(
    (credentials: VersusCredentials) => {
      const player: LanPlayerInfo = {
        ...profileRef.current,
        id: credentials.id as LanPlayerInfo["id"],
      };

      const transport = new PartySocketTransport({
        code: credentials.code,
        id: credentials.id,
        token: credentials.token,
        player,
      });
      transportRef.current = transport;

      const next = new ServerGameSession({
        transport,
        playerId: credentials.id,
        player,
        control: (message) => transport.sendControl(message),
      });
      attachSession(next);

      void transport.connect().catch((error: unknown) => {
        if (unmountedRef.current) {
          return;
        }

        const failure =
          error instanceof PartySocketError
            ? mapSocketFailure(error.code)
            : "server-unreachable";
        fail(failure);
      });
    },
    [attachSession, fail],
  );

  const createGame = useCallback(
    (mode: GameMode) => {
      feedback.select();
      teardown();
      dispatch({ type: "CREATE", mode });

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        fail("offline");
        return;
      }

      void (async () => {
        const created = await createVersusRoom(capacityForMode(mode));

        if (unmountedRef.current) return;

        if (!created.ok) {
          fail(mapClientFailure(created.failure));
          return;
        }

        const credentials = created.value;

        dispatch({
          type: "ROOM_CREATED",
          code: credentials.code,
          mode,
          players: [profileRef.current],
        });
        connectParty(credentials);
      })();
    },
    [connectParty, dispatch, fail, feedback, teardown],
  );

  const openJoin = useCallback(() => {
    feedback.select();
    teardown();
    dispatch({ type: "OPEN_GUEST_FORM", mode: "1v1" });
  }, [dispatch, feedback, teardown]);

  const joinGame = useCallback(
    (rawCode: string) => {
      const code = rawCode.trim().toUpperCase();

      feedback.tap();

      if (code.length !== 6) {
        fail("bad-code");
        return;
      }

      dispatch({ type: "JOINING" });

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        fail("offline");
        return;
      }

      joiningRef.current = true;

      void (async () => {
        // A room created a moment ago may not be listed yet; retry briefly.
        for (let attempt = 0; attempt < JOIN_RETRY_LIMIT; attempt += 1) {
          const joined = await joinVersusRoom(code);

          if (unmountedRef.current || !joiningRef.current) return;

          if (joined.ok) {
            const credentials = joined.value;

            dispatch({ type: "ROOM_JOINED", code: credentials.code });
            connectParty(credentials);
            return;
          }

          if (
            joined.failure !== "room-not-found" ||
            attempt === JOIN_RETRY_LIMIT - 1
          ) {
            fail(mapClientFailure(joined.failure));
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 600));
        }
      })();
    },
    [connectParty, dispatch, fail, feedback],
  );

  const startGame = useCallback(() => {
    feedback.start();
    sessionRef.current?.start();
  }, [feedback]);

  const setSeatEmpty = useCallback(
    (seatId: string, empty: boolean) => {
      feedback.select();
      sessionRef.current?.setSeatEmpty(seatId, empty);
    },
    [feedback],
  );

  const retry = useCallback(() => {
    feedback.tap();
    const previous = lobbyRef.current;
    teardown();
    dispatch({ type: "RESET" });

    setTimeout(() => {
      if (previous.role === "host") {
        createGame(previous.mode);
      } else if (previous.role === "guest") {
        openJoin();
      }
    }, 0);
  }, [createGame, dispatch, feedback, openJoin, teardown]);

  const abort = useCallback(() => {
    feedback.tap();
    teardown();
    dispatch({ type: "RESET" });
  }, [dispatch, feedback, teardown]);

  return {
    lobby,
    snapshot,
    session,
    createGame,
    openJoin,
    joinGame,
    startGame,
    setSeatEmpty,
    retry,
    abort,
  };
}
