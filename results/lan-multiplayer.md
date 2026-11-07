# LAN 1v1 multiplayer (WebRTC, no server) — completion summary

## What was built

Two people on the same local network can play each other 1v1 in Parchís with no
server, no API route, no WebSocket and no internet. Pairing is manual: the host
shows a code/QR, the guest pastes or scans it, and the guest's answer comes back
the same way. Everything then runs peer-to-peer over one reliable, ordered
`RTCDataChannel`; the host is authoritative.

`/lan` is reachable from the homepage card **"Jugar 1 contra 1 en la misma red"**
and from the offline page. The route is precached, so an installed PWA can pair
and play with the WAN down.

This supersedes `tasks/07-p2p-webrtc.md` for this feature. That brief requires a
WebSocket signaling server, `/versus/[code]` and `/api/p2p/*`, none of which
exist here; the owner explicitly discarded the Tauri idea and accepted a manual
signaling step instead. Task 07 as written remains unimplemented.

## Files

### Created

| File | Purpose |
| --- | --- |
| `lib/party/protocol.ts` | Wire message types and `decodeWireMessage`: structural validation only, no evaluation; strings ≤24 chars, `/pictures/*` avatar allowlist, `MOVE` must be `ADVANCE` with an integer destination, 64 KB cap. |
| `lib/party/errors.ts` | `PartyErrorCode` catalogue shared by both sessions. |
| `lib/party/authority.ts` | Pure action application: actor → turn → version → phase → engine, inside `try`; `crypto.getRandomValues` dice with rejection sampling; `extractEvents`; `createRateLimiter`. |
| `lib/party/transport.ts` | `GameTransport` interface, bounded 32-message outbound queue, and `createMemoryTransportPair()` for deterministic tests. |
| `lib/party/session.ts` | Abstract `GameSession`/`SessionSnapshot` — the only game API the UI uses. |
| `lib/party/lan-colors.ts` | Shared LAN engine colours (host `yellow`, guest `green`) so sessions and the UI roster cannot drift. |
| `lib/party/webrtc/types.ts` | Structural `PeerConnectionLike`/`DataChannelLike`; lazy `defaultPeerConnectionFactory()` returns `null` when WebRTC is absent, keeping SSR and Bun tests off the browser API. |
| `lib/party/webrtc/encoding.ts` | Hand-rolled base64url, FNV-1a, and `fflate` deflate/inflate with a 16 KB decompressed-size guard. |
| `lib/party/webrtc/signaling.ts` | Offer/answer creation, non-trickle `waitForIceGathering` (complete / end-of-candidates / 2.5 s timeout), `waitForDataChannel`, `selectIceServers`, `mapConnectionState`, the `PARCHIS-LAN-1` code format and `splitPairing`/`joinPairingParts`. |
| `lib/party/webrtc/peer-connection.ts` | `createWebRTCTransport`: open/message/close/error mapping, 64 KB inbound cap, 1 MB `bufferedAmount` ceiling. |
| `lib/party/webrtc/pairing.ts` | Pure pairing reducer + `describePairing` with all Spanish copy, including every `PairingFailure`. |
| `lib/party/webrtc/support.ts` | `getLanSupport()` screening `isSecureContext` and `RTCPeerConnection`, with Spanish copy. |
| `lib/party/sessions/webrtc-host-session.ts` | Authoritative session: starts on `HELLO`, validates guest actions, rate-limits, broadcasts `STATE`, sends `BYE` on dispose. |
| `lib/party/sessions/webrtc-guest-session.ts` | Intent sender: `HELLO`/`ACTION`, adopts `START`/`STATE` on non-decreasing versions, resyncs from `ERROR.state`, terminal on protocol mismatch/`BYE`/close. |
| `lib/party/lan/use-lan-session.ts` | Orchestration hook: role choice, offer/answer, transport + session creation on channel open, 20 s connect timeout, retry/abort, full teardown. |
| `components/game/game-stage.tsx` | Shared game stage extracted verbatim from `/play`: header, seat grid, board wrapper, move popover, keyboard targets, sound popover, result overlay, optional banner. |
| `components/lan/roster.ts` | Board colours (host red / guest yellow), engine colours from `lan-colors.ts`, default profiles, `createLanProfiles`/`createLanConfigs`. |
| `components/lan/qr-code.tsx` | QR of one pairing part with previous/next controls and a `Parte i de n` counter. |
| `components/lan/pairing-code-box.tsx` | The **whole** outgoing code in a read-only textarea + **Copiar código**, and the paste field. |
| `components/lan/camera-scanner.tsx` | Explicit-gesture camera capture, `BarcodeDetector` when available, `jsqr` fallback, scan cooldown, track cleanup, Spanish failure mapping. |
| `components/lan/connection-status.tsx` | `describePairing` text with a colour-coded drawably badge and `aria-live="polite"`. |
| `components/lan/lan-game-screen.tsx` | Mounts `GameStage` from a session snapshot with turn gating, event feedback, real-face roll animation, slow-connection and disconnect banners. |
| `components/lan/lan-client.tsx` | Support guard, role selection, profile fields + `AvatarPicker`, pairing panel, game screen. |
| `app/lan/page.tsx` | Client-only page mounting `LanClient`. |
| `lib/party/*.test.ts`, `lib/party/webrtc/*.test.ts`, `lib/party/sessions/*.test.ts` | 65 new tests (see below). |
| `results/lan-multiplayer.md` | This summary. |

