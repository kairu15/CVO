import { api, unwrap } from "./client";

/**
 * Vaccination schedule.
 *
 * Read-only and derived: the API computes each animal's next due date from the
 * last vaccination recorded on its monitoring records, so there is nothing to
 * create or update here — recording a vaccination is done by logging a visit
 * (see monitoringApi).
 *
 * Returns already-unwrapped data (see `unwrap` in client.js).
 */

export const vaccinationApi = {
  /**
   * Role-scoped schedule, most urgent first.
   *
   * @param {object} [params]
   * @param {"never"|"overdue"|"due-soon"|"scheduled"} [params.status] filter
   * @param {number} [params.per_page] up to 200
   */
  schedule: async (params = {}) =>
    unwrap.list(await api.get("/api/v1/vaccination-schedule", { params })),
};
