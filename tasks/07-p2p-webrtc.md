# Task 07 — P2P 1v1 mode (WebRTC) + transport-agnostic session layer

**Do not take this task unless Tasks 01–06 are complete (including their `results/` summaries); read `AGENTS.md` before making any changes, and read and update `architecture.md` after making changes so the architecture is always current.**

## Prerequisite gate

This task is intentionally last. Start it only when all of the following are true:

- Tasks 01, 02, 03, 04, 05, and 06 are complete and accepted.
- `results/01-homepage.md` through `results/06-bot-mode.md` exist.
- Task 04's `GameTransport` / `GameSession` abstraction and shared `lib/party/authority.ts` exist.
- Task 06's reusable PixiJS `GameStage` exists.
- The 1v1 flow can reuse the existing party codes, tokens, presence, and offline shell.

If any prerequisite is missing, stop and report what is incomplete. Do not create a parallel transport, a second engine, or a second game board to work around it.

## Outcome

Add a **1v1 online mode** where two players connect **peer-to-peer over WebRTC**: the host is authoritative, the guest sends actions, and gameplay travels over a reliable `RTCDataChannel`. The existing WebSocket server is used only for **signaling and presence**, never for game actions. The UI must use the **same `GameSession` method calls** whether the match is server/WebSocket-based or P2P/WebRTC-based.

## Architecture

```
Host browser ───── WSS /api/ws (signaling + presence only) ───── Guest browser
      │                                                              │
      └──────────── RTCDataChannel (game messages, host-authoritative) ────────┘
```

- **Signaling:** existing authenticated WebSocket from Task 04 relays SDP offers/answers and ICE candidates between the two room players. It also provides presence (`PARTY_UPDATE`) and reconnect signaling.
- **Gameplay:** all `START`, `STATE`, `ACTION`, `ERROR` messages travel over the WebRTC data channel. No game actions over the WebSocket.
- **Authority:** the **host peer** owns the engine state, dice rolls, versions, and validation. The guest only sends actions and adopts authoritative snapshots. This mirrors Task 04's server model; reuse `lib/party/authority.ts` so behavior is identical.
- **Session abstraction:** the UI depends only on `GameSession` (Task 04). `WebRTCPeerHostSession` and `WebRTCPeerGuestSession` extend it; the WebSocket session remains unchanged. `createGameSession(...)` picks the implementation from the room mode/transport.
- **Rules:** two-player Parchís from `lib/parchis`; host = red/seat 0, guest = yellow/seat 1. The engine already supports 2 players.
- **Trust model:** the guest trusts the host's state and dice. This is a casual, unranked mode; there is no anti-cheat. State that clearly in the UI/report. Do not use it for competitive play.

## Room and signaling

Reuse the Task 04 party layer, extended with a room mode:

- `mode: "server" | "p2p-1v1"` on the room; default `"server"`.
- `POST /api/parties` accepts an optional `mode`; `"p2p-1v1"` creates a max-2-player room.
- `POST /api/parties/[code]/join` enforces the mode's capacity (2 for P2P) and returns the same token/session shape.
- `GET /api/parties/[code]` includes `mode` and `maxPlayers`.
- Room codes, tokens, rate limits, origin checks, cleanup, and presence stay the same.
- For P2P rooms, the WebSocket server **must reject game actions** (`ROLL`, `MOVE`, `BONUS_MOVE`, `START`) with `WRONG_TRANSPORT`; it only accepts signaling/presence messages.

### Signaling messages (WebSocket)

Extend the Task 04 protocol with a dedicated signaling namespace, only valid for authenticated players in a `p2p-1v1` room:

```ts
{ type: "SIGNAL", kind: "offer" | "answer" | "ice", payload: unknown, to?: string }
```

- Relay only to the other player in the same room. Never broadcast, persist, or log SDP/ICE contents.
- Validate shape, room mode, sender identity, target, and payload size. ICE messages are small; SDP can be a few KB. Raise the WS `maxPayload` to at least 64 KB or enforce a per-message cap without blocking normal Task 04 messages.
- If the peer is not connected, return `ERROR PEER_UNAVAILABLE`; the client retries after `PARTY_UPDATE` shows presence.
- Provide explicit presence for the lobby: `PARTY_UPDATE` is enough; add `PEER_JOINED`/`PEER_LEFT` only if it keeps the client simpler.
- Keep the signaling socket open for the whole match. If it drops while the data channel is healthy, gameplay continues; reconnect for signaling/presence.

### ICE servers

