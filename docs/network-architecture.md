# Parchís Stars — Network Architecture Reference

Technical reference for the networking layer of Parchís Stars: how two or four
browsers find each other, how the game state stays consistent, and how the
server-authoritative alternative (WebSocket) maps onto the same design. Written
so another engineer or AI agent can produce a PDF from it.

Scope: the **network** only. Game rules, rendering and UI are out of scope.

---

## 1. Summary

| Layer | Technology | Role |
| --- | --- | --- |
| Transport of gameplay | WebSocket to the party server (one per client) | Carries intents up and authoritative snapshots down |
| Room allocation | Plain HTTP (`POST /api/versus`) backed by Redis | Creates/joins a seat and returns a per-peer token |
| Game authority | Server process + Redis room snapshot | Validates every action, owns dice, roster and state |
| Cross-instance fan-out | Redis pub/sub (`parchis:versus:events:<code>`) | Delivers every event to sockets on other serverless instances |
| Legacy transport | WebRTC `RTCDataChannel` + HTTP signaling + ICE/TURN | Kept for tests/rollback; no longer used by the UI |
| Identity | 6-character room code + 64-hex per-peer token | Room lookup and per-peer authentication |

The implemented architecture is **server-authoritative over WebSockets, with
Redis as the shared store and message bus**. Clients only send intents; the
server applies the engine and broadcasts snapshots. The peer-to-peer WebRTC
design in sections 2–8 remains in the repository as the legacy path and is
documented here for comparison.

---

## 2. Why peer-to-peer at all

A turn-based board game sends a few hundred small JSON messages per match.
Routing those through a central server is simple, but it costs a server, a
socket, and latency from both players to that server. A peer-to-peer data
channel removes the middle hop entirely: the message delay becomes
`player A → player B` instead of `A → server → B`.

The trade-off is that connectivity is harder: two browsers behind home routers
cannot normally open a UDP connection to each other. Everything in this document
exists to solve that one problem, then to keep the game correct once the
connection exists.

---

## 3. The networking primer

This section explains the primitives so the rest of the document is readable
without prior WebRTC experience.

### 3.1 UDP, TCP, SCTP and DATAGRAM

- **UDP** is connectionless and unreliable. A datagram may be lost, duplicated
  or reordered. It has no handshake, so it is cheap and low-latency.
- **TCP** is connection-oriented and reliable, with ordered delivery and
  congestion control. It is what HTTP rides on today.
- **SCTP** sits above IP and can carry multiple ordered/unordered streams with
  reliable or partial-reliability delivery. WebRTC uses SCTP over DTLS over
  UDP for data channels.
- **DATAGRAM / SCTP partial reliability** allow unreliable, unordered messages
  for real-time media-like traffic.

WebRTC data channels therefore give application-level **reliability choices**:

| Property | What Parchís Stars uses | Why |
| --- | --- | --- |
| Ordered delivery | yes (`ordered: true`) | Game actions must apply in order |
| Reliability | yes (no retransmit cap) | Losing a move would desync the match |
| Channel count | one per peer | Simple, single sequence per link |
| Label | `parchis-v1` | Versioned protocol namespace |

A real-time shooter would choose the opposite (unordered, unreliable). The
choice must match the game: a turn-based game must never silently lose a move.

### 3.2 NAT: why peers cannot connect directly

A home router performs **NAT** (Network Address Translation): devices get
private addresses such as `192.168.1.42`, and the router rewrites outbound
traffic to its public IP with a port mapping. Inbound packets are dropped
unless the router already has a mapping for them.

A peer therefore does not know its own public address or port, and the mapping
only exists after outbound traffic creates it. Three families matter:

- **Full-cone NAT**: once an outbound mapping exists, any external host can
  reach it. Easiest to traverse.
- **Restricted / port-restricted cone NAT**: only hosts the peer has already
  sent to (or the exact IP:port) may send inbound packets.
- **Symmetric NAT**: a distinct mapping per destination IP:port. The same peer
  reaching two destinations appears under two different public ports. This is
  the hardest case and the usual reason peer-to-peer fails.

### 3.3 STUN

**STUN** (Session Traversal Utilities for NAT) is a tiny UDP request/response
protocol. The client sends a binding request to a STUN server; the server
replies with the public IP and port it observed. The client learns its
**server-reflexive candidate** — the address the outside world sees.

STUN does not relay traffic. It only reports an address. That distinction is
fundamental: STUN *helps* peers find each other; it does not *carry* their game.

