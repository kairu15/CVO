import { api, unwrap } from "./client";

/**
 * Public (unauthenticated) veterinary announcements for the landing page's
 * announcements block — published rows only, pinned first, newest first.
 * `limit` bounds the slice (the backend caps it at 20).
 */
export const publicAnnouncementsApi = {
  list: async (limit = 3) =>
    unwrap.list(await api.get("/api/v1/public/announcements", { params: { limit } })),
};
