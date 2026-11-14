"use client";

/**
 * Online party orchestration: owns the signaling HTTP client, one
 * `RTCPeerConnection` per guest, the host/guest game sessions, and exposes
 * exactly what the setup flow renders.
 *
 * Signaling is fully automatic (no QR, no copy/paste). Gameplay is peer-to-peer
 * over a data channel per guest, with the host as the star's centre. There is
 * no TURN and no fallback: if a direct connection cannot be established the
 * guest reports a Spanish failure. Empty seats become bots when the host starts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameFeedback } from "@/components/game/game-feedback";
import {
  capacityForMode,
  createVersusRoom,
  joinVersusRoom,
  SIGNAL_POLL_MS,
  VersusSignalingClient,
  type VersusClientFailure,
  type VersusCredentials,
  type VersusSignal,
} from "@/lib/party/versus/signaling-client";
import {
  INITIAL_LOBBY_STATE,
  reduceLobby,
  type LobbyEvent,
  type LobbyFailure,
  type LobbyState,
} from "@/lib/party/versus/lobby";
import {
  decodeDescription,
  encodeDescription,
} from "@/lib/party/versus/description";
import {
  acceptHostAnswer,
  acceptHostOffer,
  createHostOffer,
  selectIceServers,
  waitForDataChannel,
  type PairingDescription,
} from "@/lib/party/webrtc/signaling";
import {
  createWebRTCTransport,
  type WebRTCTransport,
} from "@/lib/party/webrtc/peer-connection";
import {
  defaultPeerConnectionFactory,
  type DataChannelLike,
  type PeerConnectionLike,
} from "@/lib/party/webrtc/types";
import type { GameMode, LanPlayerInfo } from "@/lib/party/protocol";
import type { GameSession, SessionSnapshot } from "@/lib/party/session";
import { WebRTCHostSession } from "@/lib/party/sessions/webrtc-host-session";
import { WebRTCGuestSession } from "@/lib/party/sessions/webrtc-guest-session";

/** How long a peer may take to open the data channel before we give up. */
export const CONNECT_TIMEOUT_MS = 20_000;

/** The guest retries its join while the room is still being created. */
const JOIN_RETRY_LIMIT = 3;

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
    case "bad-request":
      return "bad-code";
    case "unauthorized":
    case "server-error":
    case "network":
      return "server-unreachable";
  }
}

interface PendingOffer {
  readonly pc: PeerConnectionLike;
  readonly channel: DataChannelLike;
}

interface Negotiation {
  readonly pc: PeerConnectionLike;
  readonly channel: DataChannelLike | null;
}

