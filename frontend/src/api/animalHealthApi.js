import { api, unwrap } from "./client";

/**
 * Animal health monitoring — a read-only rollup over records that already
 * exist (visits, clinical events, case notes) plus the derived vaccination
 * state. Nothing to create or update here: each fact is recorded on the module
 * that owns it.
 *
 * Returns already-unwrapped data (see `unwrap` in client.js).
 */

export const animalHealthApi = {
  /**
   * Role-scoped rollup, most urgent first.
   *
   * @param {object} [params]
   * @param {"attention"} [params.filter] narrow to animals with an overdue or
   *   missing vaccination, or at least one open case
   * @param {number} [params.per_page] up to 200
   */
  list: async (params = {}) =>
    unwrap.list(await api.get("/api/v1/animal-health", { params })),
};
