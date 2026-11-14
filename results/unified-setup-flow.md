# Unified setup flow (online 1v1 / four-player + bots) — completion summary

## What was built

The homepage, the local setup screen and the online 1v1 screen were merged into
a single step flow at `/`:

```
Inicio (perfil + Crear / Unirse)
  → Crear partida
      → ¿Partida en línea?
          → Sí: elegir modo (1 vs 1 | todos contra todos) → sala de espera → partida
          → No: elegir color + modo → /play (bots)
  → Unirse: código de 6 caracteres → sala de espera → partida
```

- The homepage no longer offers "Jugar 1 contra 1" or "Jugar solo con bots" as
  separate entries. Its copy now says the player can play **online against
  other people or against bots**, and that they choose the mode, the connection
  and when the match starts.
- Online rooms seat **1 host + up to 3 guests** (2 seats for `1v1`, 4 for
  `all`). The lobby shows every seat, updating in real time as people join,
  with each seat's board colour and the **Anfitrión** / **Invitado N** role.
- **Only the host can start**, and may do so whenever they want: empty seats
  become bots at that moment (`buildRoster`).
- The local bot game remains `/play`, now reached from the create step with the
  chosen mode, colour, name and avatar.

## Files

### Created

| File | Why |
| --- | --- |
| `components/setup/setup-flow.tsx` | The whole pre-game flow: step state machine, profile persistence, create/join, online vs bots, mode choice, live lobby and the party game screen. |
| `components/setup/room-code.tsx` | Moved from `components/versus/room-code.tsx`; six-character code card with a copy button, reused by the lobby. |
| `components/party/lobby-seat.tsx` | One lobby row: seat avatar, name, role and board colour; empty seats read "Asiento libre". |
| `components/party/party-game-screen.tsx` | Mounts the shared `GameStage` from a party session snapshot (turn gating, event feedback, dice tumble, slow-connection banner). |
| `components/party/party-profiles.ts` | Maps a party roster to the board profiles `GameStage` renders. |
| `lib/party/seats.ts` | Seat → board colour maps, bot profiles, `buildRoster` (fills empty seats with bots) and `buildConfigs`. |
| `lib/party/versus/lobby.ts` + `.test.ts` | Pure lobby reducer, Spanish copy (`describeLobby`, `seatLabel`, `LOBBY_FAILURE_COPY`) and its tests. |
| `lib/party/versus/use-party-session.ts` | Replaces `use-versus-session.ts`: owns signaling, one peer connection per guest, host/guest sessions and exposes `createGame`/`openJoin`/`joinGame`/`startGame`/`retry`/`abort`. |
| `lib/server/versus/rooms.ts` + `.test.ts` | Rewritten room store: capacity 2/4, first-free guest seat, targeted signals, presence lists, `joined`/`left` notes to the host. |
| `app/api/versus/route.ts` | Rewritten handler: `create(capacity)`, `join`, `signal(to)`, `leave`, `GET` poll with presence and capacity. |
| `lib/party/versus/signaling-client.ts` + `.test.ts` | `capacityForMode`, capacity-aware `createVersusRoom`, `send(kind, payload, to)`, presence parsing; the default fetcher is now called unbound (see deviations). |
| `lib/party/sessions/versus-negotiation.test.ts` | SDP relay test over the HTTP contract plus a multi-seat session test over the in-memory transport. |

### Changed

| File | Change |
| --- | --- |
| `app/page.tsx` | Now a thin client entry rendering `SetupFlow`. |
| `lib/party/protocol.ts` | Protocol v2: `PartyRole`, `GameMode`, seat/bot ids, `{ players }` roster, `HELLO` without a role, new `LOBBY` message, `SEAT_BOARD_COLOR`, `isGuestId`/`isGameMode`/`isBotId`. |
| `lib/party/session.ts` | `SessionSnapshot` gained `lobby`, `roster`, `disconnected` and `mode`. |
| `lib/party/sessions/webrtc-host-session.ts` | Multi-peer host: `joinPeer`/`removePeer`, host-only `start()` that fills empty seats with bots, per-guest broadcasts, `LOBBY`/`START` messages, bot scheduling for bots and dropped guests. |
| `lib/party/sessions/webrtc-guest-session.ts` | Seat-aware guest: `playerId`, `LOBBY` handling, roster/mode from `START`, lobby snapshot. |
| `app/play/page.tsx` | "Cambiar modo" now returns to `/` (the create step). |
| `app/offline/page.tsx` | Copy no longer says 1v1; the offline button returns to `/` (create step → bots). |
| `public/manifest.webmanifest` | `start_url` is `/` (the flow opens directly). |
| `scripts/generate-service-worker.mjs`, `scripts/service-worker-template.js` | Route lists no longer contain `/alone` or `/versus`; precache is 98 entries. |
| `lib/party/protocol.test.ts`, `lib/party/transport.test.ts`, `lib/party/webrtc/peer-connection.test.ts`, `lib/party/sessions/webrtc-sessions.test.ts`, `lib/server/versus/rooms.test.ts` | Updated to protocol v2, the multi-seat roster, host-only start and bot-filled seats. |
| `architecture.md` | Merged the homepage/solo sections into "Unified setup flow", rewrote the online section for 2–4 seats, updated routes, PWA and status. |

### Deleted

`app/alone/`, `app/versus/`, `components/lan/` (old roster), `components/versus/`
(client, game screen; `room-code.tsx` moved), `lib/party/lan-colors.ts`,
`lib/party/versus/pairing.ts` + test, `lib/party/versus/use-versus-session.ts`.

## Verification

