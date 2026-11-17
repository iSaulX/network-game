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
  waitForDataChannel,
  type PairingDescription,
} from "@/lib/party/webrtc/signaling";
import { fetchIceServers } from "@/lib/party/webrtc/ice";
import { waitForSelectedCandidatePair } from "@/lib/party/webrtc/connection";
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

interface PendingOffer {
  readonly pc: PeerConnectionLike;
  readonly channel: DataChannelLike;
  /** Pairing id of the offer; answers for an older offer are ignored. */
  readonly offerId: string;
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
  /** Guest side: the negotiation in progress. */
  const negotiationRef = useRef<Negotiation | null>(null);
  /** Id of the newest offer seen; a later offer supersedes an older one. */
  const guestOfferIdRef = useRef<string | null>(null);
  const guestConnectedRef = useRef(false);

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
    guestOfferIdRef.current = null;
    guestConnectedRef.current = false;
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
          iceServers: await fetchIceServers({ online: navigator.onLine }),
        });

        if (unmountedRef.current) {
          offer.pc.close();
          return;
        }

        offersRef.current.set(guestId, {
          pc: offer.pc,
          channel: offer.channel,
          offerId: offer.description.id,
        });

        const sent = await client.send(
          "offer",
          encodeDescription(offer.description),
          guestId,
        );

        if (!sent.ok) {
          if (sent.failure === "peer-gone") {
            // The seat left between the poll and the offer. Drop it; the
            // lobby must survive a guest that joined and left immediately.
            offersRef.current.delete(guestId);
            offer.pc.close();
            return;
          }

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

      // An answer for a superseded offer must not be applied to the current
      // one; the seat may have changed hands while the offer was in flight.
      if (!pending || description.id !== pending.offerId) {
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

        // Once ICE nominates a pair, publish the actual path (host, STUN or
        // TURN relay) so every screen can show it under the player.
        void waitForSelectedCandidatePair(pending.pc).then((pair) => {
          if (!pair || unmountedRef.current) {
            return;
          }

          hostRef.current?.setSeatConnection(guestId, {
            transport: "webrtc",
            candidate: pair.remote,
          });
          hostRef.current?.setSeatConnection("host", {
            transport: "webrtc",
            candidate: pair.local,
          });
        });
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
      presentGuests: readonly string[],
    ): Promise<void> => {
      // Presence is the final truth for this poll: a seat that joined and
      // left inside the same window must not receive an offer.
      const present = new Set(presentGuests);

      for (const signal of signals) {
        if (signal.kind === "joined") {
          if (present.has(signal.from)) {
            // A seat may be reused, and an offer created for a previous
            // occupant may have been purged. Always renegotiate; the guest
            // lets the newest offer win.
            dropGuest(signal.from);
            await offerTo(client, signal.from);
          }
          continue;
        }

        if (signal.kind === "left") {
          dropGuest(signal.from);
          continue;
        }

        if (signal.kind === "answer" && present.has(signal.from)) {
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
      if (guestConnectedRef.current) {
        return;
      }

      const offerId = description.id;

      // The same offer can be delivered twice after a poll retry.
      if (guestOfferIdRef.current === offerId) {
        return;
      }

      // A newer offer supersedes any negotiation still waiting for its
      // channel. The host re-offers when a seat changes hands, so the latest
      // offer is always the one that must win.
      guestOfferIdRef.current = offerId;
      negotiationRef.current?.pc.close();
      negotiationRef.current = null;

      const superseded = () => guestOfferIdRef.current !== offerId;

      const factory = defaultPeerConnectionFactory();

      if (!factory) {
        fail("no-webrtc");
        return;
      }

      try {
        const answer = await acceptHostOffer(description, {
          pcFactory: factory,
          iceServers: await fetchIceServers({ online: navigator.onLine }),
        });

        if (unmountedRef.current || superseded()) {
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

        if (unmountedRef.current || superseded()) {
          answer.pc.close();
          return;
        }

        negotiationRef.current = { pc: answer.pc, channel };

        const transport = createWebRTCTransport({
          pc: answer.pc,
          channel,
        });

        if (transport.status !== "open") {
          await transport.connect();
        }

        if (unmountedRef.current || superseded()) {
          transport.close();
          return;
        }

        guestConnectedRef.current = true;
        clearPoll();
        clearConnectTimeout();
        attachGuestSession(transport);

        const credentials = credentialsRef.current;

        void waitForSelectedCandidatePair(answer.pc).then((pair) => {
          if (!pair || unmountedRef.current || !credentials) {
            return;
          }

          const current = sessionRef.current;
          current?.setSeatConnection(credentials.id, {
            transport: "webrtc",
            candidate: pair.local,
          });
          current?.setSeatConnection("host", {
            transport: "webrtc",
            candidate: pair.remote,
          });
        });
      } catch {
        // A superseded negotiation is expected to fail; only the offer that
        // is still current may surface an error.
        if (!superseded()) {
          fail("ice-failed");
        }
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
          await handleHostSignal(
            client,
            polled.value.signals,
            polled.value.present.guests,
          );
        } else {
          for (const signal of polled.value.signals) {
            if (signal.kind === "offer") {
              const description = decodeDescription(signal.payload);
              if (description && description.kind === "offer") {
                // Do not block the poll while waiting for the data channel:
                // a newer offer must be able to supersede this one.
                void acceptHostOfferSignal(client, signal, description);
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

      // Warm the credential request while the room is being created, so the
      // first offer does not wait for it.
      void fetchIceServers({ online: navigator.onLine });

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

      void fetchIceServers({ online: navigator.onLine });

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
    // Tell the signaling server the roster is frozen. A guest who tries to
    // join later fails immediately instead of waiting for the 20 s timeout.
    void clientRef.current?.markStarted();
    hostRef.current?.start();
  }, [feedback]);

  const setSeatEmpty = useCallback(
    (seatId: string, empty: boolean) => {
      feedback.select();
      hostRef.current?.setSeatEmpty(seatId, empty);
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
