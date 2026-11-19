/**
 * Client session for a server-authoritative party.
 *
 * The message adoption is exactly the guest session's: the server speaks
 * `LOBBY`/`START`/`STATE` over the same wire protocol, so this class only adds
 * the host controls the server validates. Both the host and the guests use it.
 */
import { PARTY_PROTOCOL_VERSION } from "../protocol";
import {
  WebRTCGuestSession,
  type GuestSessionOptions,
} from "./webrtc-guest-session";
import type { PartyControlMessage } from "../websocket/messages";

export interface ServerGameSessionOptions extends GuestSessionOptions {
  /** Sends one control envelope over the party socket. */
  readonly control: (message: PartyControlMessage) => void;
}

export class ServerGameSession extends WebRTCGuestSession {
  private readonly sendControlMessage: (
    message: PartyControlMessage,
  ) => void;

  constructor(options: ServerGameSessionOptions) {
    super(options);
    this.sendControlMessage = options.control;
  }

  /** Host only; the server rejects it for a guest. */
  override start(): void {
    this.sendControlMessage({
      type: "START",
      protocol: PARTY_PROTOCOL_VERSION,
    });
  }

  /** Host only; the server rejects it once the match started. */
  override setSeatEmpty(seatId?: string, empty?: boolean): void {
    if (seatId === undefined || empty === undefined) {
      return;
    }

    this.sendControlMessage({
      type: "SET_SEAT_EMPTY",
      protocol: PARTY_PROTOCOL_VERSION,
      seatId,
      empty,
    });
  }

  /** Tells the server this is an intentional exit, not a network drop. */
  leave(): void {
    this.sendControlMessage({
      type: "LEAVE",
      protocol: PARTY_PROTOCOL_VERSION,
    });
  }
}
