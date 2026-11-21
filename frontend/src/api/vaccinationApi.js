import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Vaccination schedule and completed-dose history.
 *
 * Schedule rows roll up the latest completed vaccination (new history table or
 * the legacy monitoring date) and the household's next-due override. All
 * scoping and filtering happen server-side.
 */
export const vaccinationApi = {
  schedule: async (params = {}) =>
    unwrap.page(await api.get("/api/v1/vaccination-schedule", { params })),

  summary: async () => unwrap(await api.get("/api/v1/vaccination-schedule/summary")),

  /** Protocol default and vaccine names already present in the data. */
  options: async () => unwrap(await api.get("/api/v1/vaccination-schedule/options")),

  /** One household's completed vaccination history. */
  history: async (beneficiaryId) =>
    unwrap.list(await api.get(`/api/v1/beneficiaries/${beneficiaryId}/vaccinations`)),

  create: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/vaccinations", payload));
  },

  /** Move the next-dose date without editing a historical administration. */
  reschedule: async (beneficiaryId, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/vaccination-schedule/${beneficiaryId}/reschedule`, payload));
  },

  /** One private supporting photo; a new upload replaces the previous one. */
  uploadPhoto: async (id, file) => {
    await ensureCsrfCookie();
    const body = new FormData();
    body.append("image", file);

    return unwrap(
      await api.post(`/api/v1/vaccinations/${id}/photo`, body, { timeout: 60_000 }),
    );
  },
};
