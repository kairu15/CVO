import { api, unwrap } from "./client";

/**
 * Public (unauthenticated) program statistics for the landing page map.
 *
 * Aggregate-only by design — per-barangay counts on fixed barangay
 * centroids and program totals. No farmer names, no exact farm coordinates;
 * the backend test PublicMapSummaryTest enforces that boundary.
 */
export const publicMapApi = {
  summary: async () =>
    unwrap(await api.get("/api/v1/public/map-summary")),
};
