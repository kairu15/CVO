import { api } from "./client";

/**
 * Beneficiaries — the dispersed animals and their households.
 *
 * The identity fields (name_of_farmer, address, animal_type, sex) live here
 * and are read-only everywhere in the UI: they are captured once, at
 * registration, and every monitoring record auto-fills from them.
 */

const ensureCsrfCookie = () => api.get("/sanctum/csrf-cookie");

export const beneficiariesApi = {
  /** Role-scoped: admin/doctor see all, technician sees assigned, farmer sees own. */
  list: (params = {}) => api.get("/api/v1/beneficiaries", { params }),

  get: (id) => api.get(`/api/v1/beneficiaries/${id}`),

  create: async (payload) => {
    await ensureCsrfCookie();
    return api.post("/api/v1/beneficiaries", payload);
  },

  update: async (id, payload) => {
    await ensureCsrfCookie();
    return api.put(`/api/v1/beneficiaries/${id}`, payload);
  },

  remove: async (id) => {
    await ensureCsrfCookie();
    return api.delete(`/api/v1/beneficiaries/${id}`);
  },
};
