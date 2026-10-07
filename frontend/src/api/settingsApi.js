import { api, ensureCsrfCookie } from "./client";

/**
 * System settings — admin-only.
 *
 * Writable groups: the office contact profile, the alert thresholds
 * (vaccination cycle + field-visit window), the SPA's inactivity window,
 * the suggested animal-type vocabulary, and the notification preferences
 * (one notify_* switch per stored event type and smart-alert rule).
 *
 * The barangay/purok reference data comes back read-only here (with ids and
 * puroks) — it is managed through the dedicated endpoints in adminApi, not by
 * PATCHing the settings payload; the form vocabularies and the server's own
 * session ceilings are framework/program configuration and stay read-only.
 */

export const settingsApi = {
  /**
   * @returns {Promise<{office_profile: object, alerts: object, session: object, animal_types: string[], notifications: object, barangays: object[], vocabulary: object}>}
   */
  get: async () => {
    const response = await api.get("/api/v1/admin/settings");

    return response.data?.data ?? {};
  },

  /**
   * Save any subset of the writable settings.
   *
   * `animal_types` is a list (stored as JSON); the `notify_*` keys are
   * booleans. Anything else (barangays included) is a validation error
   * server-side — it is not silently dropped.
   *
   * @param {Record<string, string|number|boolean|string[]>} values
   * @returns {Promise<{office_profile: object, alerts: object, session: object, animal_types: string[], notifications: object, barangays: object[], vocabulary: object}>}
   */
  save: async (values) => {
    await ensureCsrfCookie();
    const response = await api.patch("/api/v1/admin/settings", values);

    return response.data?.data ?? {};
  },
};
