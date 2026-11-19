/**
 * Runtime support screen, checked before any online lobby is shown.
 *
 * Online play now goes through the server's WebSocket relay, so WebRTC is no
 * longer a requirement. The module keeps its historical path to avoid a
 * broad import churn.
 */
export type LanSupportReason = "insecure-context" | "no-websocket";

export type LanSupport = { readonly ok: true } | {
  readonly ok: false;
  readonly reason: LanSupportReason;
};

export function getLanSupport(
  environment: {
    readonly isSecureContext: boolean;
    readonly hasWebSocket: boolean;
  } = {
    isSecureContext:
      typeof window !== "undefined" && window.isSecureContext === true,
    hasWebSocket: typeof WebSocket !== "undefined",
  },
): LanSupport {
  if (!environment.isSecureContext) {
    return { ok: false, reason: "insecure-context" };
  }

  if (!environment.hasWebSocket) {
    return { ok: false, reason: "no-websocket" };
  }

  return { ok: true };
}

export const LAN_SUPPORT_COPY: Readonly<Record<LanSupportReason, string>> =
  Object.freeze({
    "insecure-context":
      "Este modo necesita una conexión segura (HTTPS) o la app instalada.",
    "no-websocket":
      "Este navegador no permite la conexión en tiempo real. Prueba con Chrome, Edge, Safari o Firefox actualizados.",
  });
