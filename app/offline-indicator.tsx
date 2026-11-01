"use client";

import { useEffect, useState } from "react";
import { DrawablyBadge } from "drawably/react";

/**
 * A small, non-blocking connectivity hint. `navigator.onLine` is only a hint:
 * it says whether the device has a network interface, not whether the server
 * is reachable, so the app never disables actions based on it.
 */
export function OfflineIndicator() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => {
      setOffline(!navigator.onLine);
    };

    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      <DrawablyBadge
        stroke="var(--parchis-red)"
        className="bg-[var(--drawably-paper)] px-3 py-1 text-xs"
      >
        Sin conexión
      </DrawablyBadge>
    </div>
  );
}