Parchís Stars uses `stun:stun.cloudflare.com:3478` when `navigator.onLine` is
true, and **no ICE servers at all** when offline (an offline peer cannot reach a
STUN server anyway, and a LAN-only match should not wait on one).

### 3.4 TURN (Cloudflare Realtime)

**TURN** is a relay: when hole punching fails, both peers connect to the TURN
server, which forwards packets between them. It works through almost every NAT,
at the cost of bandwidth, latency and a relay service.

Parchís Stars uses **Cloudflare Realtime TURN** as the last ICE candidate type.
It is not a separate transport and it does not change the authority model: the
data channel still runs peer-to-peer logically, with TURN relaying the packets.

Credentials are **short-lived and minted server-side**:

1. The browser calls `GET /api/ice` (same origin).
2. The route handler asks Cloudflare's
   `POST /v1/turn/keys/{tokenId}/credentials/generate-ice-servers` with the
   `Authorization: Bearer <API token>` header and a one-hour TTL.
3. The validated `{ iceServers }` list is cached for 30 minutes and returned.
4. The API token stays in the server process; only the expiring
   username/credential reach the browser.

If the env vars are missing, Cloudflare is down, or the payload is malformed,
the route returns a **STUN-only** list. Online play keeps working without relay
instead of failing. The static desktop export has no route handler, so it also
gets the STUN-only path from the client fallback.

The UI makes the selected path visible: after the channel opens, the host reads
the nominated candidate pair from `getStats()` and broadcasts each seat's
candidate type (`host`, `srflx`/`prflx`, `relay`). The lobby and the in-game
player panels show "Conexión directa · host/STUN" or "Conexión por TURN · relay"
under the player. A relayed match is therefore never silent.

Consequence: symmetric NATs, restrictive corporate firewalls and networks with
client isolation still can fail, but only when TURN itself is unreachable or
blocked (for example, a network that blocks TCP 443 as well).

### 3.5 ICE and UDP hole punching

**ICE** (Interactive Connectivity Establishment) is the coordination protocol.
It works in four conceptual steps:

1. **Gather candidates.** Each peer collects:
   - **host** candidates: local IPs/interfaces;
   - **server-reflexive** candidates: public mapping from STUN;
   - **relay** candidates: from TURN (Cloudflare, minted per session).
2. **Exchange candidates.** Candidates travel in the SDP (or incrementally
   via `onicecandidate`).
3. **Connectivity checks.** Each peer sends STUN binding requests to every
   pair of candidates. A request that receives a response proves a working
   path in both directions — because the outbound packet created a NAT mapping
   that the response can return through.
4. **Nominate.** ICE selects the best working pair (usually the server-reflexive
   one) and the data channel starts.

The "hole punching" is step 3: simultaneous outbound packets create mappings on
both routers that let the incoming responses through. Note the requirement:
hole punching works when *both* sides send. That is why both peers must gather
and check candidates, not just listen.

### 3.6 Trickle vs non-trickle ICE

- **Trickle ICE** streams candidates as they are found. Faster setup, but the
  signaling channel must be able to deliver many small messages.
- **Non-trickle (vanilla) ICE** waits for gathering to finish (`iceGatheringState
  === "complete"` or an end-of-candidates null candidate) and sends everything
  in one offer/answer. Slower by the gathering timeout, but one message.

Parchís Stars uses **non-trickle ICE** because its signaling is an HTTP
long-poll: sending one SDP string per peer is far cheaper than an event stream.
Gathering is capped at **2.5 s**; if the timer wins, the current
`localDescription` is used. The extra wait is bounded and acceptable in a lobby.

### 3.7 SDP

**SDP** (Session Description Protocol) is a text format describing a session:
media lines, codecs, ICE candidates, fingerprints, DTLS role. In WebRTC:

- The **offerer** creates an offer (`pc.createOffer()`), sets it locally and
  sends it.
- The **answerer** receives it, `setRemoteDescription`, creates an answer
  (`pc.createAnswer()`), sets it locally and sends it back.
- The offerer applies the answer.

Parchís Stars treats SDP as opaque data with two guardrails: it is JSON-wrapped
with a `kind` (`offer`/`answer`) and an id, validated structurally before it
reaches `RTCPeerConnection`, and it is never logged or persisted.

### 3.8 DTLS and fingerprints

