/**
 * Local WebSocket server for online party development.
 *
 * `next dev` cannot perform an HTTP upgrade in a route handler, and the
 * production route uses Vercel's `upgradeWebSocket()`. Run this alongside
 * `next dev` (or `next start`) so the browser can connect to
 * `ws://localhost:3001`; the client picks that port automatically on local
 * hosts. It shares the same Redis-backed room service as the Vercel route.
 *
 * Run with Bun so the TypeScript path aliases resolve:
 *   bun run dev:ws
 */
import { WebSocketServer } from "ws";
import { attachPartySocket } from "../lib/server/versus/ws-party";

const port = Number(process.env.PARTY_WS_PORT ?? 3001);
const server = new WebSocketServer({ port });

server.on("connection", (ws) => {
  attachPartySocket(ws);
});

server.on("error", (error) => {
  console.error(`[party-ws] ${error.message}`);
  process.exitCode = 1;
});

console.log(`[party-ws] listening on ws://localhost:${port}`);
