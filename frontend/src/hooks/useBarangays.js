import { useEffect, useState } from "react";
import { fetchBarangays } from "../api/beneficiariesApi";

/**
 * The barangays the CVO program covers (Bayawan City, Negros Oriental).
 *
 * Fetched once from `GET /api/v1/barangays` so the server stays the single
 * source of truth; falls back to the known names (config/barangays.php) when
 * the API is unreachable so the registration form still works offline —
 * without ids/coordinates, only the map's auto-zoom is degraded.
 */
const FALLBACK_NAMES = [
  "Ali-is",
  "Banaybanay",
  "Banga",
  "Boyco",
  "Bugay",
  "Cansumalig",
  "Dawis",
  "Kalamtukan",
  "Kalumboyan",
  "Malabugas",
  "Mandu-ao",
  "Maninihon",
  "Minaba",
  "Nangka",
  "Narra",
  "Pagatban",
  "Poblacion",
  "San Isidro",
  "San Jose",
  "San Miguel",
  "San Roque",
  "Suba (Poblacion)",
  "Tabuan",
  "Tayawan",
  "Tinago (Poblacion)",
  "Ubos (Poblacion)",
  "Villasol (Bato)",
  "Villareal",
];

const FALLBACK = FALLBACK_NAMES.map((name) => ({
  id: null,
  name,
  latitude: null,
  longitude: null,
}));

let cache = null;
let pending = null;

async function load() {
  if (cache) return cache;
  pending ??= fetchBarangays()
    .then((list) => {
      cache = Array.isArray(list) && list.length > 0 ? list : FALLBACK;
      return cache;
    })
    .catch(() => FALLBACK);
  return pending;
}

/**
 * The covered barangays for dropdowns. Resolves from the API on first use
 * and is memoized for the session.
 *
 * @returns {Array<{id: number|null, name: string, latitude: number|null, longitude: number|null}>}
 *   reference rows in display order
 */
export function useBarangays() {
  const [barangays, setBarangays] = useState(cache ?? FALLBACK);

  useEffect(() => {
    let cancelled = false;

    load().then((list) => {
      if (!cancelled) setBarangays(list);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return barangays;
}
