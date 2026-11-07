/**
 * Fixed LAN seats shared by the host session (which builds the engine game) and
 * the UI (which maps board colours). The host plays board red, the guest board
 * yellow; engine colours follow `BOARD_TO_ENGINE_COLOR`.
 *
 * Deliberately dependency-free so the engine-facing session never imports a
 * component module.
 */
import type { Color } from "@/lib/parchis/types";

export const LAN_HOST_ENGINE_COLOR: Color = "yellow";
export const LAN_GUEST_ENGINE_COLOR: Color = "green";
