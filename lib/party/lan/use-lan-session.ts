"use client";

/**
 * LAN match orchestration: owns the `RTCPeerConnection`, the pairing reducer and
 * the game session, and exposes exactly what `app/lan/page.tsx` renders.
 *
 * Signaling is manual, so every step is driven by a user gesture. No timers run
 * except the single connect timeout.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameFeedback } from "@/components/game/game-feedback";
import {
  DEFAULT_GUEST_INFO,
  DEFAULT_HOST_INFO,
  createLanRoster,
} from "@/components/lan/roster";
import {
  acceptHostAnswer,
  acceptHostOffer,
  createHostOffer,
  decodePairing,
  encodePairing,
  joinPairingParts,
  selectIceServers,
  splitPairing,
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
import {
  INITIAL_PAIRING_STATE,
  reducePairing,
  type PairingEvent,
  type PairingFailure,
  type PairingState,
} from "@/lib/party/webrtc/pairing";
import type { LanPlayerInfo, LanRole, LanRoster } from "@/lib/party/protocol";
import type { GameSession, SessionSnapshot } from "@/lib/party/session";
import { WebRTCHostSession } from "@/lib/party/sessions/webrtc-host-session";
import { WebRTCGuestSession } from "@/lib/party/sessions/webrtc-guest-session";

/** How long a peer may take to open the data channel before we give up. */
export const CONNECT_TIMEOUT_MS = 20_000;

export interface LanProfileDraft {
  readonly name: string;
  readonly avatar: string;
}

export interface LanSessionApi {
  readonly pairing: PairingState;
  readonly roster: LanRoster | null;
  readonly snapshot: SessionSnapshot | null;
  readonly session: GameSession | null;
  /** Currently shown outgoing part, or null before one exists. */
  readonly outgoingText: string | null;
  chooseRole(role: LanRole): void;
  showNextPart(): void;
  showPreviousPart(): void;
  /** Accepts one pasted part, or a whole unsplit code. */
  addIncomingParts(text: string): void;
  connect(): void;
  retry(): void;
  abort(): void;
  setProfile(role: LanRole, draft: LanProfileDraft): void;
}

interface Negotiation {
  pc: PeerConnectionLike;
  channel: DataChannelLike | null;
  description: PairingDescription;
}

