/**
 * HTTP signaling endpoint for the online party modes.
 *
 * One route, two verbs:
 * - `POST` performs an action from `{ action }`: create/join/signal/leave.
 * - `GET ?code=&id=&since=` polls for relayed signals.
 *
 * Only SDP strings and presence are relayed; game state never reaches this
 * server. Tokens travel in the `Authorization` header or the POST body, never
 * in the URL, and nothing is logged.
 *
 * This module is server-only and irrelevant to the static desktop export,
 * which simply omits it.
 */
import {
  getVersusServer,
  isGuestSeatId,
  isVersusCapacity,
  MAX_SIGNAL_CHARS,
  normalizeRoomCode,
  type VersusCapacity,
  type VersusPeer,
  type VersusSignalKind,
  type VersusStoreError,
} from "@/lib/server/versus/rooms";

const MAX_BODY_CHARS = 32 * 1024;
const CODE_PATTERN = /^[A-Z0-9]{4,8}$/;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const PEER_ID_PATTERN = /^(?:host|guest-[1-3])$/;
const SIGNAL_KINDS = new Set<VersusSignalKind>([
  "offer",
  "answer",
  "joined",
  "left",
  "bye",
]);

interface CredentialsBody extends VersusPeer {
  readonly code: string;
}

function errorResponse(status: number, error: VersusStoreError | string) {
  return Response.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function okResponse(value: unknown) {
  return Response.json(
    { ok: true, ...(value as object) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function isPeerId(value: unknown): value is string {
  return typeof value === "string" && PEER_ID_PATTERN.test(value);
}

function isCredentialsBody(value: unknown): value is CredentialsBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.code === "string" &&
    CODE_PATTERN.test(normalizeRoomCode(record.code)) &&
    isPeerId(record.id) &&
    typeof record.token === "string" &&
    TOKEN_PATTERN.test(record.token)
  );
}

function storeErrorStatus(error: VersusStoreError): number {
  switch (error) {
    case "ROOM_NOT_FOUND":
      return 404;
    case "ROOM_FULL":
    case "ROOM_CLOSED":
    case "ROOM_STARTED":
    case "PEER_GONE":
    case "TOO_MANY_SIGNALS":
      return 409;
    case "UNAUTHORIZED":
      return 401;
    case "BAD_SIGNAL":
      return 400;
  }
}

export async function POST(request: Request) {
  const raw = await request.text();

  if (raw.length > MAX_BODY_CHARS) {
    return errorResponse(413, "BAD_SIGNAL");
  }

  let body: unknown;

  try {
    body = JSON.parse(raw);
  } catch {
    return errorResponse(400, "BAD_SIGNAL");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse(400, "BAD_SIGNAL");
  }

  const record = body as Record<string, unknown>;
  const server = getVersusServer();

  switch (record.action) {
    case "create": {
      const capacity: VersusCapacity = isVersusCapacity(record.capacity)
        ? record.capacity
        : 2;
      const created = server.create(capacity);

      if (!created.ok) {
        return errorResponse(storeErrorStatus(created.error), created.error);
      }

      return okResponse(created.value);
    }

    case "join": {
      if (typeof record.code !== "string") {
        return errorResponse(400, "BAD_SIGNAL");
      }

      const joined = server.join(record.code);

      if (!joined.ok) {
        return errorResponse(storeErrorStatus(joined.error), joined.error);
      }

      return okResponse(joined.value);
    }

    case "signal": {
      if (!isCredentialsBody(record) || typeof record.kind !== "string") {
        return errorResponse(400, "BAD_SIGNAL");
      }

      const kind = record.kind as VersusSignalKind;

      if (!SIGNAL_KINDS.has(kind)) {
        return errorResponse(400, "BAD_SIGNAL");
      }

      const payload = typeof record.payload === "string" ? record.payload : "";

      if (payload.length > MAX_SIGNAL_CHARS) {
        return errorResponse(413, "BAD_SIGNAL");
      }

      const to = isPeerId(record.to) ? record.to : null;
      const sent = server.send(
        {
          code: normalizeRoomCode(record.code),
          id: record.id,
          token: record.token,
        },
        kind,
        payload,
        to,
      );

      if (!sent.ok) {
        return errorResponse(storeErrorStatus(sent.error), sent.error);
      }

      return okResponse(sent.value);
    }

    case "leave": {
      if (!isCredentialsBody(record)) {
        return errorResponse(400, "BAD_SIGNAL");
      }

      const left = server.leave({
        code: normalizeRoomCode(record.code),
        id: record.id,
        token: record.token,
      });

      if (!left.ok) {
        return errorResponse(storeErrorStatus(left.error), left.error);
      }

      return okResponse({});
    }

    case "start": {
      if (!isCredentialsBody(record)) {
        return errorResponse(400, "BAD_SIGNAL");
      }

      const started = server.markStarted({
        code: normalizeRoomCode(record.code),
        id: record.id,
        token: record.token,
      });

      if (!started.ok) {
        return errorResponse(storeErrorStatus(started.error), started.error);
      }

      return okResponse({});
    }

    default:
      return errorResponse(400, "BAD_SIGNAL");
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const sinceText = url.searchParams.get("since");
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const id = url.searchParams.get("id") ?? "";

  if (
    code === null ||
    !CODE_PATTERN.test(normalizeRoomCode(code)) ||
    !TOKEN_PATTERN.test(token) ||
    !(id === "host" || isGuestSeatId(id))
  ) {
    return errorResponse(400, "BAD_SIGNAL");
  }

  const since = Number(sinceText ?? "0");
  const polled = getVersusServer().poll(
    {
      code: normalizeRoomCode(code),
      id,
      token,
    },
    Number.isFinite(since) ? since : 0,
  );

  if (!polled.ok) {
    return errorResponse(storeErrorStatus(polled.error), polled.error);
  }

  return okResponse(polled.value);
}
