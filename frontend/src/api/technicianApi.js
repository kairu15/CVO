import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * The technician's task dashboard and the scheduled visits behind it.
 *
 * A plan is not a field visit: it is work to do. Completing it links the plan
 * to the visit created by the existing field-visit form.
 */
export const technicianApi = {
  dashboard: async (signal) =>
    unwrap(await api.get("/api/v1/technician/dashboard", { signal })),

  createPlan: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/technician/visit-plans", payload));
  },

  updatePlan: async (id, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/technician/visit-plans/${id}`, payload));
  },
};
