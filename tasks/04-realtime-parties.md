# Task 04 — Realtime parties: create/join APIs + WebSockets

**Read `AGENTS.md` before making any changes, and read and update `architecture.md` after making changes so the architecture is always current.**

## Outcome

Implement the server-authoritative realtime party layer: create a party, join by code, live lobby presence, start a game, and play via WebSocket actions. HTTP endpoints are Next.js App Router route handlers under `app/api/`; the WebSocket connection runs on a custom Node server at `/api/ws`.

This task ends at a working server + typed client library. **No visual UI changes** — wiring the homepage and building the lobby/game screens is a later task.

Task 03 (the Parchís engine) must be complete first. If it is not, stop and flag it; do not reimplement the rules here.

## Architecture at a glance

```
Browser (React, later)
  │
  ├── fetch ─────────────► Next route handlers (app/api/parties/**/route.ts)
  │                             │
  │                             ▼
  │                       PartyStore (in-memory, globalThis)
  │                             ▲
  │                             │ store events (join/start/state)
  └── WebSocket ───────► /api/ws (custom server.ts + ws)
                                │
                                ▼
                         Parchís engine (lib/parchis, pure)
```

### Why a custom server

- Next.js route handlers are request/response only. They cannot perform the HTTP `Upgrade` required by WebSockets.
- Serverless hosts (including Vercel functions) terminate or time out WebSocket connections, and route handlers cannot share memory between requests.
- Therefore the app runs through a long-lived Node process: `server.ts` starts Next with `next({ dev })`, forwards normal requests to `handle(req, res)`, and handles WebSocket upgrades on `/api/ws`.
- For every other upgrade path (notably Next's dev HMR), forward to `app.getUpgradeHandler()(req, socket, head)`. Do not destroy those upgrades.
- `next start` / `next dev` alone will **not** provide WebSockets; the package scripts must run the custom server.

### Shared in-memory state

- `PartyStore` lives in a server-only module and is attached to `globalThis` (e.g. `globalThis.__parchisPartyStore ??= createStore()`) so the custom server and Next's route-handler bundles share one instance in the same process.
- The store is the only source of truth for rooms. The custom server and route handlers both call into it.
- The store emits events (`party-updated`, `state-updated`, `party-finished`, `party-removed`). The WS layer subscribes and broadcasts; HTTP routes never touch sockets directly.
- **Single process / single instance only.** Rooms are lost on restart. Restarting dev clears them. Horizontal scaling requires an external store/pub-sub (Redis, Postgres, etc.) and is out of scope.
- Keep `ws` imports out of route handlers. If a server-only module that imports `ws` ever needs to be bundled by Next, add `serverExternalPackages: ["ws"]` to `next.config.ts`.

## Dependencies and scripts

Add:

- `ws` (runtime)
- `@types/ws` (dev)
- `tsx` (dev, to run `server.ts`; Next docs note custom server files do not go through the Next compiler)

Update `package.json`:

```json
{
  "scripts": {
    "dev": "tsx watch server.ts",
    "build": "next build",
    "start": "NODE_ENV=production tsx server.ts",
    "lint": "eslint",
    "smoke:party": "bun scripts/party-smoke.ts"
  }
}
```

Keep the existing `build`/`lint` behavior. Do not introduce a database, Redis, or an auth provider.

## HTTP endpoints (route handlers)

All endpoints are same-origin, `runtime = "nodejs"`, and return `Cache-Control: no-store`. Bodies are JSON, max 4 KB. Errors use:

```json
{ "error": { "code": "PARTY_FULL", "message": "The party is full." } }
```

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/parties` | none | Create a party; returns the host token |
| `GET` | `/api/parties/[code]` | none | Public lobby info |
| `POST` | `/api/parties/[code]/join` | none | Join a lobby; returns a player token |
| `GET` | `/api/parties/[code]/state` | Bearer token | Snapshot for reconnect |

Next.js 16 notes:

- Dynamic params are async: type the context with `RouteContext<'/api/parties/[code]'>` and `await ctx.params`.
- Route handlers are dynamic by default; do not add static caching. Always send `Cache-Control: no-store`.
- Keep handlers thin: parse/validate the request, call the service in `lib/server/party/http.ts`, map `PartyError` to a status code, return JSON.
- Do not use the Edge runtime.

### `POST /api/parties`

Request (all optional):

```json
{ "avatar": "🦊" }
```

- `avatar`: optional string, trimmed, max 32 characters. Opaque; the server does not enumerate emojis. No HTML.
- Generates a 6-character party code and a host player. The host is seat 0 and will receive a colour when the game starts.
- Returns `201`:

```json
{
  "partyCode": "K7M2QP",
  "playerId": "pl_...",
  "playerToken": "base64url-32-bytes",
  "party": { "code": "K7M2QP", "status": "lobby", "hostPlayerId": "pl_...", "players": [ ... ] }
}
```

### `GET /api/parties/[code]`

Returns `200` with public party info (same `party` shape). `404 PARTY_NOT_FOUND` if missing. Never includes tokens or token hashes.

```json
{
  "code": "K7M2QP",
  "status": "lobby",
  "hostPlayerId": "pl_...",
  "maxPlayers": 4,
  "players": [
    { "id": "pl_...", "avatar": "🦊", "seat": 0, "color": null, "connected": true }
  ],
  "createdAt": 1760000000000
}
```

### `POST /api/parties/[code]/join`

Request:

```json
{ "avatar": "🐙" }
```

- Allowed only while `status === "lobby"` and there are fewer than 4 players.
- Returns `201` with `{ partyCode, playerId, playerToken, party }`.
- Errors: `404 PARTY_NOT_FOUND`, `409 PARTY_FULL`, `409 PARTY_STARTED`, `409 PARTY_FINISHED`, `429 RATE_LIMITED`.
- Joining does not require the host to be connected.
- Broadcast a `PARTY_UPDATE` through the store so connected clients see the new player.

### `GET /api/parties/[code]/state`

- Requires `Authorization: Bearer <playerToken>`.
- Returns the full snapshot: `{ party, state: GameState | null, version }`.
- Errors: `401 UNAUTHORIZED`, `404 PARTY_NOT_FOUND`.
- This is the reconnect/fallback path; the WS `AUTH_OK` message carries the same snapshot.

## Room model and lifecycle

Server-only types (names may differ, but keep the data):

```ts
type PartyStatus = "lobby" | "playing" | "finished";

interface PartyPlayer {
  id: string;
  avatar: string | null;
  seat: number;
  color: Color | null;      // assigned at start
  tokenHash: string;        // sha256 of the raw token
  connected: boolean;
  joinedAt: number;
}

interface PartyRoom {
  code: string;
  mode: "server" | "p2p-1v1"; // Task 04 implements only "server"; Task 07 adds "p2p-1v1"
  status: PartyStatus;
  hostPlayerId: string;
  players: PartyPlayer[];   // seat order
  game: GameState | null;   // Task 03
  version: number;          // increments on create/join/start/accepted action
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}
```

- `mode` defaults to `"server"`. Task 07 extends create/join with `"p2p-1v1"`, which uses the same room codes/tokens/presence but relays WebRTC signaling only (no server-authoritative game actions).

- **Party code:** 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 unambiguous chars, no `0/O/1/I/L`). Generate with `crypto.randomInt`; retry on collision; after ~20 failed attempts return `503`.
- **Player token:** 32 random bytes, base64url (`crypto.randomBytes(32).toString("base64url")`). Return the raw token once. Store only a SHA-256 hash. Compare with `crypto.timingSafeEqual`.
- **Player ID:** `crypto.randomUUID()` (prefixing is fine).
- **Version:** starts at 1 on create. Every accepted mutation (join, start, game action) increments it. Presence changes broadcast but do **not** increment it. Actions carry the version the client last saw (see protocol).
- **Max players:** 4. Start requires 2–4 players and the host.
- **Seat/colour assignment:** seat order = join order; host is seat 0.
  - 4 players: red, blue, yellow, green.
  - 3 players: red, blue, yellow.
  - 2 players: red, yellow (opposite corners).
- **No ready system:** the host starts once at least 2 players are in the lobby.
- **Host:** only meaningful in the lobby (starting the game). Once playing, there are no host powers.
- **Game start:** host sends `START` over WebSocket (see protocol), version must match. Assign colours, call `createGame` with players in seat order, set `status: "playing"`, `game`, `version += 1`, broadcast.
- **Finish:** when the engine reports a winner, set `status: "finished"`, `winnerId`, `finishedAt`, broadcast, and close no sockets immediately. No rematch in this task.
- **Cleanup:** a `setInterval` in the custom server (every 60 s, `.unref()`) calls `store.cleanupExpired(Date.now())`:
  - lobby: no activity for 30 min, or every player disconnected for 10 min → delete;
  - playing: no accepted action / join for 2 h → delete;
  - finished: 10 min after `finishedAt` → delete.
  - On delete, close sockets with 4000 `PARTY_CLOSED` and emit `party-removed`.
  - Make cleanup callable with an injected `now` for tests.
- **Presence:** on WS auth mark `connected: true`; on close mark `connected: false`. Broadcast `PARTY_UPDATE`. The game **does not auto-skip** a disconnected player's turn; it waits for reconnect. Document this.
- **Host transfer (lobby only):** if the host disconnects, wait 60 s; if still disconnected and at least one player is connected, promote the lowest-seat connected player to host and broadcast. Cancel the timer on host reconnect. After the game starts, no promotion is needed.
- **No persistence:** restart clears all rooms.

## WebSocket protocol

Endpoint: `ws(s)://<host>/api/ws`. There is **no** Next route handler at `/api/ws`; the upgrade is handled by `server.ts`.

### Upgrade handling

- Validate `Origin` against the request host (or a comma-separated `ALLOWED_ORIGINS` env allowlist). In development, allow a missing `Origin` for CLI/test clients; in production require a matching origin. Reject with `403` before upgrading.
- Enforce a max payload (`ws` `maxPayload: 16 * 1024`).
- Forward all other upgrade paths to Next's `app.getUpgradeHandler()`; never swallow HMR upgrades.
- Handle upgrade errors without crashing the process.

### Authentication handshake

1. Client connects.
2. Client sends, within 5 seconds:

```json
{ "type": "AUTH", "protocol": 1, "partyCode": "K7M2QP", "token": "raw-player-token" }
```

3. Server validates protocol, room, token, and player. On success:
   - marks the player connected;
   - closes any existing socket for the same player with close code `4001 REPLACED` (one active connection per player);
   - registers the new socket;
   - sends `AUTH_OK` with `playerId`, the public party, `state` (or `null`), `version`;
   - broadcasts `PARTY_UPDATE` to the room.
4. On failure, send an `ERROR` if the socket is still usable, then close:
   - `4002 PROTOCOL_MISMATCH`
   - `4003 AUTH_FAILED`
   - `4004 PARTY_NOT_FOUND`
   - `4008 AUTH_TIMEOUT`
   - `4009 RATE_LIMITED`

Never put the token in the query string or URL. Never log raw tokens.

### Client → server messages

All action messages include `version` (the last version seen) and an optional `requestId` for correlation.

```ts
{ type: "START", version: 3, requestId?: string }
{ type: "ROLL", version: 4, requestId?: string }
{ type: "MOVE", version: 5, move: Move, requestId?: string }
{ type: "BONUS_MOVE", version: 5, move: BonusMove, requestId?: string }
```

- No `PASS` action: after a `ROLL`, if the engine has no legal moves, the server automatically calls the engine's `pass` and broadcasts the result (including the `PASS` event and, on a 6, the extra-roll state).
- The server rolls the die with `crypto.randomInt(1, 7)` and passes the value to the engine. **Never trust a client-supplied die value.**
- `MOVE`/`BONUS_MOVE` must be one of `getLegalMoves` / `getLegalBonusMoves`; validate before applying.
- `START` is host-only and lobby-only.
- Authorize by seat: the authenticated player must equal `players[currentPlayerIndex]`; otherwise `NOT_YOUR_TURN`.
- Version mismatch: reject with `STALE_STATE` and include the current `version` plus the current `state` so the client can resync immediately. Never apply a stale action.
- On success, increment `version`, append the engine events, update `updatedAt`, and broadcast `STATE`:

```json
{ "type": "STATE", "version": 6, "party": { ...public }, "state": { ...GameState }, "events": [ ...new GameEvent[] ] }
```

- On `START`, broadcast `PARTY_UPDATE` (status/colours) followed by `STATE`.
- On win, broadcast `STATE` with `status: "finished"` and then a `PARTY_FINISHED` message if useful; the state already carries the winner.
- On any error, send `{ type: "ERROR", code, message, requestId?, version? , state? }` and leave the state unchanged.

### Server → client messages

```ts
{ type: "AUTH_OK", playerId: string, party: PublicParty, state: GameState | null, version: number }
{ type: "PARTY_UPDATE", party: PublicParty, version: number }
{ type: "STATE", party: PublicParty, state: GameState, events: GameEvent[], version: number }
{ type: "PARTY_FINISHED", party: PublicParty, winnerId: string }
{ type: "ERROR", code: string, message: string, requestId?: string, version?: number, state?: GameState }
```

- `PublicParty` mirrors `GET /api/parties/[code]`, with `status` and assigned `color`s when playing.
- `STATE` is the authoritative snapshot; clients should replace local game state with it after animating `events`.
- Keep messages JSON-only and versioned by `protocol: 1`.

### Error codes

At minimum: `AUTH_FAILED`, `PROTOCOL_MISMATCH`, `AUTH_TIMEOUT`, `BAD_MESSAGE`, `RATE_LIMITED`, `NOT_HOST`, `NOT_YOUR_TURN`, `STALE_STATE`, `ILLEGAL_ACTION`, `PARTY_NOT_FOUND`, `PARTY_FULL`, `PARTY_STARTED`, `PARTY_FINISHED`, `GAME_OVER`, `INTERNAL`. HTTP codes: `INVALID_BODY`, `PARTY_NOT_FOUND`, `PARTY_FULL`, `PARTY_STARTED`, `PARTY_FINISHED`, `UNAUTHORIZED`, `RATE_LIMITED`, `INTERNAL`.

### Connection hygiene

- Heartbeat: server `ping()` every 30 s; mark a socket alive on `pong`; terminate after one missed interval. Clean up the interval on shutdown.
- Malformed JSON or an oversized message: close with `4005 BAD_MESSAGE`.
- Unknown message type: send `ERROR BAD_MESSAGE` and keep the connection.
- One socket per player: a new successful AUTH replaces the old socket (`4001`).
- Reconnect: clients keep `{ partyCode, playerId, token }`; reconnect and re-AUTH; server returns a full `AUTH_OK` snapshot. No special resume token beyond the player token.
- Rate limit authenticated actions per player (e.g. 10 actions/second); excess gets `ERROR RATE_LIMITED` without closing.
- Do not auto-skip turns on disconnect.

## Security and validation

- Tokens: 32 random bytes, stored hashed, compared timing-safely, never logged, never in URLs, never in `PARTY_UPDATE`/public payloads.
- Origin: same-origin WebSocket upgrades; optional `ALLOWED_ORIGINS` env for local tooling. No CORS headers on the API.
- Input: validate party-code format, avatar length/type, JSON shape, and body size. Normalize codes to uppercase and trim.
- Rate limits (in-memory, injectable clock for tests): create 5/min/IP, join 20/min/IP; return `429 RATE_LIMITED`. Derive the IP from `x-forwarded-for`/`x-real-ip` only behind a trusted proxy; otherwise use the socket address. Document the proxy assumption.
- Do not accept a player ID/token from a client other than the AUTH token. Do not allow a client to choose its seat, colour, or another player's identity.
- Same-origin HTTP is enough for CSRF protection here because there are no auth cookies; tokens live in the client and are sent explicitly.
- Cap rooms and players globally (e.g. 1,000 rooms) and return `503` when exceeded to avoid memory exhaustion.

## Client library and transport abstraction (no UI)

Create these modules; they are consumed by the UI tasks:

```
lib/party/protocol.ts      shared types/constants: protocol version, wire message unions,
                           public party shape, error codes, close codes
lib/party/api-client.ts    typed fetch wrappers: createParty, joinParty, getParty, getState;
                           PartyApiError with status + code; fetch cache: "no-store"
lib/party/transport.ts     transport-agnostic GameTransport interface (or abstract class):
                           kind, state, connect, close, send, onMessage, onStateChange
lib/party/session.ts       abstract GameSession class: identical public methods for every
                           transport. This is the only surface the UI/Pixi layers may use.
lib/party/sessions/websocket-session.ts  WebSocketGameSession extends GameSession
lib/party/session-factory.ts  createGameSession(...) returns the right GameSession for a room
lib/party/party-socket.ts  browser WebSocket wrapper implementing GameTransport (no React)
lib/party/session-storage.ts  sessionStorage helpers: save/load/clear a party session
                              { partyCode, playerId, token }; guard `typeof window`
lib/party/authority.ts     shared, browser-safe action application: validates current player,
                           version, phase; applies roll/move/bonus/pass/auto-pass through the
                           engine; returns the new state + events. No Node imports.
```

Requirements:

- **The UI/Pixi layers must depend only on `GameSession`.** They must never import `PartySocket`, `ws`, or (later) WebRTC directly. The same method calls must work regardless of transport.
- `GameSession` is an abstract class with at least:
  - `readonly playerId: string`
  - `readonly transport: "websocket" | "webrtc"`
  - `readonly state: GameState | null`
  - `readonly party: PublicParty | null`
  - `start(): void`
  - `roll(): void`
  - `move(move: Move): void`
  - `bonusMove(move: BonusMove): void`
  - `subscribe(listener: (snapshot: SessionSnapshot) => void): () => void`
  - error and transport-state subscriptions (or include them in `SessionSnapshot`)
  - `dispose(): void`
- `GameTransport` exposes at least `kind`, `state`, `connect()`, `close()`, `send(WireMessage)`, `onMessage`, and `onStateChange`. `PartySocket` implements this interface.
- `WebSocketGameSession` is the only `GameSession` implementation in this task. It wraps `PartySocket` and the existing WS protocol.
- `authority.ts` is shared and pure/browser-safe. The server WS layer must use it for roll/move/bonus/auto-pass validation, and the future P2P host will reuse the exact same module. The caller supplies the die value (the server uses `crypto.randomInt`; the P2P host will use its own RNG). Do not duplicate action-validation logic between the server and the session layer.
- `session-factory.ts` selects the implementation based on the room's transport/mode. It must be trivial to add a WebRTC implementation without changing callers.
- Task 07 will add `WebRTCPeerHostSession` and `WebRTCPeerGuestSession` extending `GameSession`. That task must not require UI or `GameStage` changes; prove this with the factory/interface.
- Add a `MockTransport` test helper that drives a full game through `WebSocketGameSession` with no real socket. This proves the UI-facing layer is transport-agnostic.
- `party-socket.ts` must not import server code, `ws`, Node built-ins, or React. It uses the browser `WebSocket` (allow an injected `WebSocketImpl` for tests).
- Reconnect only on abnormal/network closes; do not reconnect after `AUTH_FAILED`, `PROTOCOL_MISMATCH`, or `REPLACED`.
- The client must never invent game state; it replaces its snapshot from `STATE`/`AUTH_OK`.
- The client sends the latest known `version` on every action and handles `STALE_STATE` by adopting the included state.
- Do not build React hooks, screens, buttons, or navigation in this task.

## Files

```
server.ts
app/api/parties/route.ts
app/api/parties/[code]/route.ts
app/api/parties/[code]/join/route.ts
app/api/parties/[code]/state/route.ts
lib/party/protocol.ts
lib/party/api-client.ts
lib/party/transport.ts
lib/party/session.ts
lib/party/sessions/websocket-session.ts
lib/party/session-factory.ts
lib/party/party-socket.ts
lib/party/session-storage.ts
lib/party/authority.ts
lib/server/party/store.ts
lib/server/party/http.ts
lib/server/party/ws.ts
lib/server/party/codes.ts
lib/server/party/auth.ts
lib/server/party/rate-limit.ts
lib/server/party/cleanup.ts
scripts/party-smoke.ts
```

Keep route handlers thin; put logic in `lib/server/party/http.ts`. Keep the store and WS layer server-only; keep `protocol.ts` dependency-free so both sides can import it.

## Testing

- Unit tests with `bun test`:
  - Store: code generation/format/collisions, create/join/start, capacity/status guards, token auth, version bumps, cleanup with an injected clock, host transfer with a short grace.
  - HTTP service: create/join/get/state, error codes/statuses, input validation, rate limiting with an injected clock.
  - Protocol/WS integration: start `lib/server/party/ws.ts` on an ephemeral HTTP port (`http.createServer` + `WebSocketServer`), connect real `ws` clients, and assert AUTH, presence, start, roll/move broadcasts, auto-pass, stale-version rejection, illegal-action rejection, reconnect/replace, and close codes.
  - Client: exercise `PartySocket` against the test WS server with Bun's WebSocket or an injected implementation; at least test AUTH, state replacement, action versioning, and no-reconnect close codes.
  - Transport abstraction: drive `WebSocketGameSession` through a `MockTransport` for a complete game (roll, move, bonus, auto-pass, win) without a socket; assert the server and the mock path produce identical events/state for the same inputs via the shared `authority.ts`.
  - Authority: unit-test the shared action application directly (current player, version, phase, auto-pass, bonuses), so the future P2P host reuses tested behavior.
- Keep tests deterministic and fast; inject clocks/timers where possible. Do not add test dependencies.
- Smoke test: `scripts/party-smoke.ts`
  - assumes `bun dev` is running (default `http://localhost:3000`);
  - creates a host via `POST /api/parties`, joins a guest via `POST /api/parties/[code]/join`;
  - opens two WS connections, AUTHs, starts the game, rolls, waits for `STATE`, asserts both clients see the same version;
  - exits non-zero on failure and closes sockets cleanly.
  - Add it as `smoke:party` in `package.json`.
- Manual checklist (include in the report):
  - `bun dev` serves the existing homepage and `/api/ws` upgrades.
  - The homepage still works with no console errors.
  - Creating and joining via curl works; errors are correctly shaped.
  - Two browser tabs (or `wscat`) can join the same party and see presence.

## Acceptance criteria

- `bun run lint`, `bunx tsc --noEmit`, and `bun test` pass.
- `bun dev` starts the custom server and the existing app still loads at `/`.
- `POST /api/parties`, `GET /api/parties/[code]`, `POST /api/parties/[code]/join`, and `GET /api/parties/[code]/state` work and validate input.
- Two clients can create/join a party, AUTH over `/api/ws`, start a 2-player game, and play a roll/move round; both receive the same authoritative state.
- Dice values come from the server only.
- Stale versions, non-current players, illegal moves, full/started parties, and bad tokens are rejected with the defined codes.
- Reconnect with a valid token restores the full snapshot; a second socket replaces the first with `4001`.
- The UI-facing layer depends only on `GameSession`; a `MockTransport` can complete a game with no real socket, and no UI code imports `PartySocket`.
- The server and the session layer share `authority.ts`; action validation/auto-pass logic is not duplicated.
- No token appears in any URL, log line, public payload, or error message.
- No UI, page, or PixiJS changes are made.
- `architecture.md` is updated.

## Out of scope

- Homepage wiring, lobby UI, game screen, PixiJS board, animations, sounds, Spanish UI copy for new screens.
- Persistence, databases, Redis, multi-instance scaling, sticky sessions.
- Accounts, auth providers, profiles, matchmaking, friends, chat, emotes, spectators, voice.
- AI opponents, rematches, rankings, tournaments, turn timers/auto-skip.
- Deploying to serverless platforms. The app must run on a long-lived Node host; behind a proxy, WebSocket upgrade headers must be forwarded. Use `wss://` in production.
- Offline support/service worker changes.
- WebRTC/P2P transport, 1v1 peer connections, signaling relay, and the WebRTC `GameSession` implementations — Task 07, after all other tasks are complete.

## Definition of done

- Update `architecture.md` with: the custom server and why, the shared `PartyStore`, HTTP endpoints, WebSocket endpoint/protocol/close codes, versioning, auth/token handling, single-instance limitation, deployment requirement, and the new module boundaries.
- Report files added, commands run, test counts, how the smoke test was run, and any deviations or unresolved protocol details.
- Flag anything ambiguous rather than silently inventing a rule.
