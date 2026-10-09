import { useEffect, useRef, useState } from "react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { Icon } from "./Icons";

/**
 * Persistent connectivity readout for the header.
 *
 * Unlike the full-width OfflineBanner (a "stop and notice" alert that only
 * appears when something is wrong) and the OfflineSavedDialog (the moment a
 * submission is saved offline), this is the constant ambient state: it is
 * ALWAYS on screen — green and "connected" when things are fine, red and
 * "offline" when they are not — so the current connectivity is readable at a
 * glance without waiting for a transition or an action.
 *
 * Detection is not re-implemented here: it reuses the same debounced
 * `useOnlineStatus` hook that drives the offline queue and the banner, so the
 * indicator, the banner and the queue can never disagree about the state.
 *
 * Because it is ambient, this is deliberately NOT a live region — the banner
 * already announces offline transitions with `aria-live="polite"`, and a
 * second announcer would talk over it. The status is exposed as the button's
 * accessible name instead.
 */
const MESSAGES = {
  online: "You are connected online.",
  offline: "You are in offline mode — all changes will be synced when online.",
};

// Offline reuses the toast system's error tokens (red); online the calmer
// brand green, per the design system.
const TONES = {
  online:
    "bg-brand-50 text-brand-800 ring-brand-200 dark:bg-brand-100 dark:text-brand-800 dark:ring-brand-200/60",
  offline:
    "bg-red-50 text-red-700 ring-red-200 dark:bg-red-100 dark:text-red-700 dark:ring-red-200/60",
};

export function ConnectivityStatus() {
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const state = online ? "online" : "offline";
  const message = MESSAGES[state];

  // Below `xl` only the icon shows, so the message is reachable by tapping
  // the pill. Close that tooltip on an outside click or Escape, consistent
  // with the header's other panels.
  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        type="button"
        data-connectivity={state}
        onClick={() => setOpen((value) => !value)}
        aria-label={message}
        aria-expanded={open}
        title={message}
        className={`inline-flex h-10 items-center gap-2 rounded-pill px-2.5 text-xs font-semibold ring-1 transition-colors duration-200 xl:px-3 ${TONES[state]}`}
      >
        <Icon
          name={state === "online" ? "wifi" : "wifi-off"}
          className="h-4 w-4 shrink-0"
        />
        {/* The text is keyed so a state flip remounts it and plays the brief
            fade, while the pill's own colour cross-fades underneath.

            Full text only from `xl`: at 1024-1279 the header has no spare room
            (the sidebar alone takes 288px, leaving ~736px for the search,
            language, sync badge, bell and profile), and the offline sentence
            is long enough to shove those controls off-screen. It wraps to at
            most two lines so it still fits at 1280 rather than stretching the
            bar. */}
        <span
          key={state}
          className="connectivity-fade hidden max-w-[13rem] text-left leading-tight xl:inline-block"
        >
          {message}
        </span>
      </button>

      {open && (
        // Anchored to the header rather than the pill (the header's backdrop
        // filter makes it the containing block for `fixed`), so the bubble
        // spans the bar instead of hanging off the right edge and clipping
        // against the viewport on the narrow widths where it is used.
        <div
          role="tooltip"
          className="fixed inset-x-4 top-16 z-40 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-panel xl:hidden"
        >
          {message}
        </div>
      )}
    </div>
  );
}