Add an authenticated endpoint:

```
GET /api/p2p/ice-servers   Authorization: Bearer <playerToken>
```

- Returns `{ iceServers: RTCIceServer[] }`.
- Read a JSON `P2P_ICE_SERVERS` env var; default to a public STUN list for development.
- TURN is required for some NAT/firewall combinations. Use ephemeral TURN credentials from the server; never commit long-lived credentials. Document how to configure TURN.
- If no TURN is configured, surface a clear failure message; do not silently claim P2P works on every network.

## WebRTC negotiation

Use the browser APIs directly; no WebRTC wrapper dependency is required. Keep the peer logic in `lib/party/webrtc/`.

1. Both players AUTH to the WS signaling room. Wait until both are present.
2. Host creates an `RTCPeerConnection` with the ICE servers, creates a **reliable, ordered** data channel named `parchis`, creates an offer, and sends `SIGNAL offer`.
3. Guest sets the remote description, creates an answer, and sends `SIGNAL answer`.
4. Both trickle ICE candidates through `SIGNAL ice`; buffer remote candidates received before `setRemoteDescription` and flush them afterward.
5. On `datachannel`/`open`, both peers send `HELLO { protocol: 1, playerId, role }`.
6. When the host has both its own data channel open and the guest's `HELLO`, it creates the engine game and sends `START` with the initial state + version.
7. Guest waits for `START`; it must not create game state, roll dice, or apply actions locally as the authority.
8. Handle `connectionState`/`iceConnectionState` changes: expose `connecting | connected | disconnected | reconnecting | failed | closed` to the session/UI.
9. On a recoverable failure, the host attempts an ICE restart (`restartIce()` / a new offer) with a bounded retry/backoff. If it fails, surface an error; do **not** silently fall back to WebSocket gameplay.

Requirements:

- Fixed roles (host offers, guest answers); no perfect-negotiation glare handling is required, but ignore duplicate/out-of-order signaling messages gracefully.
- Secure context required: WebRTC works on `localhost` and HTTPS; production is WSS/HTTPS.
- No TURN credentials or SDP/ICE payloads in logs, analytics, or storage.
- Data channel messages are DTLS-encrypted by WebRTC; keep the signaling socket on WSS in production.

## Data channel protocol (host-authoritative)

Reuse the Task 04 wire types where possible; keep signaling and gameplay message namespaces separate.

Host → guest:

```ts
{ type: "START", protocol: 1, state: GameState, version: number }
{ type: "STATE", state: GameState, events: GameEvent[], version: number }
{ type: "ERROR", code: string, message: string, version?: number, state?: GameState }
```

Guest → host:

```ts
{ type: "HELLO", protocol: 1, playerId: string, role: "guest" }
{ type: "ACTION", version: number, action: ClientAction, requestId?: string }
```

- `ClientAction` is the same union used by Task 04: `ROLL`, `MOVE`, `BONUS_MOVE`. There is no client `PASS`; the host auto-passes when a roll has no legal moves, via the shared authority.
- Host validates: message shape, protocol, sender is the guest, current player, version, phase, and legal action. Apply through `lib/party/authority.ts`; increment version; broadcast `STATE` with the engine events to the guest and update the host UI.
- Host's own actions go through the same authority and broadcast to the guest. Both sides use `GameSession` methods, but only the host runs the authority.
- Dice are rolled **only by the host** with `crypto.getRandomValues`; the die value is never accepted from the guest. The authority receives the value.
- Guest validation: accept `STATE`/`START` only with a protocol match and a non-decreasing version; replace local state with the snapshot. Reject malformed messages and ignore stale/duplicate snapshots. On a version gap or error with state, resync from the included snapshot.
- Rate-limit guest actions at the host (e.g. 10/s); ignore/deny excess with `ERROR RATE_LIMITED`.
- On win, host sets the finished state; both sides show the same winner. No rematch in this task.
- Cap data-channel message size; state snapshots are small. Do not send huge logs.

## Shared session/transport layer (the key requirement)

The UI and `GameStage` must not know which transport is in use. Enforce this:

- `GameSession` (Task 04 abstract class) remains the only API used by pages/components:
  - `playerId`, `transport`, `state`, `party`
  - `start()`, `roll()`, `move(move)`, `bonusMove(move)`
  - `subscribe(listener)`, `dispose()`
