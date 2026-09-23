import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Freeform veterinary case notes.
 *
 * A dated observation with no diagnosis attached — if a note is really a
 * diagnosis, it belongs in Health Records instead (see healthRecordsApi), or
 * the animal's clinical history ends up split across two screens.
 *
 * Every method returns already-unwrapped data (see `unwrap` in client.js).
 */

export const caseNotesApi = {
  /** Role-scoped list — scoping is enforced server-side. Always an array. */
  list: async (params = {}) =>
    unwrap.list(await api.get("/api/v1/case-notes", { params })),

  get: async (id) => unwrap(await api.get(`/api/v1/case-notes/${id}`)),

  /** Veterinarian only. */
  create: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/case-notes", payload));
  },

  /** Authoring veterinarian or administrator. */
  update: async (id, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/case-notes/${id}`, payload));
  },

  remove: async (id) => {
    await ensureCsrfCookie();
    return unwrap(await api.delete(`/api/v1/case-notes/${id}`));
  },
};