### Changed

| File | Change |
| --- | --- |
| `app/play/page.tsx` | Now renders the extracted `GameStage`; keeps the engine reducer, bot policy, 1 s scheduler, auto mode and roll animation. No behaviour change. |
| `app/page.tsx` | New card "Jugar 1 contra 1 en la misma red" with a native GET form to `/lan`. |
| `app/offline/page.tsx` | Corrected copy (LAN play needs no internet) and a `/lan` **Jugar en la misma red** button. |
| `components/game/player-panel.tsx` | `remote?: boolean` → **Rival** instead of **Bot**, including the `aria-label`. |
| `components/game/game-result-overlay.tsx` | `onPlayAgain` is optional, so "Jugar de nuevo" can be hidden where no rematch exists. |
| `package.json`, `bun.lock` | Added `fflate`, `qrcode.react`, `jsqr`. |
| `scripts/generate-service-worker.mjs` | `["lan.html", "/lan"]` added to `requiredRoutes`. |
| `scripts/service-worker-template.js` | `/lan` added to `ROUTE_PATHS`. |
| `architecture.md` | New "LAN 1v1 (WebRTC, no server)" section, routes table, structure tree, precache list, status, and an explicit note that this supersedes Task 07's server signaling. |

No files were deleted.

## Why the design looks like this

- **No server.** A signaling server contradicts the "no internet on the LAN"
  requirement: neither device could reach it. Manual offer/answer exchange is the
  only way to satisfy that, and the owner accepted the extra step.
- **Host-authoritative.** The guest sends intents only. Dice come from
  `crypto.getRandomValues` inside the host, so a guest cannot choose values, and
  every action passes the same pure validator the future server would use.
- **Non-trickle ICE.** Without a signaling channel there is no trickle; gathering
  must finish before the code is produced, hence the 2.5 s cap.
- **Shared `GameStage`.** `/play` and `/lan` were rendering the same board, seats
  and dialogs. Extracting it keeps one implementation and makes the sessions
  genuinely transport-agnostic.
- **`remoteHuman` on the opponent seat.** The first pass set it on the human seat,
  where the label already resolves to "Tú", so the rival always read **Bot**.

## Verification

### Automated

```
bun test          171 pass / 0 fail / 5287 expect() calls / 17 files
bunx tsc --noEmit clean
bun run lint      clean
bun run build     success; 6 routes static; public/sw.js 106 precache entries incl. /lan
TAURI_BUILD=1 bun run build   success; out/lan/index.html present
```