WebRTC encrypts data channels with **DTLS** (TLS over UDP). The SDP carries a
certificate fingerprint, so the peer can verify the far end during the DTLS
handshake. This means game traffic is encrypted in transit even though the
signaling server is plain HTTP.

### 3.9 Secure contexts

`RTCPeerConnection` exists only in a **secure context**: HTTPS, `localhost`, or
an installed app (Tauri). The app screens for `window.isSecureContext` and for
the constructor before offering online play, and explains the limitation in
Spanish otherwise.

---

## 4. Parchís Stars topology

### 4.1 Star, not mesh

A room seats **one host and up to three guests** (2 seats for `1v1`, 4 for
`all`). The host opens **one `RTCPeerConnection` and one data channel per
guest**. Guests never connect to each other.

```
        guest-1  <--\
                     \        (one data channel each)
        guest-2  <---- host
                     /
        guest-3  <--/
```

Why a star:

- The host already needs to be authoritative (see §6), so one hub is natural.
- A mesh with four peers needs six connections; a star needs three.
- NAT traversal happens once per guest against one known counterpart.
- Guests cannot spam each other; every action passes authority.

Costs: the host is a single point of failure, and its uplink carries all game
traffic. For a turn-based game with four players the volume is negligible.

### 4.2 Seats and colours

Seats are stable ids, not session objects:

| Seat | Role | Board colour (1v1) | Board colour (4 players) |
| --- | --- | --- | --- |
| `host` | host | red | red |
| `guest-1` | guest | green | yellow |
| `guest-2` | guest | — | blue |
| `guest-3` | guest | — | green |

A 1v1 places the players on **opposite corners** (red and green). Bots fill
unoccupied seats when the host starts: `bot-red`, `bot-yellow`, `bot-blue`,
`bot-green`.

---

## 5. Signaling

Signaling is the only server role: introduce peers so they can build the direct
connection.

### 5.1 HTTP long-poll, not WebSocket

The current implementation uses plain HTTP:

- `POST /api/versus` with `{ action }`:
  - `create` (optional `capacity` 2/4) → `{ code, id: "host", token, role }`
  - `join` `{ code }` → `{ code, id: "guest-N", token, role }`
  - `signal` `{ code, id, token, kind, payload, to }` → relay one signal
  - `leave` `{ code, id, token }` → free the seat or close the room
- `GET /api/versus?code=&id=&since=&` with `Authorization: Bearer <token>`
  → `{ seq, signals[], present, capacity, closed }`

Clients poll every **700 ms** while pairing. Once a data channel opens, polling
stops: gameplay never touches HTTP.

Why HTTP instead of WebSocket for signaling:

- No custom server, no upgrade handling, no socket lifecycle.
- Works on standard serverless Next.js route handlers.
- Long-poll is enough for the few messages a pairing produces.

Why it is a poor fit for gameplay: each poll is a request, and a turn-based
game would need to keep a poll open forever to receive the opponent's move.
The direct channel removes that.

### 5.2 Room codes and tokens

- **Room code**: 6 characters from `A–Z` `2–9` minus ambiguous glyphs
  (`I`, `O`, `0`, `1`). Human-readable, typed by hand. Uppercased/trimmed.
- **Token**: 32 random bytes → 64 hex characters, one per peer.
  - Sent in the `Authorization: Bearer` header or in the POST body.
  - Never in a URL, never logged, never stored in a database.
  - Validated by pattern, not by lookup alone.

A room holds at most 64 signals and caps each payload at 20,000 characters.
Rooms expire after 30 minutes of activity; a room with no guest expires 10
minutes after creation, even if the host keeps polling (polling alone cannot
keep an empty room alive forever).

### 5.3 The join dance

```
host                      server                       guest
 | create ------------------>|                            |
 |<------ code, host token --|                            |
 |                          |<-------------------- join ---|
 |                          |------ code, guest token --->|
 |                          |                            |
 |<--- joined note (poll) --|                            |
 |                                                      |
 | create PC + data channel                             |
 | gather ICE (<= 2.5 s)                                |
 |------ offer (to guest) -->|-------- offer (poll) ----->|
 |                          |                            |
 |                          |                answer ----->|
 |<--- answer (poll) -------|<---------------------------|
 | setRemoteDescription                                 |
 |<======== direct data channel opens ==================>|
 |                          |          polling stops     |
```

Presence gives the host the live roster: `{ host: true, guests: ["guest-1"] }`.
The `joined` and `left` signals are never echoed to their sender; they tell the
host when to start or drop a connection.

