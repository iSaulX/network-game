/**
 * Server-authoritative party socket for the web build.
 *
 * Vercel exposes the HTTP upgrade to a function through
 * `upgradeWebSocket()`. The function is pinned to one instance and has a
 * maximum duration, so the protocol reconnects and the room state lives in
 * Redis (`lib/server/versus/ws-party.ts`).
 *
 * Local development cannot upgrade sockets inside `next dev`; run
 * `bun run dev:ws` and the browser connects to port 3001 automatically.
 * The static desktop export omits this route with the other `.ts` handlers.
 */
import { connection } from "next/server";
import { upgradeWebSocket } from "@vercel/functions";
import { attachPartySocket } from "@/lib/server/versus/ws-party";

export async function GET() {
  // Credentials and the socket upgrade are per-request runtime work; never
  // prerender this handler during the build.
  await connection();

  return upgradeWebSocket((ws) => {
    attachPartySocket(ws);
  });
}
