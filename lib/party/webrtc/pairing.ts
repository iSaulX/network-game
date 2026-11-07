/**
 * Pure pairing state machine. The hook owns WebRTC; this module owns which
 * screen is shown, which codes have been gathered, and every Spanish string.
 */
import type { LanRole } from "../protocol";
import { joinPairingParts } from "./signaling";

export type PairingPhase =
  | "role-choice"
  | "host-creating-offer"
  | "host-showing-offer"
  | "host-entering-answer"
  | "guest-entering-offer"
  | "guest-creating-answer"
  | "guest-showing-answer"
  | "connecting"
  | "connected"
  | "failed"
  | "aborted";

export type PairingFailure =
  | "insecure-context"
  | "no-webrtc"
  | "camera-denied"
  | "camera-missing"
  | "bad-code"
  | "mixed-codes"
  | "incomplete-code"
  | "ice-failed"
  | "timeout"
  | "protocol-mismatch"
  | "host-left"
  | "peer-left";

export interface PairingState {
  readonly phase: PairingPhase;
  readonly role: LanRole | null;
  /** Parts this device shows (offer for the host, answer for the guest). */
  readonly outgoing: readonly string[];
  readonly outgoingIndex: number;
  /** Parts this device has gathered from the other screen. */
  readonly incoming: readonly string[];
  readonly failure: PairingFailure | null;
}

export const INITIAL_PAIRING_STATE: PairingState = Object.freeze({
  phase: "role-choice",
  role: null,
  outgoing: [],
  outgoingIndex: 0,
  incoming: [],
  failure: null,
});

export type PairingEvent =
  | { readonly type: "CHOOSE_ROLE"; readonly role: LanRole }
  | {
      readonly type: "OFFER_READY";
      readonly parts: readonly string[];
    }
  | {
      readonly type: "ANSWER_READY";
      readonly parts: readonly string[];
    }
  | { readonly type: "SHOW_PART"; readonly index: number }
  | { readonly type: "CODE_INPUT"; readonly parts: readonly string[] }
  | { readonly type: "CONNECTING" }
  | { readonly type: "CONNECTED" }
  | { readonly type: "FAIL"; readonly failure: PairingFailure }
  | { readonly type: "RETRY" }
  | { readonly type: "ABORT" };

const FAILURES = new Set<PairingFailure>([
  "insecure-context",
  "no-webrtc",
  "camera-denied",
  "camera-missing",
  "bad-code",
  "mixed-codes",
  "incomplete-code",
  "ice-failed",
  "timeout",
  "protocol-mismatch",
  "host-left",
  "peer-left",
]);

export const PAIRING_FAILURE_COPY: Readonly<Record<PairingFailure, string>> =
  Object.freeze({
    "insecure-context":
      "Este modo necesita una conexión segura (HTTPS) o la PWA instalada.",
    "no-webrtc":
      "Este navegador no permite conexiones directas entre dispositivos.",
    "camera-denied": "No hay acceso a la cámara. Pega el código como texto.",
    "camera-missing": "No hay ninguna cámara disponible. Pega el código como texto.",
    "bad-code": "El código no es válido o está incompleto. Vuelve a escanearlo.",
    "mixed-codes":
      "Este código pertenece a otra partida. Cancela esta conexión antes de usar otro.",
    "incomplete-code": "Faltan partes del código. Escanea o pega las que faltan.",
    "ice-failed":
      "No se pudo conectar. Comprueba que los dos dispositivos están en la misma red Wi‑Fi y vuelve a intentarlo.",
    timeout: "La conexión tardó demasiado. Vuelve a intentarlo.",
    "protocol-mismatch":
      "Los dos dispositivos tienen versiones distintas de la app. Actualiza ambos y vuelve a intentarlo.",
    "host-left": "El anfitrión se ha desconectado. La partida ha terminado.",
    "peer-left": "El invitado se ha desconectado. La partida ha terminado.",
  });

export function isPairingFailure(value: unknown): value is PairingFailure {
  return typeof value === "string" && FAILURES.has(value as PairingFailure);
}