### 5.4 Redis-backed store

Rooms are stored in Redis as one JSON value per code, so every serverless
instance sees the same state: a host can create on one invocation and a guest
can join on another. Each mutation runs under a short 5 s per-room lock, and
the room key carries the same TTL rules as the in-memory store (30 min with
guests, 10 min while guest-less). A Redis failure returns `STORE_UNAVAILABLE`
(503) instead of silently falling back to process memory, because a mixed
store would split a room across instances. Game state never reaches Redis.

---

## 6. Authority model

WebRTC gives a connection, not a referee. Authority is a separate design.

### 6.1 Host-authoritative session

The host's browser owns:

- the canonical `GameState`;
- a monotonic **version** counter;
- the dice (`crypto.getRandomValues`, rejection sampling for uniformity).

Guests hold a replica. They never invent state; they send **intents**:

```json
{ "type": "ACTION", "protocol": 2, "version": 7, "action": { "type": "ROLL" }, "requestId": "…" }
```

The host validates, in this order:

1. **Actor**: is this peer seated in the roster?
2. **Turn**: does the action belong to the current player?
3. **Version**: does the guest's version match? (stale → `STALE_VERSION`)
4. **Phase**: is the action legal in the current phase? (`WRONG_PHASE`)
5. **Legality**: is the move legal per the pure engine? (`ILLEGAL_MOVE`)
6. **Rate limit**: too many actions per window (`RATE_LIMITED`)

Only `ROLL` draws dice, and only on the host. A guest structurally cannot send
a die value; there is no field for it in the protocol.

Every accepted action increments the version and the host broadcasts a full
`STATE` snapshot to all guests. Snapshots are the only state source for
guests; stale or duplicate versions are ignored, and the next snapshot repairs
any gap.

### 6.2 Why snapshots and not deltas

A full snapshot is a few kilobytes of JSON. Deltas need sequence management,
replay and gap recovery. For a turn-based game, snapshots are simpler and
self-healing: a lost message is corrected by the next one. The data channel is
reliable anyway; snapshots are insurance against reconnection edges, not a
substitute for reliability.

### 6.3 Bots and disconnects

The host plays every seat that is not a connected human, using the same
deterministic policy as the local bot mode. Empty seats become bots when the
match starts. A guest that drops mid-match keeps its seat, and the host plays
it — the match never blocks on a lost player.

The guest trusts the host: there is no anti-cheat, no server-side replay
audit, no ranked play. This mode is for friends.

---

## 7. Wire protocol

Protocol version **4**. Every message is JSON; every inbound message is
structurally validated. Inbound messages are capped at **64 KB**; outbound
sends throw above 1 MB of `bufferedAmount` (backpressure guard).

| Message | Direction | Payload |
| --- | --- | --- |
| `HELLO` | guest → host | `protocol`, `player {id,name,avatar}` |
| `ACTION` | guest → host | `version`, `action`, `requestId` |
| `LOBBY` | host → guests | `mode`, `players[]`, `emptySeats[]` |
| `START` | host → guests | `version`, `mode`, `roster {players[]}`, `state` |
| `STATE` | host → guests | `version`, `state`, `events[]` |
| `ERROR` | host → guest | `version`, `code`, `message`, optional `state` |
| `CONNECTION` | host → guests | `connections: { seatId: { transport, candidate } }` |
| `BYE` | host → guests | `reason` |

`CONNECTION` is how the selected ICE path is shared: `transport` is `webrtc`
(or `memory` in tests) and `candidate` is `host`, `srflx`, `prflx`, `relay` or
`unknown`. The map has at most four entries and every key must be a human seat.

Validation rules worth highlighting:

- Names are trimmed and capped at **24 characters**.
- Avatars must be `/pictures/[a-z]+.png`; a peer can never point the client at
  a remote URL.
- Player ids must be `host`, `guest-1..3` or `bot-<colour>`.
- Rosters have 2 or 4 players with unique ids and include the host.
- Actions are checked field by field: no extra keys, integer versions, bounded
  progress values (0–71).

This is input validation at the trust boundary: the peer connection is direct,
so the far end is untrusted.

---

## 8. Encodings and loss

- **Messages**: JSON. Human-debuggable, naturally schema-checked. The cost
  (verbose) is irrelevant at the message rates of a board game.
