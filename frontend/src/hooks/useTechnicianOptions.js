import { useEffect, useState } from "react";
import { adminApi } from "../api/adminApi";

/**
 * The technician dropdown's options, cached for the session (5 minutes).
 *
 * The directory used to re-fetch this list on every load — including the
 * 30-second auto-refresh — which doubled the page's polling traffic for data
 * that changes when an administrator edits accounts, not when farmers are
 * enrolled. A module-level cache keeps one fetch per window, and the next
 * mount after it expires refreshes it.
 *
 * A failed fetch is deliberately NOT cached, so a startup blip is retried.
 */
const TTL_MS = 5 * 60 * 1000;

let cache = { items: [], at: 0 };

export function useTechnicianOptions() {
  const [items, setItems] = useState(cache.items);

  useEffect(() => {
    if (Date.now() - cache.at < TTL_MS) {
      setItems(cache.items);
      return undefined;
    }

    let active = true;

    adminApi
      .listUsers({ role: "technician", per_page: 50 })
      .then((rows) => {
        cache = { items: Array.isArray(rows) ? rows : [], at: Date.now() };
        if (active) setItems(cache.items);
      })
      .catch(() => {
        // Keep whatever the last good list was; assignment still works and
        // the next mount retries.
      });

    return () => {
      active = false;
    };
  }, []);

  return items;
}

/** Test seam: drop the cache so one test's technician list cannot leak. */
export function resetTechnicianOptionsCache() {
  cache = { items: [], at: 0 };
}
