import { useEffect, useState } from "react";
import { publicMapApi } from "../api/publicMapApi";

/**
 * The public map summary for the landing page (per-barangay counts and
 * program totals).
 *
 * Cached at module level for the session — the landing page mounts once per
 * visit, but React StrictMode double-mounts in development and re-fetching
 * an aggregate endpoint on every remount is pointless. Errors are not
 * cached: a failed load retries on the next mount so a briefly-down backend
 * self-heals.
 *
 * @returns {{data: object|null, loading: boolean, error: boolean}}
 */
export function usePublicMapSummary() {
  const [state, setState] = useState({ data: cache, loading: !cache, error: false });

  useEffect(() => {
    if (cache) return undefined;

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: false }));

    publicMapApi
      .summary()
      .then((data) => {
        cache = data;
        if (!cancelled) setState({ data, loading: false, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, loading: false, error: true });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

let cache = null;
