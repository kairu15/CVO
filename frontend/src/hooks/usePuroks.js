import { useEffect, useState } from "react";
import { fetchPuroks } from "../api/beneficiariesApi";

/**
 * The puroks/sitios of one barangay — the second select in the registration
 * cascade. Fetches only once a barangay is chosen and resets whenever the
 * barangay changes, so a stale purok can never outlive its parent select.
 */
export function usePuroks(barangayId) {
  const [puroks, setPuroks] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!barangayId) {
      setPuroks([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchPuroks(barangayId)
      .then((list) => {
        if (!cancelled) setPuroks(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        // Offline / backend down: the purok select stays empty and
        // registration can still go through on the barangay alone.
        if (!cancelled) setPuroks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [barangayId]);

  return { puroks, loading };
}
