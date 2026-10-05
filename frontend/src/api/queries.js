import { useEffect } from "react";
import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationsApi } from "./notificationsApi";
import { monitoringApi } from "./monitoringApi";
import { beneficiariesApi } from "./beneficiariesApi";
import { symptomRulesApi } from "./symptomRulesApi";

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

/**
 * The notification feed, polled.
 *
 * `filter` is "all" (stored events + derived alerts) or "smart" (the daily
 * rule-based flags only). The filter is a SERVER-side query parameter so a
 * capped page still reports the true counts for the selected set.
 */
export function useNotificationsFeed(limit = 20, filter = "all") {
  return useQuery({
    queryKey: ["notifications", "feed", limit, filter],
    queryFn: () =>
      notificationsApi.list({
        limit,
        ...(filter !== "all" ? { filter } : {}),
      }),
    refetchInterval: POLL_INTERVALS.notifications,
  });
}

/**
 * Role-scoped monitoring records, polled, optionally bucketed to one month
 * and/or narrowed to a farmer name.
 *
 * The month filter and the name search are SERVER-side query parameters —
 * filtering an already paginated fetch client-side is how a month tab ends
 * up showing a slice of a month (or a search hiding every match on a later
 * page). `month` is "YYYY-MM" or null (all records); `search` is the raw
 * farmer-name term or ""; `page` paginates within the current selection.
 */
export function useMonitoringRecords(
  month = null,
  page = 1,
  search = "",
  animalType = null,
  sort = "date",
  enabled = true,
) {
  return useQuery({
    queryKey: ["monitoring-records", { month, page, search, animalType, sort }],
    queryFn: () =>
      monitoringApi.list({
        per_page: 100,
        ...(month ? { month } : {}),
        ...(search ? { search } : {}),
        ...(animalType ? { animal_type: animalType } : {}),
        sort,
        page,
      }),
    refetchInterval: POLL_INTERVALS.monitoring,
    enabled,
    // Switching months paginates through different row sets; without this
    // React Query would render the previous month's rows for one tick.
    placeholderData: (previous) => previous,
  });
}

/** The distinct months with records, oldest → newest — the tab list. */
export function useMonitoringMonths(enabled = true) {
  return useQuery({
    queryKey: ["monitoring-records", "months"],
    queryFn: () => monitoringApi.months(),
    refetchInterval: POLL_INTERVALS.monitoring,
    enabled,
  });
}

/**
 * The distinct animal types present in the records, alphabetical — the
 * animal-type filter's options. Only types with data appear, and the list is
 * refreshed by the same invalidation as the records, so an import's new types
 * show up immediately.
 */
export function useMonitoringAnimalTypes(enabled = true) {
  return useQuery({
    queryKey: ["monitoring-records", "animal-types"],
    queryFn: () => monitoringApi.animalTypes(),
    refetchInterval: POLL_INTERVALS.monitoring,
    enabled,
  });
}

/**
 * The active health-concern hint rules — matched in the browser while a
 * doctor types, so this is NOT polled: the table is small reference data an
 * admin edits rarely, and the form only needs it once per open.
 */
export function useSymptomRules(enabled = true) {
  return useQuery({
    queryKey: ["symptom-rules", "active"],
    queryFn: () => symptomRulesApi.active(),
    staleTime: 5 * 60_000,
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
    // The technician's assigned-farmer picker and every beneficiary-derived
    // view. Needed after a farmer delete, which removes them everywhere —
    // not only from the monitoring table the admin clicked in.
    beneficiaries: () => {
      client.invalidateQueries({ queryKey: ["beneficiaries"] });
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

