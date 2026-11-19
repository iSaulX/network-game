# Server-authoritative WebSocket party

**Status:** implemented on branch `feat/websocket-game` (working tree not
committed at the time of writing).

## Goal

Replace the direct WebRTC gameplay transport with WebSockets and Redis:
room create/join stays on HTTP, gameplay travels over one authenticated
WebSocket per client, and the server owns the authoritative game state in
Redis. Vercel Functions cap socket lifetime and pin a socket to one instance,
so the mode uses Redis pub/sub across instances and automatic reconnection.

## Architecture

- **Room allocation:** `POST /api/versus` still creates/joins the Redis-backed
  room and returns the six-character code and per-peer token. The token is sent
  in the first WebSocket message (`AUTH`), never in a URL.
- **Authority:** `lib/server/versus/party-state.ts` keeps the game state,
  version, roster, profiles, presence, empty seats and `botDueAt` inside the
  room snapshot. `lib/party/authority.ts` validates actor → turn → version →
  phase → legality; only `ROLL` draws server-side crypto dice. Bots and
  disconnected humans are played by the server with `lib/bots/policy`.
- **Socket server:** `lib/server/versus/ws-party.ts` handles `AUTH`, `HELLO`,
  `ACTION`, `START`, `SET_SEAT_EMPTY`, `PING` and `LEAVE`. It keeps a local
  socket registry and subscribes to `parchis:versus:events:<code>`; every
  mutation is published so sockets on other instances see it.
- **Vercel entry point:** `app/api/party/socket/route.ts` calls
  `upgradeWebSocket()` from `@vercel/functions` (with `ws`).
- **Reconnect:** `lib/party/websocket/party-socket-transport.ts` reconnects
  with backoff, re-AUTHs, and receives a full `START` + `STATE`. `PING` every
  10 s refreshes presence; `PRESENCE_TTL_MS` (30 s) marks a silent seat as
  disconnected and the server plays it until it returns.
- **Client session:** `ServerGameSession` extends the guest session and adds
  the host controls; `usePartySession` now creates/joins over HTTP, opens the
  socket and wires the session to the existing lobby reducer. The UI and
  `GameStage` are unchanged.
- **Local development:** `bun run dev:ws` starts `scripts/party-ws-server.ts`
  (a Bun `ws` server on port 3001). The client uses that port on local hosts
  and `/api/party/socket` elsewhere; `NEXT_PUBLIC_PARTY_WS_URL` overrides it.
- **Lobby:** connected humans are listed live, the host can leave guest seats
  empty, and the server fills the remaining seats with bots unless empty. Seat
  colours, the 1v1 diagonal and 2–4-seat rosters are unchanged.

## Files

Created:

- `app/api/party/socket/route.ts`
- `scripts/party-ws-server.ts`
- `lib/server/versus/party-state.ts`
- `lib/server/versus/party-state.test.ts`
- `lib/server/versus/ws-party.ts`
- `lib/party/websocket/messages.ts`
- `lib/party/websocket/party-socket-transport.ts`
- `lib/party/websocket/party-socket-transport.test.ts`
- `lib/party/sessions/server-game-session.ts`
- `results/websocket-game.md`

Changed:

- `lib/party/versus/use-party-session.ts` — rewritten around the party socket.
- `lib/party/versus/lobby.ts` — `no-websocket` failure copy and joining copy.
- `lib/party/webrtc/support.ts` — screens `WebSocket` instead of WebRTC.
- `lib/party/protocol.ts` — `websocket` seat transport and exported validators.
- `lib/party/transport.ts` — `websocket` transport kind.
- `lib/party/connection-copy.ts` — server/WebSocket connection label.
- `lib/party/sessions/webrtc-guest-session.ts` — optional seat-empty params.
- `lib/server/versus/rooms.ts` — party state in the room snapshot, TTL rule and
  serialization/validation.
- `lib/server/versus/redis-store.ts` — authorized and server-side party
  mutations under the existing per-room lock.
- `package.json`, `bun.lock` — `@vercel/functions`, `ws`, `@types/ws`,
  `dev:ws` script.
- `.env.example` — optional `NEXT_PUBLIC_PARTY_WS_URL`.
- `architecture.md`, `docs/network-architecture.md`.

The legacy WebRTC/ICE files and `/api/ice` were left in place for tests and
rollback; the setup flow no longer imports them.

## Verification

- `./node_modules/.bin/tsc --noEmit` — pass.
- `bun test` — **240 pass, 0 fail** across 25 files, including the 10
  authoritative-party tests and 2 party-socket transport tests.
- `bun run lint` — pass.
- `npm run build` — pass; `/api/party/socket` and `/api/versus` are dynamic.
- End-to-end with real Redis and `bun run dev:ws`: host/guest AUTH, live lobby,
  host start, host roll (both clients received `STATE` v1), guest reconnect
  received the preserved snapshot, and host leave closed the room.
- Bot/seat test: a 4-seat room with an empty guest seat started with two bots,
  the server advanced a bot (`STATE` v1), and a bad token received
  `AUTH_ERROR unauthorized`.
- Cross-instance test: host on WS server A (3001) and guest on WS server B
  (3002) sharing Redis. The guest's join reached the host, and `START`,
  `STATE` and `BYE` from the host reached the guest through Redis pub/sub.
- Test room and lock keys were deleted from Redis afterwards.

## Deviations and limitations

- `upgradeWebSocket()` only works in the Vercel runtime. The route builds and
  is dynamic, but the actual upgrade was not exercised locally; local play
  uses the Bun WebSocket server. A Vercel deploy is still required to verify
  that path end-to-end.
- No rate limiter on authenticated actions. `applyAction` rejects off-turn,
  stale, phase-invalid and illegal actions, but a spammy client can still add
  Redis load.
- No reconnect grace period: a seat silent for 30 s is automated immediately
  when its turn arrives. The player resumes control on reconnect.
- An intentional host leave closes the room; a dropped host is played by the
  server and can reconnect. There is no host migration or rematch.
- The authoritative state and peer tokens are stored in Redis for the room TTL.
  One Redis instance remains a single point of failure; the free tier's
  connection limit is the practical ceiling.
- The legacy WebRTC/ICE code and HTTP signal/poll endpoints remain in the
  repository but are unused by the UI.
- `package-lock.json` is untracked (pre-existing); `bun.lock` is the tracked
  lockfile and was updated for the new dependencies.
- The working tree also contains unrelated PWA route-recovery changes
  (`next.config.ts`, `scripts/service-worker-template.js`,
  `results/pwa-home-routes.md`, parts of `architecture.md`) made concurrently;
  they were preserved and are not part of this task.
