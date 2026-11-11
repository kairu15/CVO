import { useEffect, useState } from "react";
import { publicAnnouncementsApi } from "../api/publicAnnouncementsApi";

/**
 * The public announcements slice for the landing page (latest N, pinned
 * first). Same module-level session cache as usePublicTransparency: the page
 * mounts once per visit but StrictMode double-mounts in development, and
 * re-fetching an anonymous aggregate on every remount is pointless. Errors
 * are not cached, so a briefly-down backend self-heals on the next mount.
 *
 * An empty list is a normal state (the office has not published anything) —
 * the caller hides the section rather than showing an empty box.
 *
 * @returns {{data: Array|null, loading: boolean, error: boolean}}
 */
export function usePublicAnnouncements(limit = 3) {
  const [state, setState] = useState({ data: cache, loading: !cache, error: false });

  useEffect(() => {
    if (cache) return undefined;

    let cancelled = false;
    publicAnnouncementsApi
      .list(limit)
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
  }, [limit]);

  return state;
}

let cache = null;
