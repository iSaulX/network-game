/**
 * Spanish copy for how a seat is connected. UI-safe and framework-free, so
 * both the lobby and the in-game panels use exactly the same wording.
 */
import type { SeatConnection } from "./protocol";

/**
 * `host` means both peers share a local network; `srflx`/`prflx` means NAT was
 * traversed with STUN; `relay` means the media went through TURN because a
 * direct path was impossible.
 */
export function describeSeatConnection(
  connection: SeatConnection | null | undefined,
): string | null {
  if (!connection) {
    return null;
  }

  if (connection.transport === "websocket") {
    return "Conexión por servidor · WebSocket";
  }

  switch (connection.candidate) {
    case "host":
      return "Conexión directa · host";
    case "srflx":
    case "prflx":
      return "Conexión directa · STUN";
    case "relay":
      return "Conexión por TURN · relay";
    default:
      return "Conexión directa";
  }
}
