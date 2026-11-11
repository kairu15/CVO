import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Admin CRUD for veterinary announcements (permission: manage_settings
 * server-side). The `published` flag is the form's single draft/live switch —
 * the backend maps it to published_at.
 */
export const announcementsApi = {
  list: async () => unwrap.list(await api.get("/api/v1/admin/announcements")),

  create: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/admin/announcements", payload));
  },

  update: async (id, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/admin/announcements/${id}`, payload));
  },

  remove: async (id) => {
    await ensureCsrfCookie();
    await api.delete(`/api/v1/admin/announcements/${id}`);
  },
};
