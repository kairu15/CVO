import { useEffect, useState } from "react";
import { publicDocumentsApi } from "../api/publicDocumentsApi";

/**
 * The public transparency documents (metadata for every published PDF).
 * Same module-level session cache discipline as usePublicTransparency —
 * mount once per visit, tolerate StrictMode's double mount, never cache a
 * failure.
 *
 * An empty list is a normal state (nothing published yet) — the transparency
 * page hides the documents section instead of showing an empty box.
 *
 * @returns {{data: Array|null, loading: boolean, error: boolean}}
 */
export function usePublicDocuments() {
  const [state, setState] = useState({ data: cache, loading: !cache, error: false });

  useEffect(() => {
    if (cache) return undefined;

    let cancelled = false;
    publicDocumentsApi
      .list()
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