- Add `WebRTCPeerTransport implements GameTransport`:
  - `kind = "webrtc"`, `state`, `connect()`, `close()`, `send(WireMessage)`, `onMessage`, `onStateChange`.
  - Owns the `RTCPeerConnection` + data channel and uses the Task 04 party socket/signaling for SDP/ICE.
  - Allow injecting `RTCPeerConnection`/`RTCDataChannel` factories for tests.
- Add `WebRTCPeerHostSession extends GameSession`:
  - Owns the authoritative `GameState`, version, and dice.
  - `start()` creates the game once the peer is ready; `roll/move/bonusMove` apply locally via `authority.ts` and broadcast.
  - Handles guest `ACTION` messages with validation and broadcast.
- Add `WebRTCPeerGuestSession extends GameSession`:
  - `start()` is invalid/no-op (or throws); `roll/move/bonusMove` send `ACTION` to the host with the current version.
  - Applies `START`/`STATE` snapshots; exposes the same getters/events.
- Extend `createGameSession(...)` to return the WebRTC host or guest implementation based on the room mode and role. Existing WebSocket callers are unchanged.
- If Task 04's abstraction is missing or incomplete, fix it here rather than adding a parallel API; keep `lib/party/authority.ts` shared and browser-safe.
- Tests must prove transport independence: the same UI-facing calls (`roll`, `move`, `bonusMove`, subscription) drive a full game through both a mock WebSocket transport and a paired in-memory WebRTC transport, producing identical engine events/state for the same inputs.

## 1v1 UI

Reuse Task 06's `GameStage`; do not create another board.

- New route: `app/versus/[code]/page.tsx`.
- Homepage:
  - Add a drawably "Jugar 1 contra 1" action that creates a `mode: "p2p-1v1"` room and navigates to `/versus/[code]`.
  - The existing party-code join input must route P2P rooms to `/versus/[code]` based on `party.mode`; do not break server-mode joining.
  - Helper text in Spanish: "Conexión directa entre jugadores. Necesita internet."
- Lobby:
  - Drawably card with the room code, a copy-code action, your role/colour (Anfitrión/rojo vs Invitado/amarillo), peer presence, and connection status.
  - Host: "Empezar partida" enabled once the data channel is open and the guest is ready. Guest: "Esperando al anfitrión…".
  - Statuses in Spanish: "Esperando al otro jugador…", "Conectando…", "Conectado", "Reconectando…", "No se pudo conectar", "El anfitrión se ha desconectado".
  - Retry action for failed ICE/negotiation; do not auto-fallback to server gameplay.
- Game: mount `GameStage` with the session's state, human player ID, legal moves from the engine, and the same action callbacks as bot/online modes. Keep the drawably header/back, game-over card, instructions, `select-none`, and Spanish copy.
- Accessibility: reuse Task 06's keyboard/ARIA controls; the transport change must not regress them.
- Game over: show the winner and "Volver al inicio". Rematch is out of scope.

## Connection lifecycle

- **WS signaling drops, data channel healthy:** gameplay continues; reconnect the signaling socket in the background, re-AUTH, and restore presence/signaling. No game interruption.
- **Data channel drops:** pause input; host attempts ICE restart with a bounded retry. If it recovers, host sends a full `STATE` snapshot. If it fails after the grace period, show "Conexión perdida" with retry/exit.
- **Guest leaves:** host keeps the authoritative state for a grace period (e.g. 60 s) and allows the guest to reconnect through signaling; if not, return to the lobby/ended state.
- **Host leaves or reloads:** no host migration. The guest sees "El anfitrión se ha desconectado"; the match ends. Host state is not persisted across a full reload in this task; document that limitation.
- **Room cleanup:** reuse Task 04's in-memory cleanup. P2P rooms persist while active and expire per the existing TTL rules.
- **No fallback:** never silently switch to server-authoritative WebSocket gameplay if P2P fails. The user can go back and choose the online mode explicitly.

## Security and privacy

- Signaling uses the same authenticated session tokens as Task 04; relay only within the room to the other player. Reject unknown rooms, spectators, and third players.
- Validate every signaling and data-channel message; cap sizes; rate-limit actions; never evaluate or inject peer strings.
- Do not log or persist SDP, ICE candidates, tokens, or game traffic. Log metadata only (room code, event type, connection state).
- TURN credentials, if used, are ephemeral and server-issued; no secrets in the client bundle or repo.
- Origin checks and WSS remain required in production.
- Host-authoritative trust is explicit: the host can cheat. Do not present this mode as ranked or anti-cheat-protected.

## Files

Suggested layout; reuse existing modules where possible:

```
lib/party/transport.ts              (Task 04; extend if needed)
lib/party/session.ts                (Task 04 abstract GameSession)
lib/party/sessions/websocket-session.ts
lib/party/sessions/webrtc-host-session.ts
lib/party/sessions/webrtc-guest-session.ts
lib/party/webrtc/peer-transport.ts
lib/party/webrtc/signaling.ts
lib/party/webrtc/ice.ts
lib/party/session-factory.ts        (extend)
lib/party/authority.ts              (Task 04 shared authority; reuse)
lib/server/party/signaling.ts       (relay + validation)
lib/server/party/ws.ts              (extend for SIGNAL; reject game actions in P2P)
app/api/parties/route.ts            (mode support)
app/api/parties/[code]/join/route.ts
app/api/p2p/ice-servers/route.ts
app/versus/[code]/page.tsx
components/versus/...               (lobby/connection chrome; drawably)
app/page.tsx                        (1v1 entry)
```

Do not duplicate `GameStage`, the engine, or the Task 04 session API.

## Testing

Automated (`bun test`, no native/WebRTC test dependency required):

- Signaling relay: two authenticated P2P clients; offers/answers/ICE reach only the peer; wrong room/mode/third player rejected; payload limits; P2P rooms reject game actions over WS.
- Peer transport: inject fake `RTCPeerConnection`/`RTCDataChannel`; test offer/answer ordering, ICE buffering, open/close, ICE restart, duplicate signaling, and state transitions.
- Sessions: paired in-memory transports drive a complete 1v1 game through `GameSession`; guest actions validated/rejected correctly; dice host-only; versioning/stale handling; auto-pass, bonuses, exact goal, win.
- Transport independence: the same sequence through the WebSocket mock and the WebRTC paired transport produces identical state/events via the shared authority.
- Regression: Task 04 WS tests, Task 03 engine tests, Task 06 controller/bot tests still pass.
- `bun run lint`, `bunx tsc --noEmit`.

Manual:

- Two browsers/tabs on localhost: create P2P room, join, negotiate, start, play a full game.
- Two devices on the same network and, if possible, different networks with STUN; test with TURN configured.
- Deny/inspect network: confirm gameplay traffic is on the data channel, not `/api/ws`; signaling is WSS in production.
- WS drop during play (gameplay continues) and data-channel drop/reconnect.
- Guest leaves/rejoins within the grace period; host leaves/reloads; failures show Spanish messages.
- Mobile layout, keyboard/screen-reader controls, reduced motion.
- Online (WebSocket) mode still works and uses the same `GameSession` calls; offline bot mode still works.

## Acceptance criteria

- A 1v1 P2P match works end to end: create/join room, signaling, WebRTC data channel, host-authoritative play, winner.
- Gameplay messages use WebRTC only; the WebSocket server handles signaling/presence and rejects P2P game actions.
- The UI/`GameStage` depends only on `GameSession`; WebSocket and WebRTC sessions expose identical method calls, and a mock transport proves it.
- The host uses the shared `authority.ts`; guest actions are validated; only the host rolls dice; versions/stale handling match Task 04.
- Two-player rules (red host vs yellow guest) are correct via the existing engine.
- ICE server configuration works, TURN failures are clear, and no secrets are exposed.
- Reconnection/lifecycle behavior matches the rules above; no silent fallback to WebSocket gameplay.
- Spanish UI copy, drawably chrome, Pixi game rendering, and accessibility are preserved.
- No regressions in Tasks 01–06; `lint`, `tsc`, and `bun test` pass.
- `architecture.md` is updated.

## Out of scope

- 3- or 4-player P2P mesh, spectators, relays, host migration.
- Server-authoritative fallback for P2P, matchmaking, ranked play, anti-cheat.
- Rematches, tournaments, persistence across a full page reload, or resuming a match after the host reloads.
- Voice/video/chat, TURN server provisioning (configuration only), native apps.
- Offline P2P: WebRTC requires network connectivity; offline play stays in Task 06's bot mode.
- Bot opponents in the 1v1 room.

## Definition of done

- Update `architecture.md` with: the P2P signaling-only WebSocket role, host-authoritative data-channel protocol, transport/session abstraction and factory, ICE/TURN configuration, 1v1 room mode, `/versus/[code]`, lifecycle/reconnect rules, trust model, and single-process/room limitations.
- Write `results/07-p2p-webrtc.md` per `AGENTS.md`, including files, rationale, commands/tests, manual two-peer test results, deviations, and the explicit trust/no-fallback limitations.