export function reducePairing(
  state: PairingState,
  event: PairingEvent,
): PairingState {
  switch (event.type) {
    case "CHOOSE_ROLE":
      return {
        ...INITIAL_PAIRING_STATE,
        role: event.role,
        phase:
          event.role === "host" ? "host-creating-offer" : "guest-entering-offer",
      };

    case "OFFER_READY":
      return {
        ...state,
        phase: "host-showing-offer",
        outgoing: event.parts,
        outgoingIndex: 0,
        failure: null,
      };

    case "ANSWER_READY":
      return {
        ...state,
        phase: "guest-showing-answer",
        outgoing: event.parts,
        outgoingIndex: 0,
        failure: null,
      };

    case "SHOW_PART": {
      if (state.outgoing.length === 0) {
        return state;
      }
      const index = Math.min(
        Math.max(0, event.index),
        state.outgoing.length - 1,
      );
      return {
        ...state,
        outgoingIndex: index,
        phase:
          state.role === "host" ? "host-entering-answer" : state.phase,
      };
    }

    case "CODE_INPUT": {
      if (event.parts.length === 0) {
        return state;
      }

      const incoming = [...state.incoming];

      for (const part of event.parts) {
        if (!incoming.includes(part)) {
          incoming.push(part);
        }
      }

      const joined = joinPairingParts(incoming);

      if (joined.status === "conflict") {
        return {
          ...state,
          phase: "failed",
          failure:
            joined.reason === "mixed-ids" ? "mixed-codes" : "bad-code",
        };
      }

      return {
        ...state,
        incoming,
        phase:
          state.role === "host" ? "host-entering-answer" : "guest-entering-offer",
        failure: null,
      };
    }

    case "CONNECTING":
      return { ...state, phase: "connecting", failure: null };

    case "CONNECTED":
      return { ...state, phase: "connected", failure: null };

    case "FAIL":
      return { ...state, phase: "failed", failure: event.failure };

    case "RETRY":
      return {
        ...INITIAL_PAIRING_STATE,
        role: state.role,
        phase:
          state.role === "host"
            ? "host-creating-offer"
            : "guest-entering-offer",
      };

    case "ABORT":
      return { ...INITIAL_PAIRING_STATE, phase: "aborted", role: state.role };
  }
}

export interface PairingDescriptionText {
  readonly title: string;
  readonly detail: string;
  readonly tone: "info" | "success" | "error";
}

export function describePairing(state: PairingState): PairingDescriptionText {
  if (state.failure) {
    return {
      title: "No se pudo conectar",
      detail: PAIRING_FAILURE_COPY[state.failure],
      tone: "error",
    };
  }

  switch (state.phase) {
    case "role-choice":
      return {
        title: "Jugar 1 contra 1 en la misma red",
        detail:
          "Los dos dispositivos se conectan directamente. No hace falta internet.",
        tone: "info",
      };
    case "host-creating-offer":
    case "guest-creating-answer":
      return { title: "Preparando la conexión…", detail: "", tone: "info" };
    case "host-showing-offer":
      return {
        title: "Enseña este código al otro dispositivo",
        detail: "También puedes copiarlo y compartirlo.",
        tone: "info",
      };
    case "host-entering-answer":
      return {
        title: "Escanea o pega la respuesta del invitado",
        detail: "Cuando tengas todas las partes, pulsa Conectar.",
        tone: "info",
      };
    case "guest-entering-offer":
      return {
        title: "Escanea o pega el código del anfitrión",
        detail: "Cuando tengas todas las partes, pulsa Conectar.",
        tone: "info",
      };
    case "guest-showing-answer":
      return {
        title: "Muestra este código al anfitrión",
        detail: "También puedes copiarlo y compartirlo.",
        tone: "info",
      };
    case "connecting":
      return {
        title: "Conectando con el otro dispositivo…",
        detail: "Mantén las dos pantallas así unos segundos.",
        tone: "info",
      };
    case "connected":
      return { title: "¡Conectados!", detail: "", tone: "success" };
    case "failed":
      return {
        title: "No se pudo conectar",
        detail: PAIRING_FAILURE_COPY["ice-failed"],
        tone: "error",
      };
    case "aborted":
      return {
        title: "Conexión cancelada",
        detail: "Puedes volver a intentarlo.",
        tone: "error",
      };
  }
}
