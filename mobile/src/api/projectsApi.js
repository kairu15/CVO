import { api } from "./client";
import { unwrap } from "./unwrap";

export const projectsApi = {
  list: async (page = 1) => unwrap(await api.get("/api/v1/projects", { params: { page } })),

  create: (payload) => api.post("/api/v1/projects", payload),

  update: (id, payload) => api.put(`/api/v1/projects/${id}`, payload),

  remove: (id) => api.delete(`/api/v1/projects/${id}`),
};