export function usePartySession(
  self: PartyProfile,
  feedback: GameFeedback,
): PartyApi {
  const [lobby, setLobby] = useState<LobbyState>(INITIAL_LOBBY_STATE);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [session, setSession] = useState<GameSession | null>(null);

  const lobbyRef = useRef<LobbyState>(INITIAL_LOBBY_STATE);
  const credentialsRef = useRef<VersusCredentials | null>(null);
  const clientRef = useRef<VersusSignalingClient | null>(null);
  const hostRef = useRef<WebRTCHostSession | null>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const unmountedRef = useRef(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Host side: one offer per guest seat until its answer arrives. */
  const offersRef = useRef<Map<string, PendingOffer>>(new Map());
  /** Host side: live guest transports, so they can be closed on leave. */
  const guestTransportsRef = useRef<Map<string, WebRTCTransport>>(new Map());
  /** Guest side: the single negotiation in progress. */
  const negotiationRef = useRef<Negotiation | null>(null);
  const guestHandledRef = useRef(false);

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

  const clearPoll = useCallback(() => {
    if (pollTimeoutRef.current !== null) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const clearConnectTimeout = useCallback(() => {
    if (connectTimeoutRef.current !== null) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  }, []);

  const closeOffers = useCallback(() => {
    for (const offer of offersRef.current.values()) {
      try {
        offer.pc.close();
      } catch {
        // Already closed.
      }
    }
    offersRef.current.clear();
  }, []);

  const closeGuestTransports = useCallback(() => {
    for (const transport of guestTransportsRef.current.values()) {
      transport.close();
    }
    guestTransportsRef.current.clear();
  }, []);

  const teardown = useCallback(() => {
    clearPoll();
    clearConnectTimeout();
    closeOffers();
    closeGuestTransports();
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    sessionRef.current?.dispose();
    sessionRef.current = null;
    hostRef.current = null;
    negotiationRef.current?.pc.close();
    negotiationRef.current = null;
    guestHandledRef.current = false;
    const client = clientRef.current;
    clientRef.current = null;
    credentialsRef.current = null;
    if (client) {
      void client.leave();
    }
    setSession(null);
    setSnapshot(null);
  }, [clearConnectTimeout, clearPoll, closeGuestTransports, closeOffers]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      teardown();
    };
  }, [teardown]);

  const attachSession = useCallback((next: GameSession) => {
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
    });
    setSnapshot(next.snapshot);
  }, []);

  const fail = useCallback(
    (failure: LobbyFailure) => {
      clearPoll();
      clearConnectTimeout();
      dispatch({ type: "FAIL", failure });
    },
    [clearConnectTimeout, clearPoll, dispatch],
  );

  // -- host ---------------------------------------------------------------

  /** Creates a direct connection offer for one guest seat. */
  const offerTo = useCallback(
    async (client: VersusSignalingClient, guestId: string): Promise<void> => {
      const factory = defaultPeerConnectionFactory();

      if (!factory) {
        fail("no-webrtc");
        return;
      }

      try {
        const offer = await createHostOffer({
          pcFactory: factory,
          iceServers: selectIceServers({ online: navigator.onLine }),
        });

        if (unmountedRef.current) {
          offer.pc.close();
          return;
        }

        offersRef.current.set(guestId, {
          pc: offer.pc,
          channel: offer.channel,
        });

        const sent = await client.send(
          "offer",
          encodeDescription(offer.description),
          guestId,
        );

        if (!sent.ok) {
          fail(mapClientFailure(sent.failure));
        }
      } catch {
        fail("ice-failed");
      }
    },
    [fail],
  );

  const acceptGuestAnswer = useCallback(
    async (
      client: VersusSignalingClient,
      guestId: string,
      description: PairingDescription,
    ): Promise<void> => {
      const pending = offersRef.current.get(guestId);

      if (!pending) {
        return;
      }

      offersRef.current.delete(guestId);

      try {
        await acceptHostAnswer(pending.pc, description);

        if (unmountedRef.current) {
          pending.pc.close();
          return;
        }

        const transport = createWebRTCTransport({
          pc: pending.pc,
          channel: pending.channel,
        });
        guestTransportsRef.current.set(guestId, transport);
        hostRef.current?.joinPeer({ playerId: guestId, transport });
      } catch {
        // Another guest's connection failing must not end the lobby.
        pending.pc.close();
      }
    },
    [],
  );

  const dropGuest = useCallback((guestId: string) => {
    const pending = offersRef.current.get(guestId);

    if (pending) {
      offersRef.current.delete(guestId);
      pending.pc.close();
    }

    const transport = guestTransportsRef.current.get(guestId);

    if (transport) {
      guestTransportsRef.current.delete(guestId);
      transport.close();
    }

    hostRef.current?.removePeer(guestId);
  }, []);

  const handleHostSignal = useCallback(
    async (
      client: VersusSignalingClient,
      signals: readonly VersusSignal[],
    ): Promise<void> => {
      for (const signal of signals) {
        if (signal.kind === "joined") {
          await offerTo(client, signal.from);
          continue;
        }

        if (signal.kind === "left") {
          dropGuest(signal.from);
          continue;
        }

        if (signal.kind === "answer") {
          const description = decodeDescription(signal.payload);

          if (!description || description.kind !== "answer") {
            continue;
          }

          await acceptGuestAnswer(client, signal.from, description);
        }
      }
    },
    [acceptGuestAnswer, dropGuest, offerTo],
  );

  // -- guest --------------------------------------------------------------

  // The guest session is created with the seat id the server assigned.
  const attachGuestSession = useCallback(
    (transport: WebRTCTransport) => {
      const credentials = credentialsRef.current;

      if (!credentials) {
        transport.close();
        return;
      }

      const guest = new WebRTCGuestSession({
        transport,
        playerId: credentials.id,
        player: {
          ...profileRef.current,
          id: credentials.id as LanPlayerInfo["id"],
        },
      });

      attachSession(guest);
      guest.connect();
    },
    [attachSession],
  );

  const acceptHostOfferSignal = useCallback(
    async (
      client: VersusSignalingClient,
      signal: VersusSignal,
      description: PairingDescription,
    ): Promise<void> => {
      if (guestHandledRef.current) {
        return;
      }
      guestHandledRef.current = true;

      const factory = defaultPeerConnectionFactory();

      if (!factory) {
        fail("no-webrtc");
        return;
      }

      try {
        const answer = await acceptHostOffer(description, {
          pcFactory: factory,
          iceServers: selectIceServers({ online: navigator.onLine }),
        });

        if (unmountedRef.current) {
          answer.pc.close();
          return;
        }

        negotiationRef.current = { pc: answer.pc, channel: null };

        const sent = await client.send(
          "answer",
          encodeDescription(answer.description),
          signal.from,
        );

        if (!sent.ok) {
          fail(mapClientFailure(sent.failure));
          return;
        }

        const channel = await waitForDataChannel(answer.pc);

        if (unmountedRef.current) return;

        negotiationRef.current = { pc: answer.pc, channel };

        const transport = createWebRTCTransport({
          pc: answer.pc,
          channel,
        });

        if (transport.status !== "open") {
          await transport.connect();
        }

        if (unmountedRef.current) {
          transport.close();
          return;
        }

        clearPoll();
        clearConnectTimeout();
        attachGuestSession(transport);
      } catch {
        fail("ice-failed");
      }
    },
    [attachGuestSession, clearConnectTimeout, clearPoll, fail],
  );

  // -- shared polling -----------------------------------------------------

  const poll = useCallback(
    (client: VersusSignalingClient, role: "host" | "guest"): void => {
      const tick = async () => {
        if (unmountedRef.current) return;

        const polled = await client.poll();

        if (unmountedRef.current) return;

        if (!polled.ok) {
          // A guest that cannot reach the server after connecting keeps its
          // match; otherwise the failure is terminal for the setup.
          if (lobbyRef.current.phase !== "connected") {
            fail(mapClientFailure(polled.failure));
          }
          return;
        }

        if (polled.value.closed && lobbyRef.current.phase !== "connected") {
          fail(role === "guest" ? "host-left" : "peer-left");
          return;
        }

        if (role === "host") {
          await handleHostSignal(client, polled.value.signals);
        } else {
          for (const signal of polled.value.signals) {
            if (signal.kind === "offer") {
              const description = decodeDescription(signal.payload);
              if (description && description.kind === "offer") {
                await acceptHostOfferSignal(client, signal, description);
              }
            } else if (signal.kind === "bye") {
              fail("host-left");
              return;
            }
          }
        }

        if (unmountedRef.current) return;

        const phase = lobbyRef.current.phase;

        // Once the match is running the data channels carry everything.
        if (phase === "connected" || phase === "failed") {
          return;
        }

        pollTimeoutRef.current = setTimeout(tick, SIGNAL_POLL_MS);
      };

      void tick();
    },
    [acceptHostOfferSignal, fail, handleHostSignal],
  );

  // -- public API ---------------------------------------------------------

  const createGame = useCallback(
    (mode: GameMode) => {
      feedback.select();
      teardown();
      dispatch({ type: "CREATE", mode });
      clearPoll();

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
        credentialsRef.current = credentials;
        const client = new VersusSignalingClient(credentials);
        clientRef.current = client;

        const host = new WebRTCHostSession({
          host: profileRef.current,
          mode,
        });
        hostRef.current = host;
        attachSession(host);

        dispatch({
          type: "ROOM_CREATED",
          code: credentials.code,
          mode,
          players: [profileRef.current],
        });
        poll(client, "host");
      })();
    },
    [attachSession, clearPoll, dispatch, fail, feedback, poll, teardown],
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

      void (async () => {
        // A room created a moment ago may not be listed yet; retry briefly.
        for (let attempt = 0; attempt < JOIN_RETRY_LIMIT; attempt += 1) {
          const joined = await joinVersusRoom(code);

          if (unmountedRef.current) return;

          if (joined.ok) {
            const credentials = joined.value;
            credentialsRef.current = credentials;
            const client = new VersusSignalingClient(credentials);
            clientRef.current = client;

            dispatch({ type: "ROOM_JOINED", code: credentials.code });

            connectTimeoutRef.current = setTimeout(() => {
              connectTimeoutRef.current = null;
              fail("timeout");
            }, CONNECT_TIMEOUT_MS);

            poll(client, "guest");
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
    [dispatch, fail, feedback, poll],
  );

  const startGame = useCallback(() => {
    feedback.start();
    hostRef.current?.start();
  }, [feedback]);

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
    retry,
    abort,
  };
}
