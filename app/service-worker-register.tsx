"use client";

import { useEffect } from "react";
import { isTauriRuntime } from "@/lib/tauri";

/**
 * Registers the generated service worker in production only.
 *
 * Development never registers a worker. If a production worker from a previous
 * build is still registered on the same origin, it is removed so HMR and the
 * dev server are not controlled by an old cache.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (isTauriRuntime()) {
      // Defensively drop any worker registered by an older desktop build.
      navigator.serviceWorker
        ?.getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations.map((registration) => registration.unregister()),
          ),
        )
        .catch(() => {
          // The desktop bundle needs no worker; cleanup is best-effort.
        });

      return;
    }

    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations.map((registration) => registration.unregister()),
          ),
        )
        .catch(() => {
          // Cleanup is best-effort; development must never be blocked.
        });

      return;
    }

    if (!window.isSecureContext) {
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      })
      .catch((error: unknown) => {
        console.error(
          "[pwa] No se pudo registrar el service worker.",
          error,
        );
      });
  }, []);

  return null;
}
