import { useEffect, useState } from "react";
import { publicTransparencyApi } from "../api/publicTransparencyApi";

/**
 * The public transparency summary (program totals, per-barangay counts, a
 * monthly reach trend and vaccination compliance).
 *
 * Cached at module level for the session — the page mounts once per visit, but
 * React StrictMode double-mounts in development and re-fetching an aggregate
 * endpoint on every remount is pointless. Errors are not cached: a failed load
 * retries on the next mount so a briefly-down backend self-heals.
 *
 * @returns {{data: object|null, loading: boolean, error: boolean}}
 */
export function usePublicTransparency() {
  const [state, setState] = useState({ data: cache, loading: !cache, error: false });

  useEffect(() => {
    if (cache) return undefined;
    // NOT returned: fetchSummary resolves a promise, and an effect must never
    // return one (React treats it as a cleanup function).
    fetchSummary();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the loader is stable
  }, []);

  // A failed load is retryable in place (the transparency page's Retry
  // button) without a remount.
  function fetchSummary() {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: false }));

    return publicTransparencyApi
      .summary()
      .then((data) => {
        cache = data;
        if (!cancelled) setState({ data, loading: false, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, loading: false, error: true });
      });
  }

  return { ...state, refetch: fetchSummary };
}

let cache = null;
