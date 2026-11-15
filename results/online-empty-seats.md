# Online seats: bot or empty

Direct request (no task brief). The host of an online room can now decide, per
unoccupied guest seat, whether a bot fills it or the seat stays empty when the
match starts. The default is a bot.

## Files

### Changed

- `lib/party/protocol.ts`
  - Protocol bumped to **v3**.
  - `LOBBY` carries `emptySeats: readonly string[]`; validated by a new
    `isEmptySeatList` (guest seat ids only, unique, never the host's own seat,
    never a connected player; `undefined` decodes as "none").
  - `START` carries `mode`, so a two-seat `all` room keeps the four-seat colours.
  - Roster validation accepts **2–4** seats (previously exactly 2 or 4).
- `lib/party/seats.ts`
  - New `seatIdsFor(mode)`.
  - `buildRoster(mode, humans, emptySeats)` skips seats the host left empty,
    clamps to a minimum of two seats, and never drops a connected human.
  - `buildConfigs(roster, mode)` takes the room's mode instead of inferring it
    from the roster length.
- `lib/party/session.ts` — `SessionSnapshot.emptySeats` and
  `GameSession.setSeatEmpty(seatId, empty)`.
- `lib/party/sessions/webrtc-host-session.ts` — keeps `emptySeats`,
  implements `setSeatEmpty` (rejects the host seat, occupied seats and any
  change leaving fewer than two seats), broadcasts the new `LOBBY`, drops a
  seat from `emptySeats` when a guest connects into it, and passes the list to
  `buildRoster`.
- `lib/party/sessions/webrtc-guest-session.ts` — adopts `LOBBY.emptySeats` and
  `START.mode`; `setSeatEmpty` throws like `start()`.
- `lib/party/versus/use-party-session.ts` — exposes `setSeatEmpty` and forwards
  `emptySeats` into the lobby reducer.
- `lib/party/versus/lobby.ts` — `LobbyState.emptySeats`, the reducer keeps it
  across updates, and the host-lobby copy appends "N asientos quedarán vacíos".
- `components/party/lobby-seat.tsx` — new `empty` and `action` props; an empty
  seat reads **Sin jugador · queda vacío en la partida** with a "—" avatar.
- `components/setup/seat-fill-picker.tsx` — optional `label` and `compact` so
  the same picker can label **Invitado N** and fit a lobby row.
- `components/setup/setup-flow.tsx` — the lobby renders the picker on every
  unoccupied guest seat for the host, and the helper copy explains the choice
  to hosts and guests.
- Tests: `lib/party/protocol.test.ts` (v3 messages, 2–4 seats, `emptySeats`
  validation), `lib/party/versus/lobby.test.ts` (empty seats survive updates and
  appear in the copy), `lib/party/sessions/webrtc-sessions.test.ts` (host empties
  seats, guests see it, roster shrinks, minimum of two).
- `architecture.md` — protocol v3, online empty-seat flow and lobby API.

## Behaviour

- Only the host sees the picker, and only on seats nobody occupies; guests just
  see the resulting state.
- A seat marked empty that a guest later joins becomes occupied automatically.
- Emptied seats shrink the table to a minimum of two players; the engine still
  starts.
- An `all` room with two seated players keeps its four-seat colour map.

## Commands and results

- `npx tsc --noEmit` — clean.
- `npx eslint components lib app` — clean.
- `bun test` — **194 passing**, 0 failing, 5,366 assertions across 19 files.
- `npx next build` — succeeded (Turbopack).

## Deviations and follow-ups

- The in-game roster and seat cards were not re-checked in a browser after this
  change; verification is type, lint, test and production-build only.
- `partyProfiles` still derives a two-player online roster's colours from the
  seat ids, so a two-seat `all` room renders the host's and guest's usual
  colours; no layout regression is expected, but a visual pass is advisable.
- The online `GameStage` receives `remoteHuman`, so a `bot-*` seat that remains
  in a room still renders with the HeroUI **Bot** chip from the previous change.
