import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Rule-Based Health Concern Hints — the keyword rule table.
 *
 * Two surfaces:
 *  - `active()` is read by the case-note and health-record entry forms. The
 *    whole table is shipped so matching happens in the browser, with no
 *    request per keystroke.
 *  - the CRUD methods are admin-only, backing the System Settings editor.
 *
 * This is a lookup table, not a model. The UI must always label the hints as
 * decision support, never a diagnosis.
 *
 * Every method returns already-unwrapped data (see `unwrap` in client.js).
 */

export const symptomRulesApi = {
  /** Active rules for the entry forms, in display order. */
  active: async () => unwrap.list(await api.get("/api/v1/symptom-rules")),

  /** Every rule, retired ones included — the admin editor. */
  list: async () => unwrap.list(await api.get("/api/v1/admin/symptom-rules")),

  create: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/admin/symptom-rules", payload));
  },

  update: async (id, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/admin/symptom-rules/${id}`, payload));
  },

  remove: async (id) => {
    await ensureCsrfCookie();
    return unwrap(await api.delete(`/api/v1/admin/symptom-rules/${id}`));
  },
};