- **Binary framing**: not used for gameplay. The data channel is a message-
  oriented SCTP stream, so each `send` is one message; length prefixes are
  unnecessary.
- **Compression**: none. Payloads are small, and compression on small messages
  costs CPU without meaningful savings.
- **Loss**: none expected on a reliable ordered channel. If the channel fails,
  the session fails (`failed`/`disconnected`) rather than replaying silently.

---

## 9. WebSocket server-authoritative mode (implemented)

The UI now uses the server-authoritative mode: one authenticated WebSocket per
client, game state in Redis, and Redis pub/sub so serverless instances share a
room. The WebRTC peer-to-peer design above is legacy.

### 9.1 Comparison

| Concern | Peer-to-peer (legacy) | Server-authoritative (implemented) |
| --- | --- | --- |
| Connection | WebRTC data channel per guest | One WebSocket per client |
| Who owns state | Host peer | Server process + Redis snapshot |
| Who rolls dice | Host peer (crypto) | Server (`crypto.getRandomValues`) |
| Trust boundary | Guests trust host | Server validates every intent |
| Discovery | HTTP signaling + room code | HTTP room code → WS `AUTH` |
| Latency path | peer → peer | peer → server → peers |
| NAT problem | Hard (ICE/STUN/TURN) | None (outbound WS to a server) |
| Failure mode | Connection may be impossible | Server down / socket drop / function timeout |
| Cost | No server in gameplay | Server sockets + Redis |

WebSockets avoid the NAT chapter entirely: both clients make an outbound
connection to a public server, which is the direction NAT permits. The price is
that every action takes two hops, the server is stateful, and a function's
socket lifetime is capped.

### 9.2 Same protocol, different transport

The wire messages (`HELLO`, `ACTION`, `LOBBY`, `START`, `STATE`, `ERROR`,
`CONNECTION`, `BYE`) stayed transport-agnostic. `GameTransport` now includes
the WebSocket kind:

```ts
interface GameTransport {
  readonly kind: "memory" | "webrtc" | "websocket";
  readonly status: TransportStatus;
  connect(): Promise<void>;
  send(message: WireMessage): void;
  subscribe(listener: (message: WireMessage) => void): () => void;
  subscribeStatus(listener: (status: TransportStatus) => void): () => void;
  close(): void;
}
```

`PartySocketTransport` (`lib/party/websocket/party-socket-transport.ts`)
implements it, and `ServerGameSession` extends the guest session with the host
controls. The UI never knows which transport is underneath.

### 9.3 What the server does

1. **Authentication**: the room token issued by HTTP is sent in the first WS
   message (`AUTH`), never in a URL. The token is stored in Redis only for the
   room TTL.
2. **Validation**: `lib/party/authority.ts` runs the same actor → turn →
   version → phase → legality chain on the server.
3. **Dice**: only `ROLL` draws dice, with `crypto.getRandomValues` server-side.
4. **Broadcast**: one authoritative snapshot per accepted action, published on
   the room's Redis channel and delivered to every instance's local sockets.
5. **Lifecycle**: reconnect via token, presence heartbeats, room expiry, and a
   server-driven bot step for bots or disconnected humans.
6. **Scale**: every instance shares the room snapshot and pub/sub channel in
   Redis; there is no sticky routing requirement.

### 9.4 How the Vercel constraints are handled

`upgradeWebSocket()` from `@vercel/functions` (with `ws`) performs the upgrade
inside a function. The implementation compensates for the two limits:

- **Pinned instance:** a room's players may land on different functions. Each
  function subscribes to `parchis:versus:events:<code>`; every mutation reads
  and writes the same Redis room snapshot under a per-room lock, and publishes
  the resulting message. Local sockets are only a delivery registry.
- **Maximum duration (300 s Hobby / 800 s Pro):** the browser transport
  reconnects with backoff, re-AUTHs and receives a full `START` + `STATE`
  snapshot. `PING` heartbeats (10 s) refresh presence and trigger bot advances.
  A reconnecting human is removed from the disconnected list and resumes their
  seat.
- **Local development:** `next dev` cannot upgrade sockets in a route handler.
  `bun run dev:ws` starts a Bun `ws` server on port 3001; the client defaults to
  that port on local hosts and to `/api/party/socket` elsewhere.

---

## 10. Failure taxonomy

Every networking failure maps to one user-visible Spanish message. None of them
silently degrades into another mode.

