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
  /**
   * Role-scoped list — scoping is enforced server-side. Resolves to the
   * full paginated envelope ({ data, meta }) so the month filter's real
   * total and page controls survive the unwrap; use `list`'s rows via
   * `envelope.data`.
   */
  list: async (params = {}) => {
    const response = await api.get("/api/v1/monitoring-records", { params });
    const body = response?.data;

    return {
      data: Array.isArray(body?.data) ? body.data : [],
      meta: body?.meta ?? null,
    };
  },

  /**
   * The months that actually have records ("YYYY-MM" strings), scoped to
   * the caller and sorted oldest → newest — the month/year tab list.
   */
  months: async () => {
    const response = await api.get("/api/v1/monitoring-records/months");
    return Array.isArray(response?.data?.data) ? response.data.data : [];
  },

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

  /**
   * Delete many records in one request. Resolves to { deleted, failed_ids }
   * so the UI can report rows that were already gone or not the caller's.
   */
  bulkRemove: async (ids) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/monitoring-records/bulk-delete", { ids }));
  },

  /** Admin accepts a registration-created record (starts the midnight countdown). */
  acceptRegistration: async (id) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/monitoring-records/${id}/accept`));
  },
};
