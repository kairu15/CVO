import { api, unwrap } from "./client";

/**
 * Notifications — a feed of derived alerts (dispersal / vaccination) plus the
 * caller's stored event notifications.
 *
 * Derived alerts have no read state: one disappears when the record it
 * describes is recorded. Stored events carry read state, which is what the
 * bell badge counts — opening an event marks just that one read, and
 * read-all clears the rest.
 *
 * The endpoint answers with the alerts *and* the counts across the whole feed,
 * so a capped page still reports how much sits behind it. Both are returned
 * together so the header bell and this page can never disagree.
 */

export const notificationsApi = {
  /**
   * The caller's own feed, most needing action first.
   *
   * @param {object} [params]
   * @param {number} [params.limit] 1–50, how many alerts to return
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

  /** Mark every stored event notification read for the caller. */
  markAllRead: async () => {
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
    const response = await api.post(`/api/v1/notifications/${id}/read`);

    return response.data;
  },
};
