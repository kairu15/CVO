import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Notifications — the caller's stored event feed plus derived dispersal /
 * vaccination alerts.
 *
 * Stored events support server-side status/category/priority/search/date
 * filters and own their read/archive state. Derived alerts are read-only: they
 * disappear when the record they describe is recorded.
 */

export const notificationsApi = {
  /**
   * The caller's own feed, most needing action first.
   *
   * @param {object} [params]
   * @param {number} [params.limit] 1–50, how many alerts to return
   * @param {string} [params.status] all | unread | read | archived
   * @param {string} [params.category] one of UserNotification::CATEGORIES
   * @param {string} [params.priority] critical | high | normal | low
   * @param {string} [params.search]
   * @param {string} [params.from] YYYY-MM-DD
   * @param {string} [params.to] YYYY-MM-DD
   * @returns {Promise<{alerts: Array<object>, counts: object}>}
   */
  list: async (params = {}) => {
    const response = await api.get("/api/v1/notifications", { params });

    return {
      alerts: unwrap.list(response),
      // `meta` is the counts envelope; absent on a bare `{ data: [] }`.
      counts: response.data?.meta ?? {},
    };
  },

  /** Unread stored-event count — the bell badge number. */
  unreadCount: async () => {
    const response = await api.get("/api/v1/notifications/unread-count");

    return response.data;
  },

  /** Mark every active stored event notification read for the caller. */
  markAllRead: async () => {
    await ensureCsrfCookie();
    const response = await api.post("/api/v1/notifications/read-all");

    return response.data;
  },

  /**
   * Mark one stored event notification read — fired when its row is opened.
   *
   * @param {number} id the notification's numeric id (the feed exposes it as
   *   `event-{id}`)
   */
  markRead: async (id) => {
    await ensureCsrfCookie();
    const response = await api.post(`/api/v1/notifications/${id}/read`);

    return response.data;
  },

  /**
   * Apply one action to many of the caller's own notifications.
   *
   * @param {number[]} ids
   * @param {"read"|"unread"|"archive"|"unarchive"|"delete"} action
   */
  bulk: async (ids, action) => {
    await ensureCsrfCookie();
    const response = await api.post("/api/v1/notifications/bulk", { ids, action });

    return response.data;
  },

  /** The caller's category switches. */
  preferences: async () => {
    const response = await api.get("/api/v1/notifications/preferences");

    return response.data?.data ?? { preferences: {}, categories: [] };
  },

  /** Save the caller's category switches. */
  updatePreferences: async (preferences) => {
    await ensureCsrfCookie();
    const response = await api.patch("/api/v1/notifications/preferences", { preferences });

    return response.data?.data ?? { preferences: {}, categories: [] };
  },
};