65 new tests cover: memory transport queue/both directions/errors; base64url and
pack/unpack round-trips plus corrupt/oversized payloads; pairing code round-trip,
part splitting ≤300 chars, out-of-order/duplicate/mixed-id reassembly, tampering,
non-trickle gathering (complete / end-of-candidates / timeout), negotiation order,
connection-state mapping; data-channel transport delivery rules and caps; a full
match to a win over the memory pair with deep-equal state/log/version on both
sides; guest `start()` rejection, stale-version rejection on the wire, rate
limiting, disconnect and host-`dispose()` propagation; transport independence
(memory vs fake-WebRTC deep-equal); and Spanish copy coverage for every pairing
state and failure.

### Manual (two browser tabs, Chrome, production build)

Driven over the DevTools protocol against `next start`:

1. `/lan` renders the role choice. **Crear partida** produces a 4-part offer.
2. The guest chooses **Unirse a una partida**, pastes the whole code, presses
   **Añadir código** → "Código completo. Ya puedes conectar." → **Conectar**
   produces a 3-part answer.
3. The host pastes the answer and connects. **Both tabs** show "Tablero de
   Parchís" with 2 seats, `1 vs 1 en red · anfitrión` / `· invitado`, the human
   seat **Tú** and the opponent **Rival**.
4. Host rolls → dice replicate, turn passes to the guest on both devices.
   Guest rolls → turn returns to the host. No console errors.

Two defects found and fixed during this pass:

- **Guest could never paste the offer.** `PairingSteps` returned `null` for a
  guest with no parts yet, so the paste field was not rendered — a deadlock.
  The paste field is now always shown.
- **Copy showed one part of four.** "Copiar código" copied only the currently
  displayed QR part, and pasting one part can never complete. The box now shows
  and copies all parts at once; QR scanning still steps through parts.

### Not verified

- Two physical devices over a real Wi-Fi link (QR scanning, multi-part offers).
- Mixed browsers (Chrome↔Safari, Chrome↔Firefox).
- Wi-Fi with the WAN disabled on installed PWAs.
- Camera-denied path, forced ICE failure, host-tab-closed mid-game, keyboard-only
  play, screen reader behaviour, and reduced motion in the LAN screen.

These are listed as follow-ups rather than claimed.

## Deviations and limitations

- **Manual pairing.** Not automatic LAN discovery; the user must exchange a code
  or scan a QR in both directions. Implementing discovery would need a signaling
  channel or mDNS, neither of which is available offline in a browser.
- **Host-authoritative trust.** The guest trusts the host's state and dice. No
  anti-cheat, no ranked play; this is a same-network, friends-only mode.
- **No host migration or rematch.** A host reload ends the match, and the result
  screen offers only **Volver al inicio**; a rematch means re-pairing. Adding a
  revancha that reuses the open data channel is a follow-up.
- **Secure context required.** `RTCPeerConnection` needs HTTPS or `localhost`.
  A raw `http://192.168.x.x:3000` origin shows the Spanish "conexión segura"
  screen and cannot play. An installed PWA keeps its HTTPS origin while offline.
- **No TURN.** Routers with client/AP isolation, or mDNS that does not resolve
  between the devices, will fail; the UI explains it and offers a retry.
- **STUN over offline.** `stun:stun.cloudflare.com:3478` is used when
  `navigator.onLine`; offline it simply yields no srflx candidate.
- **Task 07 is not implemented.** `/versus/[code]`, `/api/p2p/*` and the WS
  signaling layer remain pending.

## Follow-ups

1. Test on two physical devices over Wi-Fi with the WAN down.
2. Test Chrome↔Safari and Chrome↔Firefox pairings.
3. Exercise the failure paths (camera denied, ICE failure, host leaves) and the
   reduced-motion and keyboard-only paths.
4. Consider a host-side "revancha" that reuses the open data channel.
