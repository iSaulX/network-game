import type { LanRole } from "../protocol";

/** Runtime support screen, checked before any pairing UI is shown. */
export type LanSupportReason =
  | "insecure-context"
  | "no-webrtc"
  | "no-datachannel";

export type LanSupport = { readonly ok: true } | {
  readonly ok: false;
  readonly reason: LanSupportReason;
};

export function getLanSupport(
  environment: {
    readonly isSecureContext: boolean;
    readonly hasPeerConnection: boolean;
  } = {
    isSecureContext:
      typeof window !== "undefined" && window.isSecureContext === true,
    hasPeerConnection: typeof RTCPeerConnection !== "undefined",
  },
): LanSupport {
  if (!environment.isSecureContext) {
    return { ok: false, reason: "insecure-context" };
  }

  if (!environment.hasPeerConnection) {
    return { ok: false, reason: "no-webrtc" };
  }

  return { ok: true };
}

export const LAN_SUPPORT_COPY: Readonly<Record<LanSupportReason, string>> =
  Object.freeze({
    "insecure-context":
      "Este modo necesita una conexión segura (HTTPS) o la PWA instalada.",
    "no-webrtc":
      "Este navegador no permite conexiones directas entre dispositivos. Prueba con Chrome, Edge, Safari o Firefox actualizados.",
    "no-datachannel":
      "Este navegador no admite el canal de datos necesario para jugar.",
  });

export const LAN_ROLE_LABEL: Readonly<Record<LanRole, string>> = Object.freeze({
  host: "Anfitrión · rojo",
  guest: "Invitado · amarillo",
});
