# Online 1v1 (WebRTC gameplay, HTTP signaling) — completion summary

## What was built

The homepage entry that used to start a **"Jugar 1 contra 1 en la misma red"**
session at `/lan` (manual QR / copy-paste pairing) is now **"Jugar 1 contra 1"**
and leads to `/versus`. Pairing is automatic:

1. The host presses **Crear partida**. The app asks the signaling server for a
   six-character room code, creates the `RTCPeerConnection` and data channel,
   publishes the WebRTC offer and waits.
2. The guest presses **Unirse a una partida**, types the code and joins. The
   guest receives the offer, answers, and both peers connect.
3. From then on, the game is peer-to-peer over one ordered, reliable
   `RTCDataChannel` (`parchis-v1`). The server never sees, stores or relays game
   state — only the two SDP strings and presence.

There is no TURN server and no fallback: if a direct connection cannot be made
(symmetric NAT, restrictive firewall, client isolation), the screen shows a
Spanish failure with a retry. No intermediate data server is silently used.

## Files

### Created

| File | Purpose |
| --- | --- |
| `lib/server/versus/rooms.ts` | Server-only in-memory signaling store. `createVersusServer({ now, newRoomCode })` is testable; `getVersusServer()` is the `globalThis.__versusRooms` singleton the route uses. Rooms store peers, tokens, ordered signals and presence. Codes are 6 chars from `A–Z`/`2–9` minus ambiguous glyphs. Caps: 20,000 chars per SDP payload, 32 signals per room; TTLs: 30 min of activity with a guest, and 10 min after creation for a room nobody joined (host polling does not extend it). A host `leave`/`bye` closes the room; a guest leave frees the seat. Payloads are never logged. |
| `lib/server/versus/rooms.test.ts` | Store tests: create/normalize/join, unknown codes, bad tokens, one offer/answer each way, own signals never echoed, size and volume caps, host leave closes, guest leave frees, fake-clock expiry, including a host who polls forever without a guest. |
| `app/api/versus/route.ts` | One route handler. `POST { action }` = `create` \| `join` \| `signal` \| `leave`; `GET ?code=&id=&since=` polls with an `Authorization: Bearer` token. Validates codes (`/^[A-Z0-9]{4,8}$/`), 64-hex tokens, body size (32 KB) and payload size. Maps store errors to `404`/`409`/`401`/`400`/`413`; every response is `Cache-Control: no-store`. |
| `lib/party/versus/signaling-client.ts` | Browser client: `createVersusRoom`, `joinVersusRoom`, and `VersusSignalingClient` (`send`, `poll` with a tracked `seq` cursor, `leave`, 700 ms poll interval). Validates every response structurally and maps failures to `room-not-found`, `room-full`, `room-closed`, `unauthorized`, `bad-request`, `server-error`, `network`. |
| `lib/party/versus/signaling-client.test.ts` | Client tests against an in-memory fetch implementing the HTTP contract: create/join, full/unknown room, offer/answer relay, own-signal filtering, network failure, malformed response. |
| `lib/party/versus/description.ts` | Tiny JSON codec + structural validator for `{ kind: "offer" \| "answer", id, sdp }`, capped at the server's 20,000 chars. Peer input is untrusted, so nothing reaches `RTCPeerConnection` unvalidated. |
| `lib/party/versus/pairing.ts` | Pure UI reducer and Spanish copy for `choosing → creating/host-lobby` or `guest-form → joining → negotiating → connecting → connected \| failed`, `VERSUS_FAILURE_COPY`, `describeVersus`, `isVersusFailure`. |
| `lib/party/versus/pairing.test.ts` | Reducer transitions, sticky `connected`, idempotent presence, failure copy coverage, description copy. |
| `lib/party/versus/use-versus-session.ts` | `"use client"` hook owning the signaling client, `RTCPeerConnection`, transport and `WebRTCHostSession`/`WebRTCGuestSession`. Handles host offer/poll, guest join with up to 3 retries while the room propagates, offer → answer → data channel → session, 20 s connect timeout, `host-left`/`peer-left` on `bye`/closed rooms, retry and abort teardown. |
| `lib/party/sessions/versus-negotiation.test.ts` | Relays the offer/answer through the HTTP contract and decodes them with `decodeDescription` (including rejecting tampered payloads); separately runs both sessions over `createMemoryTransportPair`, proving the sessions are signaling-agnostic. |
| `app/versus/page.tsx` | Dynamic client-only page mounting `VersusClient`, with Spanish loading copy. |
| `components/versus/versus-client.tsx` | Support guard, role cards (**Crear partida** / **Unirse a una partida**), name + `AvatarPicker` fields, room-code card, join form (uppercase 6-char input, disabled until complete), live status badge, failure/retry, and the Spanish hint that no intermediate data servers are used. All buttons carry `select-none`. |
| `components/versus/room-code.tsx` | Shows and copies the six-character code (`select-all`), with a `······` placeholder while it is being created. |
| `components/versus/versus-game-screen.tsx` | Reuses `GameStage` with `remoteHuman`; mode label **1 contra 1 · anfitrión/invitado**, dice tumble echo, slow-connection banner, Spanish errors and `onExit`. |
| `lib/server/versus/rooms.test.ts`, `lib/party/versus/*.test.ts` | See above. |

