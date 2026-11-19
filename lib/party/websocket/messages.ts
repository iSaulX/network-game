/**
 * Envelope for the server WebSocket.
 *
 * Gameplay messages keep the existing `WireMessage` shapes, so the client
 * session is the same one used by the in-memory and WebRTC transports. The
 * envelope adds connection control (`AUTH`, `START`, `SET_SEAT_EMPTY`,
 * `PING`, `LEAVE`) and the server's authentication replies.
 */
import {
  PARTY_PROTOCOL_VERSION,
  isGuestId,
  isLanPlayerInfo,
  type LanPlayerInfo,
} from "../protocol";

export const SOCKET_PROTOCOL_VERSION = PARTY_PROTOCOL_VERSION;

export const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,8}$/;
export const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export const PEER_ID_PATTERN = /^(?:host|guest-[1-3])$/;

export type AuthFailureCode =
  | "bad-request"
  | "room-not-found"
  | "room-closed"
  | "unauthorized"
  | "room-full"
  | "server-error";

export type PartyControlMessage =
  | {
      readonly type: "AUTH";
      readonly protocol: number;
      readonly code: string;
      readonly id: string;
      readonly token: string;
      readonly player: LanPlayerInfo;
    }
  | { readonly type: "START"; readonly protocol: number }
  | {
      readonly type: "SET_SEAT_EMPTY";
      readonly protocol: number;
      readonly seatId: string;
      readonly empty: boolean;
    }
  | { readonly type: "PING"; readonly protocol: number }
  | { readonly type: "LEAVE"; readonly protocol: number };

export interface AuthOkMessage {
  readonly type: "AUTH_OK";
  readonly protocol: number;
}

export interface AuthErrorMessage {
  readonly type: "AUTH_ERROR";
  readonly protocol: number;
  readonly code: AuthFailureCode;
}

export type ServerControlMessage = AuthOkMessage | AuthErrorMessage;

export type DecodedControl =
  | { readonly ok: true; readonly message: PartyControlMessage }
  | { readonly ok: false; readonly reason: "bad-request" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPeerId(value: unknown): value is string {
  return typeof value === "string" && PEER_ID_PATTERN.test(value);
}

/** Parses one control envelope; game messages are decoded by the caller. */
export function decodePartyControl(value: unknown): DecodedControl {
  if (!isRecord(value) || typeof value.type !== "string") {
    return { ok: false, reason: "bad-request" };
  }

  if (value.protocol !== SOCKET_PROTOCOL_VERSION) {
    return { ok: false, reason: "bad-request" };
  }

  switch (value.type) {
    case "AUTH": {
      const { code, id, token, player } = value;

      if (
        typeof code !== "string" ||
        !ROOM_CODE_PATTERN.test(code) ||
        !isPeerId(id) ||
        typeof token !== "string" ||
        !TOKEN_PATTERN.test(token) ||
        !isLanPlayerInfo(player) ||
        player.id !== id
      ) {
        return { ok: false, reason: "bad-request" };
      }

      return {
        ok: true,
        message: { type: "AUTH", protocol: SOCKET_PROTOCOL_VERSION, code, id, token, player },
      };
    }

    case "START":
    case "PING":
    case "LEAVE":
      return {
        ok: true,
        message: { type: value.type, protocol: SOCKET_PROTOCOL_VERSION },
      };

    case "SET_SEAT_EMPTY": {
      const { seatId, empty } = value;

      if (
        typeof seatId !== "string" ||
        !isGuestId(seatId) ||
        typeof empty !== "boolean"
      ) {
        return { ok: false, reason: "bad-request" };
      }

      return {
        ok: true,
        message: {
          type: "SET_SEAT_EMPTY",
          protocol: SOCKET_PROTOCOL_VERSION,
          seatId,
          empty,
        },
      };
    }

    default:
      return { ok: false, reason: "bad-request" };
  }
}

export function authOk(): AuthOkMessage {
  return { type: "AUTH_OK", protocol: SOCKET_PROTOCOL_VERSION };
}

export function authError(code: AuthFailureCode): AuthErrorMessage {
  return { type: "AUTH_ERROR", protocol: SOCKET_PROTOCOL_VERSION, code };
}
