import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Offline sync conflicts.
 *
 * The client detects a conflict and reports the technician's decision here so
 * it becomes part of the program's record — the server only logs it (it does
 * not merge or re-apply; the queue owns the payload).
 *
 * Every method returns already-unwrapped data (see `unwrap` in client.js).
 */
export const syncApi = {
  /** Log one conflict resolution; the row is stamped with the caller server-side. */
  logConflict: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/sync/conflicts", payload));
  },

  /** Admin audit view of every logged conflict, newest first. */
  conflicts: async (params = {}) =>
    unwrap.page(await api.get("/api/v1/admin/sync-conflicts", { params })),
};
