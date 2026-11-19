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
| Transport of gameplay | WebRTC `RTCDataChannel` over SCTP/DTLS/UDP | Carries every game message between peers |
| Signaling | Plain HTTP long-poll (`POST`/`GET /api/versus`) | Relays SDP descriptions and presence so peers can find each other |
| Alternative: server-authoritative | WebSocket (planned, not implemented) | Central game loop; clients send intents, server broadcasts state |
| NAT traversal | ICE + STUN + Cloudflare TURN | Discovers a usable path; TURN relays when direct/STUN fails |
| Identity | 6-character room code + 64-hex per-peer token | Room lookup and per-peer authentication |

The implemented architecture is **peer-to-peer with a host-authoritative
session**. The server is deliberately not in the gameplay path: it only
relays a few kilobytes of SDP during pairing and then goes silent.

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

## 9. WebSocket and the server-authoritative alternative

The current design is client-authoritative *among peers*. A central
server-authoritative design is the natural alternative and is planned as a
separate route. This section maps the concepts so both can be reasoned about
together.

### 9.1 What changes

| Concern | Peer-to-peer (implemented) | Server-authoritative (planned) |
| --- | --- | --- |
| Connection | WebRTC data channel per guest | One WebSocket per client |
| Who owns state | Host peer | Server process |
| Who rolls dice | Host peer (crypto) | Server (crypto) |
| Trust boundary | Host trusts nobody; guests trust host | Server trusts nobody |
| Discovery | HTTP signaling + room code | Room code → join endpoint |
| Latency path | peer → peer | peer → server → peers |
| NAT problem | Hard (ICE/STUN) | None (outbound WS to a server) |
| Failure mode | Connection may be impossible | Server down / socket drop |
| Cost | No server in gameplay | Server bandwidth + process |

WebSockets avoid the whole NAT chapter: both clients make an outbound
connection to one public server, which is exactly the direction NAT permits.
The price is that every action takes two hops and the server becomes
stateful and must scale.

### 9.2 Same protocol, different transport

The wire messages (`HELLO`, `ACTION`, `LOBBY`, `START`, `STATE`, `ERROR`,
`BYE`) are already transport-agnostic. The abstraction is `GameTransport`:

```ts
interface GameTransport {
  readonly kind: "memory" | "webrtc";
  readonly status: "idle" | "connecting" | "open" | "closed" | "failed";
  connect(): Promise<void>;
  send(message: WireMessage): void;
  subscribe(listener: (message: WireMessage) => void): () => void;
  subscribeStatus(listener: (status: TransportStatus) => void): () => void;
  close(): void;
}
```

A `WebSocketGameSession` would implement the same `GameSession` surface
(`start`, `roll`, `move`, `bonusMove`, subscribe, dispose). The UI never knows
which transport is underneath; a test already runs the same match over an
in-memory transport and a fake WebRTC transport and asserts identical results.

### 9.3 What the server must do

A server-authoritative loop needs:

1. **Authentication**: a per-player token issued at join, hashed at rest,
   sent in an auth message (never in a URL).
2. **Validation**: the same actor → turn → version → phase → legality chain,
   now on the server.
3. **Dice**: cryptographic randomness server-side.
4. **Broadcast**: one authoritative snapshot per accepted action, ordered.
5. **Lifecycle**: reconnect via token, one socket per player, replacement
   semantics, room expiry.
6. **Scale**: the in-memory store is single-instance. Horizontal scaling needs
   an external store or a pub/sub bus, and sticky routing.

### 9.4 Why WebSocket is *not* used for signaling today

Next.js route handlers cannot perform an HTTP upgrade on their own. Vercel
Functions now expose `upgradeWebSocket()` from `@vercel/functions` (with `ws`),
so a route handler can host sockets in production. That path still has three
costs for this app:

- a connection is pinned to one function instance, and players of a room may
  land on different instances, so rooms need an external store (Redis) for
  presence and routing;
- connections close at the function's maximum duration (300 s on Hobby, 800 s
  on Pro), so every client needs reconnect logic mid-match;
- local development requires `vc dev` rather than `next dev`.