export function useLanSession(feedback: GameFeedback): LanSessionApi {
  const [pairing, setPairing] = useState<PairingState>(INITIAL_PAIRING_STATE);
  const [hostDraft, setHostDraft] = useState<LanProfileDraft>({
    name: DEFAULT_HOST_INFO.name,
    avatar: DEFAULT_HOST_INFO.avatar,
  });
  const [guestDraft, setGuestDraft] = useState<LanProfileDraft>({
    name: DEFAULT_GUEST_INFO.name,
    avatar: DEFAULT_GUEST_INFO.avatar,
  });
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [session, setSession] = useState<GameSession | null>(null);

  const negotiationRef = useRef<Negotiation | null>(null);
  const transportRef = useRef<WebRTCTransport | null>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposedRef = useRef(false);

  const dispatch = useCallback(
    (event: PairingEvent) => {
      setPairing((current) => reducePairing(current, event));
    },
    [],
  );

  const teardown = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    sessionRef.current?.dispose();
    sessionRef.current = null;
    transportRef.current?.close();
    transportRef.current = null;
    negotiationRef.current?.pc.close();
    negotiationRef.current = null;
    setSession(null);
    setSnapshot(null);
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      teardown();
    };
  }, [teardown]);

  const roster = useMemo<LanRoster | null>(() => {
    if (pairing.role === null) {
      return null;
    }
    return createLanRoster(
      { ...DEFAULT_HOST_INFO, ...hostDraft },
      { ...DEFAULT_GUEST_INFO, ...guestDraft },
    );
  }, [guestDraft, hostDraft, pairing.role]);

  const fail = useCallback(
    (failure: PairingFailure) => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      dispatch({ type: "FAIL", failure });
      if (disposedRef.current) return;
      negotiationRef.current?.pc.close();
      negotiationRef.current = null;
    },
    [dispatch],
  );

  const attachSession = useCallback((next: GameSession) => {
    sessionRef.current = next;
    setSession(next);
    unsubscribeRef.current = next.subscribe((nextSnapshot) => {
      if (!disposedRef.current) {
        setSnapshot(nextSnapshot);
      }
    });
    setSnapshot(next.snapshot);
  }, []);

  const beginTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      fail("timeout");
    }, CONNECT_TIMEOUT_MS);
  }, [fail]);

  const clearTimeoutIfSet = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const chooseRole = useCallback(
    (role: LanRole) => {
      feedback.select();
      teardown();
      dispatch({ type: "CHOOSE_ROLE", role });

      if (role !== "host") {
        return;
      }

      const factory = defaultPeerConnectionFactory();
      if (!factory) {
        fail("no-webrtc");
        return;
      }

      void (async () => {
        try {
          const offer = await createHostOffer({
            pcFactory: factory,
            iceServers: selectIceServers({ online: navigator.onLine }),
          });
          if (disposedRef.current) {
            offer.pc.close();
            return;
          }
          negotiationRef.current = {
            pc: offer.pc,
            channel: offer.channel,
            description: offer.description,
          };
          dispatch({
            type: "OFFER_READY",
            parts: splitPairing(encodePairing(offer.description)).map(
              (part) => part.text,
            ),
          });
        } catch {
          fail("ice-failed");
        }
      })();
    },
    [dispatch, fail, feedback, teardown],
  );

  const setProfile = useCallback((role: LanRole, draft: LanProfileDraft) => {
    if (role === "host") {
      setHostDraft(draft);
    } else {
      setGuestDraft(draft);
    }
  }, []);

  const showNextPart = useCallback(() => {
    setPairing((current) =>
      reducePairing(current, {
        type: "SHOW_PART",
        index: current.outgoingIndex + 1,
      }),
    );
  }, []);

  const showPreviousPart = useCallback(() => {
    setPairing((current) =>
      reducePairing(current, {
        type: "SHOW_PART",
        index: current.outgoingIndex - 1,
      }),
    );
  }, []);

  const addIncomingParts = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;

      // A whole (unsplit) code is accepted as-is; parts are reassembled.
      const parts = clean.startsWith("PARCHIS-LAN-1:")
        ? splitPairing(clean).map((part) => part.text)
        : clean.split(/\s+/).filter(Boolean);

      dispatch({ type: "CODE_INPUT", parts });
    },
    [dispatch],
  );

  /** Turns a completed code into a live session on the given peer connection. */
  const startSession = useCallback(
    (
      transport: WebRTCTransport,
      role: LanRole,
      nextRoster: LanRoster,
      guestInfo: LanPlayerInfo,
    ) => {
      transportRef.current = transport;
      const next: GameSession =
        role === "host"
          ? new WebRTCHostSession({ transport, roster: nextRoster })
          : new WebRTCGuestSession({ transport, player: guestInfo });

      attachSession(next);

      if (next instanceof WebRTCHostSession) {
        next.start();
      } else if (next instanceof WebRTCGuestSession) {
        next.connect();
      }

      dispatch({ type: "CONNECTED" });
      clearTimeoutIfSet();
    },
    [attachSession, clearTimeoutIfSet, dispatch],
  );

  const connect = useCallback(() => {
    if (!roster || pairing.role === null) return;

    const negotiation = negotiationRef.current;
    const joined = joinPairingParts(pairing.incoming);

    if (joined.status === "conflict") {
      fail("mixed-codes");
      return;
    }

    if (joined.status !== "complete") {
      fail("incomplete-code");
      return;
    }

    const decoded = decodePairing(joined.text);
    if (!decoded.ok) {
      fail("bad-code");
      return;
    }

    dispatch({ type: "CONNECTING" });
    beginTimeout();

    const factory = defaultPeerConnectionFactory();

    if (pairing.role === "host") {
      if (!negotiation) {
        fail("ice-failed");
        return;
      }
      void (async () => {
        try {
          await acceptHostAnswer(negotiation.pc, decoded.description);
          if (disposedRef.current || !negotiation.channel) return;
          const transport = createWebRTCTransport({
            pc: negotiation.pc,
            channel: negotiation.channel,
          });
          await transport.connect();
          if (disposedRef.current) return;
          startSession(transport, "host", roster, roster.host);
        } catch {
          fail("ice-failed");
        }
      })();
      return;
    }

    // Guest: the offer was pasted, so negotiate the answer now.
    void (async () => {
      try {
        if (!factory) {
          fail("no-webrtc");
          return;
        }

        const answer = await acceptHostOffer(decoded.description, {
          pcFactory: factory,
          iceServers: selectIceServers({ online: navigator.onLine }),
        });

        if (disposedRef.current) {
          answer.pc.close();
          return;
        }

        negotiationRef.current = {
          pc: answer.pc,
          channel: null,
          description: answer.description,
        };

        setPairing((current) =>
          reducePairing(current, {
            type: "ANSWER_READY",
            parts: splitPairing(encodePairing(answer.description)).map(
              (part) => part.text,
            ),
          }),
        );

        const channel = await waitForDataChannel(answer.pc);
        if (disposedRef.current) return;

        negotiationRef.current.channel = channel;
        const transport = createWebRTCTransport({ pc: answer.pc, channel });
        await transport.connect();
        if (disposedRef.current) return;

        startSession(transport, "guest", roster, roster.guest);
      } catch {
        fail("ice-failed");
      }
    })();
  }, [
    beginTimeout,
    dispatch,
    fail,
    pairing.incoming,
    pairing.role,
    roster,
    startSession,
  ]);

  const retry = useCallback(() => {
    feedback.tap();
    teardown();
    dispatch({ type: "RETRY" });
  }, [dispatch, feedback, teardown]);

  const abort = useCallback(() => {
    feedback.tap();
    teardown();
    dispatch({ type: "ABORT" });
  }, [dispatch, feedback, teardown]);

  const outgoingText =
    pairing.outgoing.length > 0
      ? (pairing.outgoing[pairing.outgoingIndex] ?? null)
      : null;

  return {
    pairing,
    roster,
    snapshot,
    session,
    outgoingText,
    chooseRole,
    showNextPart,
    showPreviousPart,
    addIncomingParts,
    connect,
    retry,
    abort,
    setProfile,
  };
}

