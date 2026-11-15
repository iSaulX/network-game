/**
 * Pure lobby state machine for the online modes.
 *
 * Signaling is automatic: the hook owns HTTP and WebRTC, this module owns
 * which screen is shown and every Spanish string, so both can be tested
 * without a browser.
 *
 * Flow: choosing (Crear/Unirse) → creating/joining → lobby (live roster) →
 * connected (the host started the match) or failed.
 */
import type { GameMode, LanPlayerInfo } from "../protocol";

export type LobbyPhase =
  | "choosing"
  | "creating"
  | "host-lobby"
  | "guest-form"
  | "joining"
  | "guest-lobby"
  | "connected"
  | "failed";

export type LobbyFailure =
  | "offline"
  | "insecure-context"
  | "no-webrtc"
  | "server-unreachable"
  | "room-not-found"
  | "room-full"
  | "room-closed"
  | "bad-code"
  | "ice-failed"
  | "timeout"
  | "host-left"
  | "peer-left";

export interface LobbyState {
  readonly phase: LobbyPhase;
  readonly role: "host" | "guest" | null;
  readonly mode: GameMode;
  readonly code: string | null;
  readonly failure: LobbyFailure | null;
  /** Connected humans, host first. Empty seats are not listed. */
  readonly players: readonly LanPlayerInfo[];
  /** Seats the host chose to leave without a bot. */
  readonly emptySeats: readonly string[];
  /** The room's seat count. */
  readonly capacity: 2 | 4;
}

export const INITIAL_LOBBY_STATE: LobbyState = Object.freeze({
  phase: "choosing",
  role: null,
  mode: "1v1",
  code: null,
  failure: null,
  players: [],
  emptySeats: [],
  capacity: 2,
});

export type LobbyEvent =
  | { readonly type: "CREATE"; readonly mode: GameMode }
  | { readonly type: "OPEN_GUEST_FORM"; readonly mode: GameMode }
  | {
      readonly type: "ROOM_CREATED";
      readonly code: string;
      readonly mode: GameMode;
      readonly players: readonly LanPlayerInfo[];
    }
  | { readonly type: "ROOM_JOINED"; readonly code: string }
  | { readonly type: "JOINING" }
  | {
      readonly type: "LOBBY";
      readonly players: readonly LanPlayerInfo[];
      readonly mode: GameMode;
      readonly capacity: 2 | 4;
      readonly emptySeats?: readonly string[];
    }
  | { readonly type: "CONNECTED" }
  | { readonly type: "FAIL"; readonly failure: LobbyFailure }
  | { readonly type: "RESET" };

const FAILURES: ReadonlySet<string> = new Set<LobbyFailure>([
  "offline",
  "insecure-context",
  "no-webrtc",
  "server-unreachable",
  "room-not-found",
  "room-full",
  "room-closed",
  "bad-code",
  "ice-failed",
  "timeout",
  "host-left",
  "peer-left",
]);

export const LOBBY_FAILURE_COPY: Readonly<Record<LobbyFailure, string>> =
  Object.freeze({
    offline:
      "No hay conexión. Para jugar en línea hace falta internet.",
    "insecure-context":
      "Este modo necesita una conexión segura (HTTPS) o la app instalada.",
    "no-webrtc":
      "Este navegador no permite conexiones directas entre dispositivos. Prueba con Chrome, Edge, Safari o Firefox actualizados.",
    "server-unreachable":
      "No se pudo contactar con el servidor de partidas. Vuelve a intentarlo.",
    "room-not-found":
      "No existe ninguna partida con ese código. Revísalo con el anfitrión.",
    "room-full": "Esa partida ya está completa.",
    "room-closed":
      "La partida se ha cerrado. Pídele un código nuevo al anfitrión.",
    "bad-code": "El código debe tener 6 caracteres.",
    "ice-failed":
      "No se pudo conectar con el anfitrión. Algunas redes (conexiones móviles, redes de oficina o cortafuegos) bloquean las conexiones directas.",
    timeout: "La conexión tardó demasiado. Vuelve a intentarlo.",
    "host-left": "El anfitrión se ha desconectado. La partida ha terminado.",
    "peer-left": "Un jugador se ha desconectado.",
  });

export function isLobbyFailure(value: unknown): value is LobbyFailure {
  return typeof value === "string" && FAILURES.has(value);
}

