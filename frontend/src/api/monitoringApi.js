import { api } from "./client";

/**
 * Livestock monthly monitoring records.
 *
 * Every response row already carries the beneficiary identity fields
 * (name_of_farmer, address, animal_type, sex) alongside the visit fields, so
 * the monitoring table never needs a second fetch.
 */

const ensureCsrfCookie = () => api.get("/sanctum/csrf-cookie");

export const monitoringApi = {
  /** Role-scoped list — scoping is enforced server-side. */
  list: (params = {}) => api.get("/api/v1/monitoring-records", { params }),

  get: (id) => api.get(`/api/v1/monitoring-records/${id}`),

  /** Technician only, for their assigned beneficiaries. */
  create: async (payload) => {
    await ensureCsrfCookie();
    return api.post("/api/v1/monitoring-records", payload);
  },

  /** Technician (own entries) / doctor / admin. */
  update: async (id, payload) => {
    await ensureCsrfCookie();
    return api.patch(`/api/v1/monitoring-records/${id}`, payload);
  },

  remove: async (id) => {
    await ensureCsrfCookie();
    return api.delete(`/api/v1/monitoring-records/${id}`);
  },
};
