import { api, ensureCsrfCookie } from "./client";

/**
 * System settings — admin-only.
 *
 * Three groups, one save: the office contact profile, the vaccination cycle
 * thresholds, and the SPA's inactivity window. The barangay list, the form
 * vocabularies and the server's own session ceilings come back read-only (they
 * are program configuration or framework-enforced), so this module only mirrors
 * the server's stance.
 */

export const settingsApi = {
  /**
   * @returns {Promise<{office_profile: object, alerts: object, session: object, barangays: string[], vocabulary: object}>}
   */
  get: async () => {
    const response = await api.get("/api/v1/admin/settings");

    return response.data?.data ?? {};
  },

  /**
   * Save any subset of the writable settings: the four office contact fields,
   * the two vaccination thresholds, and the inactivity window.
   *
   * Anything else (barangays included) is a validation error server-side — it
   * is not silently dropped.
   *
   * @param {Partial<{office_email: string, office_phone: string, office_hours: string, office_address: string, vaccination_interval_days: number, vaccination_due_soon_days: number, session_idle_minutes: number}>} values
   * @returns {Promise<{office_profile: object, alerts: object, session: object, barangays: string[], vocabulary: object}>}
   */
  save: async (values) => {
    await ensureCsrfCookie();
    const response = await api.patch("/api/v1/admin/settings", values);

    return response.data?.data ?? {};
  },
};
