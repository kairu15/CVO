import { useCallback, useEffect, useState } from "react";
import { BOUNDARY_URL } from "../lib/barangayBoundaries";

// The boundary asset is a static 22 KB file. Several maps can mount on one
// dashboard, so the successful response is cached at module scope: subsequent
// maps paint from memory instead of racing the same fetch. A failed load is
// NOT cached, so a retry can succeed once connectivity returns.
let cachedCollection = null;
let pendingRequest = null;

function loadBoundaries() {
  if (cachedCollection) return Promise.resolve(cachedCollection);
  if (!pendingRequest) {
    pendingRequest = fetch(BOUNDARY_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((collection) => {
        if (Array.isArray(collection?.features) && collection.features.length > 0) {
          cachedCollection = collection;
          return collection;
        }
        throw new Error("Boundary asset has no features");
      })
      .finally(() => {
        pendingRequest = null;
      });
  }
  return pendingRequest;
}

/**
 * The barangay boundary asset, loaded once and shared by every choropleth
 * consumer (the flow map, the dispersal map, the landing map) through this
 * one hook — so the fetch, the "unavailable" fallback decision and the asset
 * URL have exactly one definition.
 *
 * `reload()` clears the cached success and retries; the map surfaces expose
 * it on their error state so a blocked/failed first request is recoverable
 * without a full page reload.
 *
 * @returns {{status: "loading"|"ready"|"unavailable", collection: object|null, reload: () => void}}
 */
export function useBarangayBoundaries() {
  const [boundaries, setBoundaries] = useState(() =>
    cachedCollection
      ? { status: "ready", collection: cachedCollection }
      : { status: "loading", collection: null },
  );

  const reload = useCallback(() => {
    cachedCollection = null;
    setBoundaries({ status: "loading", collection: null });
  }, []);

  useEffect(() => {
    if (boundaries.status === "ready") return undefined;
    let active = true;

    loadBoundaries()
      .then((collection) => {
        if (active) setBoundaries({ status: "ready", collection });
      })
      .catch(() => {
        if (active) setBoundaries({ status: "unavailable", collection: null });
      });

    return () => {
      active = false;
    };
  }, [boundaries.status]);

  return { ...boundaries, reload };
}
