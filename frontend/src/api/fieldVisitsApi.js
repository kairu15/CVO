import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Technician field visits — the trip itself.
 *
 * Distinct from monitoringApi: a monitoring record captures animal condition,
 * a field visit records that the technician went out (where, when, why, and an
 * optional on-site GPS fix). A trip can produce no monitoring record at all.
 *
 * Every method returns already-unwrapped data (see `unwrap` in client.js).
 */

export const fieldVisitsApi = {
  /** Role-scoped list — scoping is enforced server-side. Always an array. */
  list: async (params = {}) =>
    unwrap.list(await api.get("/api/v1/field-visits", { params })),

  get: async (id) => unwrap(await api.get(`/api/v1/field-visits/${id}`)),

  /**
   * The purpose vocabulary the server validates against, so the dropdown
   * cannot drift from the rule that rejects an unknown value.
   */
  options: async () => unwrap(await api.get("/api/v1/field-visits/options")),

  /** Technician only. */
  create: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/field-visits", payload));
  },

  /** The visiting technician or an administrator. */
  update: async (id, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/field-visits/${id}`, payload));
  },

  remove: async (id) => {
    await ensureCsrfCookie();
    return unwrap(await api.delete(`/api/v1/field-visits/${id}`));
  },
};
