import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Clinical health records — technician-authored diagnoses and treatments.
 *
 * Every response row carries the beneficiary identity fields plus the
 * author's name and derived follow-up state, so the table never needs a
 * second fetch. Scoping and filtering are enforced server-side.
 */
export const healthRecordsApi = {
  list: async (params = {}) =>
    unwrap.page(await api.get("/api/v1/health-records", { params })),

  /** Overview cards and follow-up counters in one scoped aggregate. */
  summary: async () => unwrap(await api.get("/api/v1/health-records/summary")),

  /** One record plus the beneficiary's chronological examination history. */
  get: async (id) => unwrap(await api.get(`/api/v1/health-records/${id}`)),

  options: async () => unwrap(await api.get("/api/v1/health-records/options")),

  create: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/health-records", payload));
  },

  update: async (id, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/health-records/${id}`, payload));
  },

  remove: async (id) => {
    await ensureCsrfCookie();
    return unwrap(await api.delete(`/api/v1/health-records/${id}`));
  },

  /** One supporting clinical photo; a new upload replaces the previous one. */
  uploadPhoto: async (id, file) => {
    await ensureCsrfCookie();
    const body = new FormData();
    body.append("image", file);

    return unwrap(
      await api.post(`/api/v1/health-records/${id}/photo`, body, {
        timeout: 60_000,
      }),
    );
  },

  bulkRemove: async (ids) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/health-records/bulk-delete", { ids }));
  },
};
