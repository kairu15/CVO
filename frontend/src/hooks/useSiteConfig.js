import { useEffect, useState } from "react";
import { siteApi } from "../api/siteApi";
import { officeContactFallback } from "../config/site";

/**
 * Site metadata for the public surfaces: the office contact profile an
 * administrator edits in System Settings, and the SPA's inactivity window.
 *
 * Shape returned:
 *   contact      { email, phone, hours, address } — ALWAYS populated, falling
 *                back to config/site.js until the request lands (and if it
 *                fails), so a page never renders a blank phone number.
 *   idleMinutes  number | null — null until loaded, so callers can tell
 *                "not known yet" from "configured". IdleSessionGuard keeps its
 *                own default in that case.
 *
 * Cached at module level for the session: this is read by the landing page,
 * the Support page and the sign-in form, and React StrictMode double-mounts
 * in development — re-fetching published contact details on every remount is
 * pointless. Errors are not cached, so a briefly-down backend self-heals on
 * the next mount.
 */
export function useSiteConfig() {
  const [state, setState] = useState(() => (cache ? toState(cache) : fallbackState()));

  useEffect(() => {
    if (cache) return undefined;

    let cancelled = false;

    // Promise.resolve() first so a mocked/replaced API that throws
    // synchronously still lands in the catch below instead of breaking render.
    Promise.resolve()
      .then(() => siteApi.config())
      .then((data) => {
        cache = data ?? {};
        if (!cancelled) setState(toState(cache));
      })
      .catch(() => {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false, error: true }));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/** The API's key names → the short names the components read. */
function toState(data) {
  const office = data?.office ?? {};
  const idle = data?.session?.idle_minutes;

  return {
    contact: {
      email: office.office_email ?? officeContactFallback.office_email,
      phone: office.office_phone ?? officeContactFallback.office_phone,
      hours: office.office_hours ?? officeContactFallback.office_hours,
      address: office.office_address ?? officeContactFallback.office_address,
    },
    idleMinutes: Number.isFinite(idle) && idle > 0 ? idle : null,
    loading: false,
    error: false,
  };
}

function fallbackState() {
  return { ...toState(null), loading: true };
}

/**
 * Drop the session cache.
 *
 * A test seam, and nothing else: the cache exists to avoid re-fetching
 * published contact details on every mount, which in a test runner means one
 * test's result would leak into the next.
 */
export function resetSiteConfigCache() {
  cache = null;
}

let cache = null;
