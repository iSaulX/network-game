/**
 * Mints short-lived ICE servers for the browser.
 *
 * The Cloudflare TURN API token stays in this process: the client only ever
 * receives `{ iceServers }` with a username/credential that expires. When TURN
 * is not configured (local without env, static desktop export, Cloudflare
 * outage) the response is a STUN-only list, which keeps online play working
 * without relay.
 *
 * This module is server-only and irrelevant to the static desktop export,
 * which omits route handlers.
 */
import { connection } from "next/server";
import {
  DEFAULT_TURN_TTL_SECONDS,
  generateIceServers,
  type IceServersResult,
} from "@/lib/server/versus/turn";

/** Reuse one minted credential for most of its lifetime. */
const CACHE_MS = 30 * 60_000;

let cached: { readonly value: IceServersResult; readonly expiresAt: number } | null =
  null;

function response(result: IceServersResult): Response {
  return Response.json(
    { iceServers: result.iceServers },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() {
  // Opt out of prerendering: credentials must be minted per request context,
  // never baked into the build.
  await connection();

  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return response(cached.value);
  }

  const result = await generateIceServers({
    ttlSeconds: DEFAULT_TURN_TTL_SECONDS,
  });

  // Only cache real credentials; a STUN fallback should retry next time.
  if (result.source === "turn") {
    cached = { value: result, expiresAt: now + CACHE_MS };
  }

  return response(result);
}
