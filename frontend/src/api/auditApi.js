import { API_BASE, api, unwrap } from "./client";

/**
 * The system-wide audit trail — READ-ONLY by design.
 *
 * There is deliberately no write method here (and no write route on the
 * server): rows are appended by App\Services\AuditLogger and the models'
 * Auditable trait, and the API exposes them only for reading.
 *
 * Every method returns already-unwrapped data (see `unwrap` in client.js);
 * `list` resolves to `{ data, meta }` so the table can render its footer.
 */
export const auditApi = {
  /**
   * One page of audit rows, newest first.
   *
   * Supported filters: action, actor_id, target_type, date_from, date_to,
   * search, per_page — all applied in SQL, never by slicing a fetched list.
   *
   * @param {Record<string, string|number|undefined>} params
   * @returns {Promise<{data: Array<object>, meta: object|null}>}
   */
  list: async (params = {}) =>
    unwrap.page(
      await api.get("/api/v1/admin/activity-logs", {
        params: { ...params, summary: 1 },
      }),
    ),

  /** One entry with its full before/after values and context, for the drawer. */
  get: async (id) => unwrap(await api.get(`/api/v1/admin/activity-logs/${id}`)),

  /**
   * Overview figures for the active filters, plus the last-24-hour security
   * snapshot. One request drives every card on the page.
   */
  summary: async (params = {}) =>
    unwrap(await api.get("/api/v1/admin/activity-logs/summary", { params })),

  /**
   * The filter vocabulary for the page in one request: the action list the
   * server validates writes against, the entity types present in the log so
   * far, the accounts that appear as actors, and the grouping/status lists.
   */
  filters: async () => unwrap(await api.get("/api/v1/admin/activity-logs/actions")),

  /**
   * Download link for the current filters. Same parameters as `list`, so the
   * CSV always matches the rows on screen. The server streams it and writes
   * its own audit entry for the export.
   */
  exportUrl: (params = {}) => {
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== "" && value !== false) {
        query.set(key, String(value));
      }
    }

    const qs = query.toString();
    return `${API_BASE}/api/v1/admin/activity-logs/export${qs ? `?${qs}` : ""}`;
  },
};