| Failure | Cause | UX |
| --- | --- | --- |
| `insecure-context` | Not HTTPS and not installed | Explains secure-context requirement |
| `no-websocket` | No browser `WebSocket` | Suggests an updated browser |
| `offline` | `navigator.onLine === false` | Asks for a connection |
| `server-unreachable` | Room request or WS `AUTH` fails | Retry |
| `STORE_UNAVAILABLE` / WS `server-error` | Redis unavailable or overloaded | Retry |
| `room-not-found` | Wrong/expired code | Ask the host for a new code |
| `room-full` | No free seat | Room is complete |
| `room-started` | Join after the host started | Ask for a new room |
| `room-closed` | Host left, or the room expired | Match ended |
| `bad-code` | Not 6 characters | Correct the code |
| `timeout` | No WS `AUTH_OK` within 20 s | Retry |
| Legacy `no-webrtc` / `ice-failed` / `host-left` / `peer-left` | WebRTC path only | Kept for the legacy screens/tests |

The WebSocket connect timeout is 20 seconds: long enough for a cold serverless
function, short enough that a user is not left staring at a spinner. The legacy
WebRTC path keeps its 20-second data-channel timeout.

---

## 11. Security

- **Transport encryption**: WSS (TLS) protects the party socket; the legacy
  WebRTC path uses DTLS and certificate fingerprints.
- **Authentication**: tokens are 32 random bytes, pattern-validated, issued by
  HTTP create/join and sent in the WS `AUTH` message. They never appear in a
  URL or a log. The Redis room snapshot stores them raw for the room TTL.
- **Input validation**: every inbound message is structurally validated;
  avatars are allowlisted paths; names are bounded; action shapes reject extra
  keys.
- **No secrets in the client**: there is no API key. The Cloudflare TURN token
  stays server-side for the legacy path.
- **Ephemeral persistence**: rooms, signals, profiles, presence, game state and
  peer tokens live in Redis only for the room TTL (30 min active, 10 min
  guest-less) and are deleted afterwards. The Redis credentials stay
  server-side.
- **No logging of payloads**: SDP, tokens and game state are never logged.
- **Trust statement**: the implemented mode is server-authoritative. The
  legacy peer-to-peer mode trusted the host's dice and state; it is not used by
  the UI.

---

## 12. Performance notes

- **Message rate**: a human turn produces a handful of messages per second at
  most; bots are paced at roughly one action per 0.7–1 s.
- **Snapshots**: a few kilobytes each. Sending a full snapshot per action is
  simpler than deltas and comfortably within channel capacity.
- **Signaling volume**: one offer and one answer per guest, plus presence notes.
  The 700 ms poll ends the moment the channel opens.
- **ICE gathering**: bounded at 2.5 s per peer, in parallel with the lobby wait.
- **Backpressure**: sends throw above 1 MB buffered, which surfaces a stuck
  channel instead of growing memory without bound.
- **Polling cost**: each poll is one small request; the server does string
  copies only and never parses game state.

---

## 13. Key modules

| Path | Responsibility |
| --- | --- |
| `lib/party/protocol.ts` | Wire message types, v2, structural validation, size caps |
| `lib/party/transport.ts` | `GameTransport` interface + in-memory test pair |
| `lib/party/session.ts` | Abstract `GameSession` + `SessionSnapshot` |
| `lib/party/authority.ts` | Actor/turn/version/phase validation, versioning, rate limiter |
| `lib/party/webrtc/signaling.ts` | Non-trickle ICE, STUN selection, offer/answer, channel wait |
| `lib/party/webrtc/ice.ts` | Fetches `/api/ice`, validates the list, falls back to STUN |
| `lib/party/webrtc/connection.ts` | Reads the nominated candidate pair (`host`/`srflx`/`relay`) |
| `lib/party/webrtc/peer-connection.ts` | `RTCPeerConnection` → `GameTransport` adapter |
| `lib/party/connection-copy.ts` | Spanish copy for the per-seat connection mode |
| `lib/server/versus/turn.ts` | Server-only Cloudflare TURN credential minting |
| `app/api/ice/route.ts` | `GET /api/ice`; caches credentials, never exposes the API token |
| `lib/party/webrtc/support.ts` | Secure-context + `WebSocket` screening (path retained from the legacy module) |
| `lib/party/websocket/party-socket-transport.ts` | Browser party socket: AUTH, reconnect, heartbeat |
| `lib/party/websocket/messages.ts` | Socket control envelope and auth validation |
| `lib/party/sessions/server-game-session.ts` | Client session over the WS relay, host controls |
| `lib/party/sessions/webrtc-host-session.ts` | Legacy host session: one transport per guest, bots |
| `lib/party/sessions/webrtc-guest-session.ts` | Legacy intent sender, snapshot adopter |
| `lib/party/versus/signaling-client.ts` | HTTP room create/join; legacy signal/poll helpers |
| `lib/party/versus/description.ts` | Legacy SDP JSON codec + validation |
| `lib/party/versus/lobby.ts` | Pure lobby state machine and Spanish copy |
| `lib/server/versus/rooms.ts` | Pure room rules, serialization, tokens, TTLs, caps and the in-memory store (tests) |
| `lib/server/versus/redis-store.ts` | Redis-backed room store: connection singleton, per-room locks, TTLs, party mutations |
| `lib/server/versus/party-state.ts` | Pure authoritative lobby/game/bot state over a room snapshot |
| `lib/server/versus/ws-party.ts` | WS handler, Redis pub/sub, local socket registry, bot timers |
| `app/api/versus/route.ts` | HTTP room allocation + legacy signaling endpoint |
| `app/api/party/socket/route.ts` | Vercel WebSocket upgrade route |
| `scripts/party-ws-server.ts` | Local Bun WebSocket server (`bun run dev:ws`) |

