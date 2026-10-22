import { useCallback, useEffect, useState } from "react";
import { animalTypesApi } from "../api/animalTypesApi";

/**
 * The CVO animal master list, grouped by main category.
 *
 * Same shape and caching approach as `useBarangays`: fetched from the API on
 * first use and memoized for the session, because it is reference data that
 * changes only when an administrator edits it. `reload()` is the manager's
 * way to refresh after a write.
 *
 * A failed fetch resolves to `[]` rather than throwing: the forms then fall
 * back to their own type list instead of rendering an empty, unusable
 * dropdown. The next mount retries (a failure is deliberately NOT cached).
 */

let cache = null;
let pending = null;

/** Fetch the catalogue; `force` bypasses the session cache after a write. */
export async function loadAnimalTypeGroups(force = false) {
  if (force) {
    cache = null;
    pending = null;
  }

  if (cache) return cache;

  pending ??= animalTypesApi
    .list()
    .then((list) => {
      cache = Array.isArray(list) ? list : [];
      return cache;
    })
    .catch(() => [])
    .finally(() => {
      pending = null;
    });

  return pending;
}

/**
 * @returns {{groups: Array<object>, loading: boolean, reload: () => Promise<Array<object>>}}
 *   the grouped catalogue, whether the first fetch is still in flight, and a
 *   force-refresh for the settings manager.
 */
export function useAnimalTypeGroups() {
  const [groups, setGroups] = useState(cache ?? []);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    let cancelled = false;

    loadAnimalTypeGroups().then((list) => {
      if (cancelled) return;
      setGroups(list);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    const list = await loadAnimalTypeGroups(true);
    setGroups(list);
    setLoading(false);

    return list;
  }, []);

  return { groups, loading, reload };
}
