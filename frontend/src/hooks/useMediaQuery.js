import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query.
 *
 * Built on `useSyncExternalStore` so the value is correct on the very first
 * render and updates on resize without an effect (and without a setState
 * cascade). The server snapshot is always `false`, which matches a mobile-first
 * default — this app is client-rendered, so it is only a safety net.
 *
 * @param {string} query e.g. "(min-width: 1024px)"
 */
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onStoreChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onStoreChange);
      return () => list.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** The `lg` breakpoint from Tailwind, used to switch the auth layout. */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");
