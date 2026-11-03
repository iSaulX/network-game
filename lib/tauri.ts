/**
 * Tauri v2 runtime detection shared by the PWA and audio code.
 *
 * `__TAURI_INTERNALS__` is injected into the main frame on every platform and
 * is the reliable signal, including `tauri dev` (where the page is served from
 * the Next.js dev server). The protocol/hostname checks are fallbacks for
 * older builds and for code that runs before the init script.
 */
export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    "__TAURI_INTERNALS__" in window ||
    (window as Window & { isTauri?: boolean }).isTauri === true ||
    window.location.protocol === "tauri:" ||
    window.location.hostname === "tauri.localhost"
  );
}

/**
 * WebKitGTK (the Linux webview) cannot play media from the `tauri://` custom
 * protocol because GStreamer has no URI handler for it. Fetching the bundled
 * file and playing a blob URL works there; Windows and macOS play the custom
 * protocol URL directly.
 */
export function needsBlobAudio(): boolean {
  if (!isTauriRuntime() || typeof navigator === "undefined") {
    return false;
  }

  return (
    /Linux/i.test(navigator.userAgent) &&
    !/Android/i.test(navigator.userAgent)
  );
}
