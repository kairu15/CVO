import { api, unwrap } from "./client";

/**
 * Public (unauthenticated) program transparency statistics for the
 * `/transparency` dashboard.
 *
 * Aggregate-only by design — city totals, per-barangay counts, a monthly
 * reach trend and vaccination compliance. No farmer names, no household/animal
 * ids, no exact farm coordinates; the backend test PublicTransparencyTest
 * enforces that boundary.
 */
export const publicTransparencyApi = {
  summary: async () =>
    unwrap(await api.get("/api/v1/public/transparency")),
};