| Command | Result |
| --- | --- |
| `bun test` | 188 pass, 0 fail (19 files, 5,333 assertions) |
| `bunx tsc --noEmit` | clean (after removing stale `.next/types` from the deleted routes) |
| `bun run lint` | clean |
| `bun run build` | succeeded; routes `/`, `/offline`, `/play`, `/api/versus`; service worker 98 entries |
| `TAURI_BUILD=1 bunx next build` | succeeded; static export `/`, `/offline`, `/play` |

Browser verification (headless Chrome over CDP, production build):

- Host, four-player room: homepage → **Crear una partida** → **Sí, con personas**
  → **4 jugadores · todos contra todos** → lobby with code `ZL8S7V`, "0 de 3
  invitados dentro", host seat red and three empty bot seats.
- A second browser typed the code, joined, and the host lobby updated in real
  time to "1 de 3 invitados dentro" with the guest in seat **Invitado 1**. The
  guest saw the same roster and the "Solo el anfitrión puede iniciar" note.
- Pressing **Iniciar la partida** on the host switched both browsers to the
  board: "Todos contra todos · en línea", four seats (red **Tú** on the host,
  yellow **Tú** on the guest, the other two **Rival**), one Pixi canvas each.
- 1v1 room: lobby shows 2 seats, starting with no guest yields "1 contra 1 · en
  línea" with the host red and a yellow bot rival.
- Bots path: **No, contra bots** shows the four colour tiles, the mode cards
  navigate to `/play?mode=all&color=blue&name=…&avatar=…`, and the local game
  renders the human plus three bots.
- No horizontal overflow at 390 px (`scrollWidth === 390`) on the home, create
  and lobby steps.

## Follow-up fixes (same request)

- **Auto-play leaked into online games:** `DiceCard` derived its **Auto** badge and "Modo automático." status from "this seat is not controllable right now", so in an online 1v1 the seat of the *other* player (and the waiting player) was labelled as auto-played. The card now takes an explicit `auto` prop, which only the local `/play` screen sets from its checkbox; the online screen never passes it, so **Modo automático** is local-only.
- **1v1 corners:** a 1v1 room seated host red and guest yellow, which are adjacent corners. `lib/party/seats.ts` now maps a 1v1 to host **red** and guest **green** (opposite corners), matching the local 1v1; `boardColorOf`/`engineColorOf`/`buildConfigs` take the mode, and `partyProfiles` and `LobbySeat` derive the colour from it. The lobby seat list therefore shows red and green in a 1v1.
- **Create-step copy and selection:** the heading is now **Modo de multijugador** with no explanatory paragraph. The selected online/bots card no longer flips to `variant="solid"` (which turned the unselected title white on the paper background); both stay outlined, the selected one is tinted with a translucent light blue and keeps dark text. `LobbySeat` moved from hard-coded CSS variables to `COLOR_ACCENT`.

## Follow-up: loading states and copy feedback

- **Skeleton while connecting:** `LobbyConnecting` mirrors the lobby's two-card
  layout with pulsing skeleton bars for the code, the seat rows and the
  actions, plus `aria-busy="true"` and a screen-reader "Conectando con la
  partida" message. It shows while the host is creating the room, while a guest
  is joining, and until a guest receives its first roster, so a slow WebRTC
  handshake never looks like a broken screen. `describeLobby` gained matching
  copy for the `joining` and empty `guest-lobby` phases.
- **Torph text morph:** `torph@0.1.4` is installed. `RoomCode`'s copy button now
  uses `TextMorph` from `torph/react` to animate "Copiar código" → "Copiado",
  so the separate status line is gone (it only remains for the clipboard
  failure message).
- **transitions.dev (free recipes):** the Pro `skill` command needs a browser
  sign-in, so the free recipes were installed with `npx transitions-dev add`
  into `transitions/` (`success-check.md`, `icon-swap.md`,
  `skeleton-reveal.md`). Their CSS and variables were adapted into
  `app/globals.css` as `.t-skel`, `.t-icon-swap` and `.t-success-check`, all
  guarded by `prefers-reduced-motion`.
- **Copy → check:** the button cross-fades the copy glyph to a round green check
  (`var(--parchis-green)`) with the success-check draw, and back to the glyph
  when the state resets after 2.4 s. `aria-label` on the button and an
  `sr-only` live region announce "Copiado" / "Código copiado.".

## Follow-up: online auto-play

The **Modo automático** checkbox was removed from the online screen in an
earlier fix because `DiceCard` was mislabelling remote turns as auto-play. It is
back as a real feature: `PartyGameScreen` now keeps an `autoMode` flag, hands its
own seat to `lib/bots/policy` while it is the current player (900 ms between
actions, same policy as the local game) and passes `autoControl` to
`GameStage`. It is local to the viewer's own seat; the other seats stay
controlled by their owners or by the host's bot logic. Turning it off returns
the controls immediately, and the auto timer is cleared on unmount.

## Deviations and follow-ups

- `4vs4` was implemented as **4 players, every player for themselves** (rojo,
  azul, amarillo, verde), per the confirmed decision; it is not two teams.
- Bots fill empty seats at start, per the confirmed decision, so the host never
  has to wait for a full room.
- Next 16 rejects `Math.random()` in a component during static prerendering.
  The random name/avatar are generated through `useSyncExternalStore` with
  stable server snapshots, matching the previous homepage approach.
- The signaling client called the global `fetch` as a method
  (`this.fetcher(...)`), which browsers reject with "Illegal invocation"; the
  first poll therefore failed and the lobby showed "No se pudo contactar con el
  servidor de partidas". It now calls `fetch` unbound. The in-memory tests
  could not catch this because an injected function accepts any receiver.
- No rematch and no host migration, as before. Bots run only on the host.
- The in-memory signaling store still requires a single long-lived Node
  process; serverless or multi-instance hosting needs an external store.
- The Tauri static export has no signaling server, so online play is only
  available in the web build; the desktop app still plays local bot games.
