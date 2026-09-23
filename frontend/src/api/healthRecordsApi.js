import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Clinical health records — veterinarian-authored diagnoses and treatments.
 *
 * Separate from `monitoringApi`: those rows are the monthly CVO reporting
 * workbook, these are clinical entries. Every response row already carries the
 * beneficiary identity fields (name_of_farmer, address, animal_type, sex) plus
 * the authoring vet, so the table never needs a second fetch.
 *
 * Every method returns already-unwrapped data (see `unwrap` in client.js).
 */

export const healthRecordsApi = {
  /** Role-scoped list — scoping is enforced server-side. Always an array. */
  list: async (params = {}) =>
    unwrap.list(await api.get("/api/v1/health-records", { params })),

  get: async (id) => unwrap(await api.get(`/api/v1/health-records/${id}`)),

  /**
   * The outcome vocabulary the server validates against, so the dropdown
   * cannot drift from the rule that rejects an unknown value.
   */
  options: async () => unwrap(await api.get("/api/v1/health-records/options")),

  /** Veterinarian only. */
  create: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/health-records", payload));
  },

  /** Authoring veterinarian or administrator. */
  update: async (id, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/health-records/${id}`, payload));
  },

  remove: async (id) => {
    await ensureCsrfCookie();
    return unwrap(await api.delete(`/api/v1/health-records/${id}`));
  },
};
