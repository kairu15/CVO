import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Guard in-progress form input against being silently destroyed.
 *
 * Two surfaces, because "leave" means different things in an SPA:
 *
 *  1. A real page close/reload (browser X button, PWA relaunch, Ctrl+R) —
 *     handled by `beforeunload`, where the browser shows its own confirmation
 *     and nothing in-app can be more reliable.
 *  2. In-app navigation via a link (sidebar, header, back-to-home) — there is
 *     no browser prompt for this, so link clicks are intercepted in the
 *     capture phase BEFORE the router sees them and the caller gets to ask
 *     first: the hook returns the pending destination and `stay()`/`leave()`
 *     to resolve it. (This app uses a declarative `BrowserRouter`, where
 *     React Router's `useBlocker` is unavailable — hence the click-level
 *     interception.)
 *
 * Deliberately NOT intercepted: programmatic navigations the app itself
 * performs after a completed action (post-save redirects, the idle-session
 * sign-out) — those are outcomes of the user's own decisions, and gating them
 * would trap the user.
 *
 * The caller renders the confirmation UI (see ConfirmDialog) when
 * `pendingHref` is set.
 *
 * @param {object} props
 * @param {boolean} props.when true while the form holds unsaved input
 * @returns {{ pendingHref: string | null, stay: () => void, leave: () => void }}
 */
export function useUnsavedChangesGuard({ when }) {
  const navigate = useNavigate();
  const [pendingHref, setPendingHref] = useState(null);
  // The listeners read `when` through a ref so a dirty flip never re-binds
  // them mid-stroke (and a stale closure can never disable the guard).
  const whenRef = useRef(when);
  whenRef.current = when;

  useEffect(() => {
    if (!when) return undefined;

    function onBeforeUnload(event) {
      // Chrome/Edge require returnValue to be set; Firefox shows its own
      // wording whenever preventDefault is called.
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [when]);

  useEffect(() => {
    if (!when) return undefined;

    function onClick(event) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (!anchor) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const raw = anchor.getAttribute("href");
      if (!raw || raw.startsWith("#")) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return; // same page (hash/anchor) — leaving it costs nothing
      }

      // Capture phase, before React Router's delegated click handling: the
      // router never sees this navigation unless the user confirms.
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(url.pathname + url.search + url.hash);
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [when]);

  const stay = () => setPendingHref(null);

  const leave = () => {
    const target = pendingHref;
    setPendingHref(null);
    if (target) navigate(target);
  };

  return { pendingHref, stay, leave };
}
