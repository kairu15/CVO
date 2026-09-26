import { useEffect } from "react";
import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationsApi } from "./notificationsApi";
import { monitoringApi } from "./monitoringApi";
import { beneficiariesApi } from "./beneficiariesApi";

/**
 * Live data, the polling way.
 *
 * One shared QueryClient; the hooks below re-fetch on an interval AND when
 * the browser tab regains focus. Polling pauses while the tab is hidden —
 * React Query only runs refetchInterval on visible windows, so a background
 * tab stops hammering the server instead of polling into the void.
 *
 * Intervals, chosen per data type:
 *  - notifications (badge + feed): 15s — the live pulse; cheap endpoint.
 *  - monitoring records:           20s — rows change when others act;
 *    20s feels current without 4 requests a minute.
 *  - technician's beneficiary list: 30s — assignments change rarely.
 *  - barangay/purok reference lists: never — they are constants, polled
 *    data would be 100% waste.
 * Everything also refetches on window focus, so switching back to the tab
 * is always current even mid-interval.
 */

export const POLL_INTERVALS = {
  notifications: 15_000,
  monitoring: 20_000,
  beneficiaries: 30_000,
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry: 1,
      staleTime: 5_000,
    },
  },
});

/** The unread count behind the bell badge. */
export function useUnreadNotificationsCount(enabled = true) {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () => {
      const response = await notificationsApi.unreadCount();
      return response.data?.unread ?? 0;
    },
    refetchInterval: POLL_INTERVALS.notifications,
    enabled,
  });
}

/** The full feed (stored events + derived alerts), polled. */
export function useNotificationsFeed(limit = 20) {
  return useQuery({
    queryKey: ["notifications", "feed", limit],
    queryFn: () => notificationsApi.list({ limit }),
    refetchInterval: POLL_INTERVALS.notifications,
  });
}

/** Role-scoped monitoring records, polled. */
export function useMonitoringRecords(enabled = true) {
  return useQuery({
    queryKey: ["monitoring-records"],
    queryFn: () => monitoringApi.list({ per_page: 100 }),
    refetchInterval: POLL_INTERVALS.monitoring,
    enabled,
  });
}

/** The technician's assigned beneficiaries, polled. */
export function useAssignedBeneficiaries(enabled = true) {
  return useQuery({
    queryKey: ["beneficiaries", "assigned"],
    queryFn: () => beneficiariesApi.list({ per_page: 100 }),
    refetchInterval: POLL_INTERVALS.beneficiaries,
    enabled,
  });
}/** Imperative helpers for post-mutation refreshes (accept, mark-read…). */
export function useInvalidate() {
  const client = useQueryClient();

  return {
    notifications: () => {
      client.invalidateQueries({ queryKey: ["notifications"] });
    },
    monitoring: () => {
      client.invalidateQueries({ queryKey: ["monitoring-records"] });
    },
  };
}

/** How often legacy (non-React-Query) pages quietly re-fetch in the background. */
export const AUTO_REFRESH_INTERVAL = 30_000;

/**
 * Auto-refresh for the pages that still load data the plain way (local state
 * + a `load()` callback) instead of through React Query. Re-runs `load(true)`
 * on an interval and when the tab regains focus, so rows imported, accepted
 * or logged by other users show up without a manual reload.
 *
 * `load` receives a `quiet` flag: pages use it to skip the skeleton flash and
 * only clear errors when it is a background refresh (`load(false)` stays the
 * loud, first/mutation refresh). Polling pauses while the tab is hidden, and
 * `load` identity changes (filter/search edits) restart the timer.
 */
export function useAutoRefresh(load, { enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;

    const intervalId = setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, AUTO_REFRESH_INTERVAL);

    const onVisible = () => {
      if (document.visibilityState === "visible") load(true);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, enabled]);
}

