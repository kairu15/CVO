import { useCallback, useEffect, useState } from "react";
import { getErrorMessage } from "../api/client";

/**
 * One chart's data lifecycle — independent fetch, independent skeleton, so a
 * slow chart never delays the page and a failed chart degrades to its own
 * empty frame instead of blanking the screen.
 *
 * Shared by the Reports screen and the Admin Dashboard Overview.
 */
export function useChart(loader) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    loader()
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch((err) => {
        if (active) setState({ data: null, loading: false, error: getErrorMessage(err) });
      });

    return () => {
      active = false;
    };
  }, [loader, tick]);

  return { ...state, refresh: useCallback(() => setTick((t) => t + 1), []) };
}
