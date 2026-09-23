import { api, unwrap } from "./client";

/**
 * Notifications — a read-only feed derived from dispersal and vaccination
 * records. There is nothing to create, update or mark as read: an alert
 * disappears when the record it describes is recorded.
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
};
