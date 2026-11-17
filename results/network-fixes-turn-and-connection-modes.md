# Network fixes, Cloudflare TURN and per-seat connection modes

## What was done

This change addresses the real-browser feedback on the online lobby and replaces
the planned WebSocket gameplay fallback with **Cloudflare Realtime TURN**, which
the owner chose to keep the deployment simple. The host-authoritative WebRTC
session, the wire protocol and the Pixi/DOM split are unchanged.

### 1. Rejoining a seat no longer replays the previous occupant's SDP

Root cause: the signaling store kept every signal forever, and a guest seat is
reused by the next person who joins. A rejoining guest polled with `since=0`
and received the previous occupant's `offer`, answered it, and then waited for
a data channel the host had already closed (the 20 s "No se pudo conectar").

Fix:

- Each peer now has an **epoch** assigned on join, and each signal carries the
  sender/recipient epoch. Signals from a previous occupant of a seat are never
  delivered to the next one (nor to the host once that guest is gone).
- `join` purges any signal addressed to or sent by the reused seat, and `leave`
  purges the departing guest's signals before pushing the `left` note.
- `poll` clamps the cursor to the peer's `joinedSeq`, so even a client that
  starts at zero cannot see pre-join history.

### 2. Join + leave inside one poll no longer kills the host's lobby

Root cause: the host processed `joined` and `left` from the same poll, sent an
offer to a seat that had already left, and the server answered `400 BAD_SIGNAL`.
The client mapped that to `bad-code`, so the host saw **"El código debe tener 6
caracteres."** and the whole lobby entered `failed`.

Fix:

- The store returns a distinct **`PEER_GONE`** (409) when a targeted signal
  names a seat that is no longer present.
- The host checks the poll's presence list before offering, ignores `answer`
  from absent seats, and treats `PEER_GONE` as "drop that seat", never as a
  lobby failure.
- `bad-request` now maps to a new neutral `protocol-error`; `bad-code` is only
  produced by the local six-character check.
- A reused seat drops any previous transport/pending offer before the new
  negotiation.

### 3. Joining after the host started fails immediately

The host now calls `POST { action: "start" }` when the match begins. The room
is marked `started`, and a later `join` returns **`ROOM_STARTED`** (409) with
the Spanish copy "La partida ya ha empezado…". This replaces the 20.4 s wait
for the connect timeout.

### 4. Signal log no longer poisons long lobbies

Read signals, signals addressed to departed seats, signals from a re-occupied
seat, and signals older than two minutes are pruned on every store access.
Thirty join/leave cycles no longer exhaust `MAX_SIGNALS_PER_ROOM`; the cap
remains only as a backstop for signals nobody reads.

### 5. Cloudflare TURN as the connectivity fallback

- `GET /api/ice` mints short-lived Cloudflare Realtime credentials
  server-side, validates the payload, caches it for 30 minutes, and returns
  `{ iceServers }`. The API token never leaves the server.
- If TURN is not configured, Cloudflare fails, or the payload is malformed,
  the route returns a **STUN-only** list, so online play keeps working without
  relay. The static desktop export has no route handler and also falls back to
  STUN in the browser.
- The client fetches and validates the list once per session and passes it to
  every offer/answer. An offline device keeps the empty ICE list.

### 6. Adversarial review fixes

An independent review of the diff confirmed two further defects, both fixed:

- **A failed `/api/ice` request used to disable TURN for the whole page.** The
  client cached the first request and only cleared it when the result was
  empty; every online failure returns a non-empty STUN list, so one 5xx or a
  timeout permanently pinned the session to STUN. The cache now only keeps
  **TURN-capable** lists (for 50 minutes, below the credential TTL); a STUN
  fallback is retried on the next call. The browser timeout (4 s) is now longer
  than the server's Cloudflare timeout (3 s), so a slow-but-successful mint is
  not discarded.
- **Seat reuse while an offer was being created made the new guest negotiate
  twice.** If guest A left and guest B took the seat while the host was still
  awaiting ICE, the server could deliver the in-flight offer to B; the host
  then saw B's `joined`, dropped that offer and sent a second one, while B
  ignored it because it had latched on the first. The host now always
  re-offers on `joined`, and the **guest lets the newest offer win**: a new
  offer supersedes an in-flight negotiation (its peer connection is closed and
  its late failure is ignored), and the guest poll no longer blocks while
  waiting for a data channel. Answers carry the offer's pairing id, so an
  answer for a superseded offer is ignored by the host.

