import { useEffect } from "react";
import { presenceApi } from "../api/presenceApi";

/** How often a signed-in tab tells the server it is still open. */
export const PRESENCE_HEARTBEAT_INTERVAL = 60_000;

/**
 * Keeps the signed-in account's `last_seen_at` fresh while the app shell is
 * mounted.
 *
 * Rules, all of them about not lying to the administrator looking at the
 * User Management table:
 *  - only runs when `enabled` (the shell passes "there is a signed-in user"),
 *    so nothing is ever sent while signed out;
 *  - a hidden tab sends nothing — a background tab is not somebody using the
 *    system, and the server's window is short enough that closing the laptop
 *    reads as offline within minutes;
 *  - coming back to the tab pings immediately instead of waiting out the
 *    interval, so the account never looks stale after a switch back;
 *  - failures are swallowed: presence is cosmetic and must never surface an
 *    error toast or spin a retry loop.
 */
export function usePresenceHeartbeat(enabled = true, interval = PRESENCE_HEARTBEAT_INTERVAL) {
  useEffect(() => {
    if (!enabled) return undefined;

    const beat = () => {
      if (document.visibilityState !== "visible") return;

      presenceApi.ping().catch(() => {
        // Deliberately silent — see the doc comment above.
      });
    };

    beat();
    const intervalId = setInterval(beat, interval);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, interval]);
}
