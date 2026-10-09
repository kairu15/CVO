import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Technician field visits — the trip itself.
 *
 * Distinct from monitoringApi: a monitoring record captures animal condition,
 * a field visit records that the technician went out (where, when, why, and an
 * optional on-site GPS fix). A trip can produce no monitoring record at all.
 *
 * Every method returns already-unwrapped data (see `unwrap` in client.js).
 */

export const fieldVisitsApi = {
  /**
   * Role-scoped page — scoping is enforced server-side. Resolves to the
   * paginated envelope `{ data, meta }` (see `unwrap.page`).
   */
  list: async (params = {}) =>
    unwrap.page(await api.get("/api/v1/field-visits", { params })),

  get: async (id) => unwrap(await api.get(`/api/v1/field-visits/${id}`)),

  /**
   * The purpose vocabulary the server validates against, so the dropdown
   * cannot drift from the rule that rejects an unknown value.
   */
  options: async () => unwrap(await api.get("/api/v1/field-visits/options")),

  /** Technician only. */
  create: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/field-visits", payload));
  },

  /** The visiting technician or an administrator. */
  update: async (id, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/field-visits/${id}`, payload));
  },

  remove: async (id) => {
    await ensureCsrfCookie();
    return unwrap(await api.delete(`/api/v1/field-visits/${id}`));
  },

  /** Delete many field visits in one request → { deleted, failed_ids }. */
  bulkRemove: async (ids) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/field-visits/bulk-delete", { ids }));
  },

  /**
   * Attach the geotagged photo to a visit (a retake replaces). `meta` is the
   * structured capture metadata — sent as real columns, not read back out of
   * the pixels.
   */
  uploadPhoto: async (id, blob, meta) => {
    await ensureCsrfCookie();

    const form = new FormData();
    form.append("image", blob, "field-visit.jpg");
    for (const [key, value] of Object.entries(meta)) {
      if (value !== null && value !== undefined) form.append(key, String(value));
    }

    return unwrap(
      await api.post(`/api/v1/field-visits/${id}/photo`, form, {
        headers: { "Content-Type": "multipart/form-data" },
        // The composited geotagged image is megabytes on a rural uplink — give
        // it room beyond the client's default 30s dead-socket timeout, which
        // exists to catch unreachable hosts, not slow uploads.
        timeout: 120_000,
      }),
    );
  },

  /** Remove the visit's photo. */
  removePhoto: async (id) => {
    await ensureCsrfCookie();
    return unwrap(await api.delete(`/api/v1/field-visits/${id}/photo`));
  },
};