### Changed

| File | Change |
| --- | --- |
| `app/page.tsx` | Homepage card is now **Jugar 1 contra 1**, copy explains the shared code and the direct connection, and it posts to `/versus`. |
| `app/offline/page.tsx` | Removed the `/lan` button; copy now says local play works offline while 1v1 needs internet for pairing. |
| `lib/party/webrtc/signaling.ts` | Removed the `fflate` pairing codec (`encodePairing`/`decodePairing`/`splitPairing`/`joinPairingParts`/`measurePairing`). Kept `selectIceServers`, `waitForIceGathering`, `createHostOffer`, `acceptHostOffer`, `acceptHostAnswer`, `waitForDataChannel` and `mapConnectionState`. |
| `lib/party/webrtc/signaling.test.ts` | Rewritten for the surviving helpers (ICE gathering, channel-before-offer ordering, duplicate answers ignored, ICE server selection, state mapping). |
| `lib/party/webrtc/support.ts` | Dropped the unused `LanRole` import and `LAN_ROLE_LABEL`; the "PWA instalada" copy now reads "la app instalada". |
| `components/lan/roster.ts` | Added the `LanProfileDraft` type used by the versus form (the colour/roster helpers are reused by `/versus`). |
| `scripts/generate-service-worker.mjs`, `scripts/service-worker-template.js` | `/lan` replaced by `/versus` in the required and precached route lists. |
| `next.config.ts` | The Tauri export build now sets `pageExtensions: ["tsx", "jsx", "js"]`, which keeps `app/api/versus/route.ts` (a `.ts` file) out of the static desktop export. Every page is a `.tsx` file, so no route is lost. |
| `package.json` / `bun.lock` | Removed the now-unused `fflate`, `jsqr` and `qrcode.react` dependencies. |

### Deleted

| File | Reason |
| --- | --- |
| `app/lan/page.tsx` | Replaced by `/versus`. |
| `components/lan/lan-client.tsx` | Manual pairing UI replaced by `VersusClient`. |
| `components/lan/lan-game-screen.tsx` | Replaced by `VersusGameScreen` (same `GameStage` wiring). |
| `components/lan/pairing-code-box.tsx` | No more copy/paste pairing. |
| `components/lan/qr-code.tsx` | No more QR pairing. |
| `components/lan/camera-scanner.tsx` | No more camera scanning. |
| `components/lan/connection-status.tsx` | Status text is now `describeVersus` in `VersusClient`. |
| `lib/party/lan/use-lan-session.ts` | Replaced by `useVersusSession`. |
| `lib/party/webrtc/encoding.ts`, `encoding.test.ts` | `fflate` pairing codec, no longer needed. |
| `lib/party/webrtc/pairing.ts`, `pairing.test.ts` | Part-based manual pairing codec, no longer needed. |

## Verification

| Command | Result |
| --- | --- |
| `bun test` | **175 pass, 0 fail**, 5,258 assertions across 19 files. |
| `bunx tsc --noEmit -p tsconfig.json` | Clean. |
| `bun run build` (web, `cacheComponents` + PWA) | Success; route table lists `ƒ /api/versus` next to the static pages; worker generated with **105 precache entries** (~60.7 MiB). |
| `TAURI_BUILD=1 bunx next build` (static desktop export) | Success; no `/api/versus` in the export and `out/index.html` + `out/versus/index.html` are produced. |

Not verified: an end-to-end two-device WebRTC connection in a real browser. The
negotiation is covered by unit tests with fake peers and by the HTTP-contract
relay test, but ICE/host-candidate behaviour across real NATs has not been
exercised in this environment.

## Deviations, limits and follow-ups

- **Single-process store.** `lib/server/versus/rooms.ts` is in-memory and needs
  one long-lived Node process. A serverless/multi-instance deployment would need
  an external store (for example Redis). The web build is therefore a plain
  `next start` deployment.
- **No TURN.** That is intentional (the brief asked for no extra setup). Some
  networks will fail to connect; the UI reports it clearly and never falls back.
- **No native IP privacy workaround.** Chrome's mDNS host candidates may block
  LAN-only peers; STUN is used only when online, matching the previous mode.
- **Desktop build.** The Tauri export has no signaling server. `/versus` is
  still reachable, but creating a room fails with the Spanish
  "servidor no disponible" message; the offline page no longer offers it.
- **Rename left in place.** `components/lan/roster.ts`, `lib/party/lan-colors.ts`
  and `getLanSupport`/`LAN_SUPPORT_COPY` keep their "lan" names because they are
  shared concepts (host/guest colours and WebRTC support), not routes. Renaming
  them would add churn without behavior change.
- **Task 07 remains open.** This is still not the WS-signaled `/versus/[code]`
  design from `tasks/07-p2p-webrtc.md`.