TURN solves the same underlying problem (a peer that cannot be reached
directly) without moving gameplay to the server: the data channel and the
host-authoritative session stay exactly the same, and the relay is transparent
to the protocol. That is why this revision uses Cloudflare TURN instead of a
WebSocket relay. A server-authoritative WebSocket mode remains possible later
and would reuse `GameTransport`/`GameSession`.

---

## 10. Failure taxonomy

Every networking failure maps to one user-visible Spanish message. None of them
silently degrades into another mode.

| Failure | Cause | UX |
| --- | --- | --- |
| `insecure-context` | Not HTTPS and not installed | Explains secure-context requirement |
| `no-webrtc` | No `RTCPeerConnection` | Suggests an updated browser |
| `offline` | `navigator.onLine === false` | Asks for a connection |
| `server-unreachable` | Signaling fetch fails | Retry |
| `room-not-found` | Wrong/expired code | Ask the host for a new code |
| `room-full` | No free seat | Room is complete |
| `room-closed` | Host left | Match ended |
| `bad-code` | Not 6 characters | Correct the code |
| `ice-failed` | No working candidate pair, including TURN (blocked network, TURN unreachable) | Explains that some networks block direct and relayed connections |
| `timeout` | 20 s without a data channel | Retry |
| `host-left` | Host disconnected | Match ended |
| `peer-left` | A guest disconnected | Play continues with the host controlling the seat |

The `timeout` is 20 seconds: long enough for slow ICE gathering on mobile,
short enough that a user is not left staring at a spinner.

---

## 11. Security

- **Transport encryption**: DTLS provides encryption and certificate
  fingerprints authenticate the far end.
- **Signaling**: tokens authenticate every POST/GET. Tokens are 32 random
  bytes, pattern-validated, sent in headers or bodies, never in URLs or logs.
- **Input validation**: every inbound message is structurally validated;
  avatars are allowlisted paths; names are bounded; action shapes reject extra
  keys.
- **No secrets in the client**: there is no API key. The signaling server
  stores no credentials beyond the ephemeral room.
- **Ephemeral persistence**: rooms, relayed signals and peer tokens live in
  Redis only for the room TTL (30 min active, 10 min guest-less) and are
  deleted afterwards. Game state never reaches the server, and the Redis
  credentials stay server-side.
- **No logging of payloads**: SDP, tokens and game state are never logged.
- **Trust statement**: guests trust the host's dice and state. Do not use this
  mode for competitive or ranked play without an authoritative server.

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
| `lib/party/webrtc/support.ts` | Secure-context and API screening |
| `lib/party/sessions/webrtc-host-session.ts` | Authoritative host: one transport per guest, bots |
| `lib/party/sessions/webrtc-guest-session.ts` | Intent sender, snapshot adopter |
| `lib/party/versus/signaling-client.ts` | Capacity, targeted signals, presence, polling |
| `lib/party/versus/description.ts` | SDP JSON codec + validation |
| `lib/party/versus/lobby.ts` | Pure lobby state machine and Spanish copy |
| `lib/server/versus/rooms.ts` | Pure room rules, serialization, tokens, TTLs, caps and the in-memory store (tests) |
| `lib/server/versus/redis-store.ts` | Redis-backed room store used by the route: connection singleton, per-room locks, TTLs |
| `app/api/versus/route.ts` | HTTP signaling endpoint |

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
  the host → guest `CONNECTION` broadcast.

No test opens a real peer connection to a remote host; the structural fakes
prove the logic, and browser checks prove the wiring.

---

## 15. Open questions and future work

- **TURN**: implemented through Cloudflare Realtime with short-lived,
  server-minted credentials. The remaining cost is Cloudflare bandwidth when a
  match is relayed; the UI shows when that happens.
- **WebSocket signaling**: an alternative once a custom Node server exists.
  It would remove polling but not change ICE or the session layer.
- **Server-authoritative mode**: planned; the transport and session
  abstractions already allow it without touching `GameStage`.
- **Host migration**: not implemented. If the host leaves, the room closes.
- **Reconnection**: a guest that drops mid-match is played by the host; it
  cannot currently rejoin.
- **Scale**: rooms are shared through one Redis instance, so the signaling
  route is horizontally scalable. Per-instance Redis connections and the free
  tier's connection limit remain the practical ceiling.