export function reduceLobby(state: LobbyState, event: LobbyEvent): LobbyState {
  switch (event.type) {
    case "CREATE":
      return {
        ...INITIAL_LOBBY_STATE,
        role: "host",
        mode: event.mode,
        phase: "creating",
        capacity: event.mode === "1v1" ? 2 : 4,
      };

    case "OPEN_GUEST_FORM":
      return {
        ...INITIAL_LOBBY_STATE,
        role: "guest",
        mode: event.mode,
        phase: "guest-form",
        capacity: event.mode === "1v1" ? 2 : 4,
      };

    case "ROOM_CREATED":
      return {
        phase: "host-lobby",
        role: "host",
        mode: event.mode,
        code: event.code,
        failure: null,
        players: event.players,
        emptySeats: [],
        capacity: event.mode === "1v1" ? 2 : 4,
      };

    case "JOINING":
      return { ...state, phase: "joining", failure: null };

    case "ROOM_JOINED":
      return {
        phase: "guest-lobby",
        role: "guest",
        mode: state.mode,
        code: event.code,
        failure: null,
        players: [],
        emptySeats: [],
        capacity: state.capacity,
      };

    case "LOBBY": {
      const emptySeats = event.emptySeats ?? state.emptySeats;

      if (
        state.players.length === event.players.length &&
        state.players.every(
          (player, index) =>
            player.id === event.players[index]?.id &&
            player.name === event.players[index]?.name &&
            player.avatar === event.players[index]?.avatar,
        ) &&
        state.mode === event.mode &&
        state.capacity === event.capacity &&
        state.emptySeats.length === emptySeats.length &&
        state.emptySeats.every((seat) => emptySeats.includes(seat))
      ) {
        return state;
      }

      return {
        ...state,
        players: event.players,
        mode: event.mode,
        capacity: event.capacity,
        emptySeats,
      };
    }

    case "CONNECTED":
      return { ...state, phase: "connected", failure: null };

    case "FAIL":
      return { ...state, phase: "failed", failure: event.failure };

    case "RESET":
      return { ...INITIAL_LOBBY_STATE };
  }
}

export interface LobbyDescription {
  readonly title: string;
  readonly detail: string;
  readonly tone: "info" | "success" | "error";
}

export function describeLobby(state: LobbyState): LobbyDescription {
  if (state.failure) {
    return {
      title: "No se pudo conectar",
      detail: LOBBY_FAILURE_COPY[state.failure],
      tone: "error",
    };
  }

  const guests = Math.max(0, state.players.length - 1);
  const seats = state.capacity - 1;

  switch (state.phase) {
    case "choosing":
      return {
        title: "Jugar en línea",
        detail: "Crea una partida y comparte el código, o únete con uno.",
        tone: "info",
      };
    case "creating":
      return { title: "Creando la partida…", detail: "", tone: "info" };
    case "host-lobby": {
      const empty = state.emptySeats.length;
      const seatCopy =
        empty > 0
          ? ` ${empty} ${empty === 1 ? "asiento quedará" : "asientos quedarán"} vacío${empty === 1 ? "" : "s"}.`
          : "";

      return {
        title: "Sala de espera",
        detail:
          (guests === 0
            ? "Comparte el código y empieza cuando quieras: los huecos libres los ocuparán bots."
            : guests < seats
              ? `${guests} de ${seats} invitados dentro. Puedes empezar cuando quieras.`
              : "Todos dentro. ¡Cuando quieras!") + seatCopy,
        tone: "info",
      };
    }
    case "guest-form":
      return {
        title: "Unirse a una partida",
        detail: "Escribe el código que te ha pasado el anfitrión.",
        tone: "info",
      };
    case "joining":
      return {
        title: "Conectando con la partida…",
        detail: "Estamos buscando al anfitrión y abriendo la conexión.",
        tone: "info",
      };
    case "guest-lobby":
      return {
        title: state.players.length > 0 ? "Estás dentro" : "Conectando…",
        detail:
          state.players.length > 0
            ? "Esperando a que el anfitrión empiece la partida."
            : "Estamos recibiendo la lista de jugadores de la partida.",
        tone: "info",
      };
    case "connected":
      return { title: "¡Empieza la partida!", detail: "", tone: "success" };
    case "failed":
      return {
        title: "No se pudo conectar",
        detail: LOBBY_FAILURE_COPY["ice-failed"],
        tone: "error",
      };
  }
}

/** Seat label used by the lobby list ("Anfitrión", "Invitado 1"…). */
export function seatLabel(id: string): string {
  if (id === "host") return "Anfitrión";
  const match = /^guest-([1-3])$/.exec(id);
  return match ? `Invitado ${match[1]}` : "Jugador";
}