---

## 14. Testing the network layer

- **Protocol**: round-trips for every message type, rejection of wrong
  protocol versions, unknown types, malformed actions, foreign avatars,
  duplicate seats and oversized payloads.
- **Transport**: the in-memory pair validates exactly like the network path, so
  tests cannot construct messages the real transport would reject.
- **Sessions**: multi-peer lobbies, host-only start, bot-filled seats, stale
  versions, rate limits, dropped guests, host disposal.
- **Negotiation**: SDP relayed through the HTTP contract, plus the same match
  over the memory transport and a fake WebRTC transport (identical results).
- **Signaling**: capacity 2/4, seat assignment, targeted delivery, presence,
  full/unknown rooms, malformed server responses, seat reuse (no stale SDP),
  signal pruning, `PEER_GONE` on a departed seat, `ROOM_STARTED` on a late join.
- **Redis store**: a fake Redis client proves rooms and signals are shared
  across store instances, guest-less rooms expire on the injected clock,
  corrupt payloads are treated as missing, and Redis failures return
  `STORE_UNAVAILABLE`.
- **TURN**: credential minting with a fake Cloudflare fetch (valid payload,
  TURN-less STUN entry, HTTP error, network error, malformed payload, TTL
  clamp), and the browser fallback to STUN.
- **Connection mode**: selected candidate pair from fake `getStats()` reports
  (transport report, nominated pair, unknown type, retry while nominating) and
  the host → guest `CONNECTION` broadcast (legacy).
- **Authoritative party state**: host-only start and seat changes, roster and
  empty seats, off-turn/stale action rejection, a bot step, a disconnected
  human being played by the server and reclaiming the seat, host leave, and a
  full room round-trip through serialization.
- **Party socket transport**: fake-WebSocket tests for AUTH, wire delivery,
  close and auth rejection.
- **End-to-end (development):** real HTTP + two `bun run dev:ws` processes
  sharing Redis: create, join, lobby, start, action, reconnect snapshot and
  leave; cross-instance `LOBBY`/`START`/`STATE`/`BYE` through Redis pub/sub.

The committed tests use fakes; the WebSocket path was also exercised with two
real server processes and the real Redis instance during development.

---

## 15. Open questions and future work

- **TURN (legacy)**: the Cloudflare Realtime TURN route remains for the old
  WebRTC path; the UI no longer uses it.
- **WebSocket mode**: implemented with `upgradeWebSocket()` from
  `@vercel/functions`, Redis state, Redis pub/sub and automatic reconnection.
- **Rate limiting**: authenticated actions are validated for actor, turn,
  version and phase but are not rate-limited; a Redis-backed limiter is the
  natural next step.
- **Host migration**: not implemented. An intentional host leave closes the
  room; a host whose socket drops is played by the server and can reconnect.
- **Reconnection**: clients reconnect automatically and receive the full
  snapshot. There is no grace period before a disconnected seat is automated.
- **Scale**: rooms are shared through one Redis instance, so the WS route is
  horizontally scalable through pub/sub. Per-instance Redis connections and the
  free tier's connection limit remain the practical ceiling.
