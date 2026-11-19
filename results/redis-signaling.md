# Redis-backed signaling store

**Status:** complete.

## Problem

The online party signaling store lived in process memory (`globalThis`). On
Vercel each route-handler invocation can run in a different serverless
instance, so a room created by the host was invisible to a guest's `join` or
`poll`: rooms "died" at random and pairing failed. The in-memory store was
only correct on a single long-lived Node process.

## Solution

Rooms are now persisted in Redis, one JSON value per room code, so every
serverless instance reads and writes the same state. Room rules (seats,
epochs, signal filtering, TTLs, caps) are unchanged and remain pure functions
shared by the in-memory test store and the Redis store.

- `create` allocates the code atomically with `SET NX`, so two instances can
  never hand out the same code.
- Every other mutation runs under a short per-room Redis lock
  (`SET NX EX 5`), loads the room, applies the pure operation, and writes it
  back with the TTL computed from the room rules.
- TTLs are unchanged: 30 minutes of activity with guests, 10 minutes from
  creation while guest-less. Redis removes the key at the deadline, and the
  store also checks expiry on load to cover clock skew.
- Corrupt or outdated values are treated as a missing room and deleted.
- Redis failures return `STORE_UNAVAILABLE`, which the route maps to HTTP 503;
  the client already maps that to its `server-unreachable` failure. There is
  deliberately no silent fallback to process memory, which would split a room
  across instances again.
- Game state still never reaches the server: Redis holds only SDP payloads,
  presence and peer tokens for the room's lifetime.

## Files

Created:

- `lib/server/versus/redis-store.ts` — Redis client singleton (lazy connect,
  one per process), `createRedisVersusServer`, per-room lock, serialization
  integration, `getVersusServer`.
- `lib/server/versus/redis-store.test.ts` — fake Redis client covering
  cross-instance rooms, cross-instance signals, expiry, corrupt values and
  Redis failures.
- `results/redis-signaling.md` — this summary.

Changed:

- `lib/server/versus/rooms.ts` — extracted the room rules into exported pure
  functions (`createRoomState`, `joinRoomState`, `sendRoomSignal`,
  `pollRoomState`, `leaveRoomState`, `markRoomStartedState`,
  `pruneRoomSignals`, expiry helpers) plus `serializeRoom`/`deserializeRoom`.
  `createVersusServer()` remains as the in-memory implementation used by
  tests; the production `globalThis` singleton was removed.
- `app/api/versus/route.ts` — imports the Redis-backed store, awaits its
  methods, and maps `STORE_UNAVAILABLE` to 503.
- `package.json`, `bun.lock` — added `redis@6.3.1`.
- `architecture.md` — online-party store, route table, deployment notes and
  the data/networking section now describe the Redis store.
- `docs/network-architecture.md` — replaced the in-memory-store limits section
  with the Redis model, updated security/persistence notes, file table,
  testing notes and scale limits.

No source files were deleted.

## Verification

- `./node_modules/.bin/tsc --noEmit` — pass.
- `bun test` — 228 pass, 0 fail (23 files), including the five new Redis-store
  tests.
- `bun run lint` — pass.
- `npm run build` — pass; `/api/versus` is emitted as a dynamic route.
- Real Redis instance: `PING`/`SET`/`GET`/`DEL` succeeded.
- End-to-end against `next start` and real Redis: `create` → `join` → host poll
  (`joined:guest-1`) → `signal offer` → guest poll (`OFFER`) → leave.
- Cross-process check (the Vercel failure mode): room created through a server
  on port 3123, guest joined and polled through a **second** server process on
  port 3124; the host saw the join and the guest received the offer. Test room
  and lock keys were deleted afterwards; Redis reports zero leftover keys.

## Deviations and follow-ups

- **Hardcoded Redis credentials**: implemented at the owner's explicit
  request. They live only in `lib/server/versus/redis-store.ts`. Before the
  repository is shared publicly, move them to environment variables (Vercel
  project settings) and rotate the password.
- **Local environment only**: Bun's install cache left `debug` and `ms`
  incomplete, which broke ESLint; a clean `npm ci` repaired `node_modules`.
  This is unrelated to the application code. The tracked lockfile remains
  `bun.lock`.
- **Single Redis instance** is now a single point of failure. An outage
  surfaces as `server-unreachable`; a managed replica is out of scope.
- **Lock release** uses `GET` + `DEL` rather than a Lua compare-and-delete.
  The 5-second lock TTL bounds the tiny race; traffic is low.
- **Tokens are stored in Redis** for the room lifetime (not hashed), matching
  the previous in-memory behavior. Access to the Redis credentials grants
  access to live rooms.
- **Free-tier connection limits** may matter under high serverless
  concurrency, since each instance keeps one Redis connection.
- **No reconnect/resume**: a page reload still loses the peer credentials and
  ends that peer's participation; this change only fixes cross-instance room
  visibility.
