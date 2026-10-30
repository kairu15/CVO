import { useEffect, useState } from "react";
import { BOUNDARY_URL } from "../lib/barangayBoundaries";

/**
 * The barangay boundary asset, fetched once per mount and shared by every
 * choropleth consumer (the flow map, the dispersal map) through this one
 * hook — so the fetch, the "unavailable" fallback decision and the asset
 * URL have exactly one definition.
 *
 * @returns {{status: "loading"|"ready"|"unavailable", collection: object|null}}
 */
export function useBarangayBoundaries() {
  const [boundaries, setBoundaries] = useState({ status: "loading", collection: null });

  useEffect(() => {
    let active = true;

    fetch(BOUNDARY_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((collection) => {
        if (active && Array.isArray(collection?.features) && collection.features.length > 0) {
          setBoundaries({ status: "ready", collection });
        } else if (active) {
          setBoundaries({ status: "unavailable", collection: null });
        }
      })
      .catch(() => {
        if (active) setBoundaries({ status: "unavailable", collection: null });
      });

    return () => {
      active = false;
    };
  }, []);

  return boundaries;
}