### 7. Connection mode shown under each player

- After the data channel opens, `lib/party/webrtc/connection.ts` reads the
  nominated `candidate-pair` from `getStats()` and extracts each side's
  candidate type (`host`, `srflx`/`prflx`, `relay`).
- The host broadcasts the per-seat map in a new `CONNECTION` wire message; the
  guest reports its own link locally and merges the host's map.
- The lobby seat and the in-game player panel show **"Conexión directa ·
  host"**, **"Conexión directa · STUN"** or **"Conexión por TURN · relay"** under
  the player. The `aria-label` includes the same text.

## Files

### Created

| File | Purpose |
| --- | --- |
| `lib/server/versus/turn.ts` | Server-only Cloudflare TURN credential minting: TTL clamp, 4 s timeout, structural validation of the response (including Cloudflare's separate STUN-only entry), STUN fallback on any failure. |
| `lib/server/versus/turn.test.ts` | Fake-fetch tests: valid payload, STUN-only entry, TTL clamp, missing env, HTTP error, network error, malformed/non-ICE URLs. |
| `app/api/ice/route.ts` | `GET /api/ice`; `connection()` opts out of prerendering, 30-minute in-memory cache, `Cache-Control: no-store`. |
| `lib/party/webrtc/ice.ts` | Browser fetch/validation of `/api/ice`, one in-flight request per page, timeout, STUN/offline fallback. |
| `lib/party/webrtc/ice.test.ts` | Parsing, foreign-URL rejection, endpoint request, 404/network/malformed fallback, offline, fallback-not-cached and TURN-cache-expiry regressions. |
| `lib/party/webrtc/connection.ts` | Reads the selected candidate pair (transport report, then nominated pair) and retries while ICE nominates. |
| `lib/party/webrtc/connection.test.ts` | Fake `getStats()` reports: transport path, TURN relay, unknown type, no pair, retry. |
| `lib/party/connection-copy.ts` | Shared Spanish copy for the per-seat connection mode. |
| `.env.example` | Documents `CLOUDFLARE_TURN_TOKEN_ID` and `CLOUDFLARE_TURN_API_TOKEN` without values. |
| `results/network-fixes-turn-and-connection-modes.md` | This summary. |

### Changed

| File | Change |
| --- | --- |
| `lib/server/versus/rooms.ts` | Seat epochs, `joinedSeq`/`lastPolledSeq`, signal purge on join/leave, signal pruning + 2-minute TTL, `PEER_GONE`, `markStarted`, `ROOM_STARTED`, `started` flag. |
| `app/api/versus/route.ts` | `POST { action: "start" }`; 409 mapping for `ROOM_STARTED` and `PEER_GONE`. |
| `lib/party/versus/signaling-client.ts` | `markStarted()`, store-error body parsing (room-started, peer-gone, too-many-signals), new failure union members. |
| `lib/party/versus/lobby.ts` | `room-started` and `protocol-error` failures with Spanish copy. |
| `lib/party/versus/use-party-session.ts` | Presence-aware host signaling, `PEER_GONE` tolerance, drop-on-rejoin, `markStarted()` at start, TURN-backed ICE servers, connection-pair reporting for host and guest. |
| `lib/party/protocol.ts` | Protocol v4; `SeatConnection`/`IceCandidateType`; `CONNECTION` message and validation. |
| `lib/party/session.ts` | `SessionSnapshot.connections`; `GameSession.setSeatConnection`. |
| `lib/party/sessions/webrtc-host-session.ts` | Stores per-seat connections, broadcasts `CONNECTION`, sends it to late HELLOs, removes entries on peer loss. |
| `lib/party/sessions/webrtc-guest-session.ts` | Stores its own connection and adopts the host's `CONNECTION` map. |
| `lib/party/webrtc/types.ts` | Optional `getStats()` on `PeerConnectionLike`. |
| `components/game/player-panel.tsx` | Connection line under the player name; included in `aria-label`. |
| `components/game/game-stage.tsx` | Optional `connections` prop passed to each panel. |
| `components/party/party-game-screen.tsx` | Passes `snapshot.connections`. |
| `components/party/lobby-seat.tsx` | Connection line under the seat's role. |
| `components/setup/setup-flow.tsx` | Passes `party.snapshot?.connections[seatId]`. |
| `lib/server/versus/rooms.test.ts` | Updated `PEER_GONE`/cap tests; new regressions for stale-seat replay, join+leave in one window, 40-cycle pruning, `markStarted`. |
| `lib/party/versus/signaling-client.test.ts` | Fake server handles `start` and store error statuses; tests for `room-started` and `peer-gone`. |
| `lib/party/protocol.test.ts` | `CONNECTION` round-trip and malformed-map rejection. |
| `lib/party/sessions/webrtc-sessions.test.ts` | Connection map broadcast to every guest; entry removed on disconnect. |
| `.gitignore` | Allows committing `.env.example` while keeping `.env*` ignored. |
| `architecture.md`, `docs/network-architecture.md` | TURN, `/api/ice`, connection modes, seat hygiene, protocol v4, and why TURN was chosen over a WebSocket relay. |

### Deleted

| File | Reason |
| --- | --- |
| — | No production files were deleted. Temporary probe/reproduction files created during investigation were removed before the final diff. |

## Verification

| Command | Result |
| --- | --- |
| `bun test` | **223 pass, 0 fail**, 5,515 assertions across 22 files. |
| `bunx tsc --noEmit -p tsconfig.json` | Clean. |
| `bun run lint` | Clean. |
| `bun run build` (web) | Success; route table lists `ƒ /api/ice` and `ƒ /api/versus`; service worker regenerated (98 entries). |
| `TAURI_BUILD=1 bunx next build` | Success; static export contains only `/`, `/_not-found`, `/offline`, `/play` (no API routes). |
| Cloudflare API check | `POST /credentials/generate-ice-servers` returned **HTTP 201** with one STUN-only entry and one TURN entry (username/credential present). |
| `GET /api/ice` on a production server | **HTTP 200**, 2 entries, TURN URL present, one STUN-only entry. |
| End-to-end signaling script against `next start` | **12/12 checks**: create, join, offer, leave, rejoin, no stale replay, new offer delivered, `PEER_GONE` 409, pre-start join, `start`, late join `ROOM_STARTED` 409, room survives 30 join/leave cycles. |
| Adversarial diff review (3 independent reviewers, per-finding verification) | 8 raw findings → 4 confirmed (2 unique defects, both fixed). |

The end-to-end script used the real production server with the Cloudflare
credentials loaded from `.env.local`; no credential was printed.

## Deviations and follow-ups

- **WebSocket fallback replaced by TURN.** Vercel supports WebSockets through
  `upgradeWebSocket()`, but each connection is pinned to one function instance,
  closes at the function's maximum duration (300 s on Hobby, 800 s on Pro), and
  needs an external store for rooms across instances. TURN solves the same
  connectivity problem without moving gameplay or authority to the server, so
  the owner chose it. The UI label is therefore "Conexión por TURN · relay"
  rather than "conexión autoritativa".
- **Vercel configuration required.** Set `CLOUDFLARE_TURN_TOKEN_ID` and
  `CLOUDFLARE_TURN_API_TOKEN` in the Vercel project (Production and Preview).
  Without them the app still works, but only with STUN.
- **Rotate the API token.** It was shared in plain text during this session.
  Rotate it in the Cloudflare dashboard and update the environment variables.
- **Restart the dev server.** The running `next dev` process started before
  `.env.local` existed; restart it to load the TURN variables. Until then
  `/api/ice` returns the STUN-only fallback locally.
- **Next.js upgrade.** While this work was in progress the environment upgraded
  Next.js from 16.4.2 to 16.4.6 (`package.json`/`bun.lock`), which clears the
  security advisory the earlier builds printed. It is committed separately from
  the network changes.
- **Remaining limits.** The signaling store is still in-memory and
  single-instance, so multi-instance hosting needs an external store. TURN
  bandwidth is billed by Cloudflare when a match is relayed. Mid-match ICE
  failure still keeps the seat and hands it to the host's bot; automatic
  reconnection is not implemented.
