import { useEffect, useState } from "react";
import { fetchBarangays } from "../api/beneficiariesApi";

/**
 * The barangays the CVO program covers (Bayawan City, Negros Oriental).
 *
 * Fetched once from `GET /api/v1/barangays` so the server stays the single
 * source of truth; falls back to the known list when the API is unreachable
 * so the registration form still works offline.
 */
const FALLBACK = [
  "Ali-Nan-Ban",
  "Banay Banay",
  "Cansumalig",
  "Daw-Kal-Vil",
  "Dawis",
  "Kalumboyan",
  "Tayawan",
];

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
 * The covered barangay names for dropdowns. Resolves from the API on first
 * use and is memoized for the session.
 *
 * @returns {string[]} barangay names in display order
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
