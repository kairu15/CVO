import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Livestock monthly monitoring records.
 *
 * Every response row already carries the beneficiary identity fields
 * (name_of_farmer, address, animal_type, sex) alongside the visit fields, so
 * the monitoring table never needs a second fetch.
 *
 * Every method returns already-unwrapped data (see `unwrap` in client.js).
 */

export const monitoringApi = {
  /** Role-scoped list — scoping is enforced server-side. Always an array. */
  list: async (params = {}) => unwrap.list(await api.get("/api/v1/monitoring-records", { params })),

  get: async (id) => unwrap(await api.get(`/api/v1/monitoring-records/${id}`)),

  /** Technician only, for their assigned beneficiaries. */
  create: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/monitoring-records", payload));
  },

  /** Technician (own entries) / doctor / admin. */
  update: async (id, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/monitoring-records/${id}`, payload));
  },

  remove: async (id) => {
    await ensureCsrfCookie();
    return unwrap(await api.delete(`/api/v1/monitoring-records/${id}`));
  },

  /** Admin accepts a registration-created record (starts the midnight countdown). */
  acceptRegistration: async (id) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/monitoring-records/${id}/accept`));
  },
};
