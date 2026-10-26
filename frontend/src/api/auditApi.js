import { api, unwrap } from "./client";

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
    unwrap.page(await api.get("/api/v1/admin/activity-logs", { params })),

  /**
   * The filter vocabulary for the page in one request: the action list the
   * server validates writes against, the entity types present in the log so
   * far, and the accounts that appear as actors.
   */
  filters: async () => unwrap(await api.get("/api/v1/admin/activity-logs/actions")),
};
