import { api } from "./client";

export const projectsApi = {
  list: (page = 1) => api.get("/api/v1/projects", { params: { page } }),

  create: (payload) => api.post("/api/v1/projects", payload),

  update: (id, payload) => api.put(`/api/v1/projects/${id}`, payload),

  remove: (id) => api.delete(`/api/v1/projects/${id}`),
};
