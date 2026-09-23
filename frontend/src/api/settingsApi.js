import { api } from "./client";

/**
 * System settings — admin-only. The office contact profile is writable; the
 * barangay list and vocabularies come back read-only (they are program
 * configuration, not data), so this module only mirrors the server's stance.
 */

export const settingsApi = {
  /**
   * @returns {Promise<{office_profile: object, barangays: string[], vocabulary: object}>}
   */
  get: async () => {
    const response = await api.get("/api/v1/admin/settings");

    return response.data?.data ?? {};
  },

  /**
   * Save the office contact profile. Only the four profile keys are accepted
   * by the API; anything else (barangays included) is a validation error.
   *
   * @param {Partial<{office_email: string, office_phone: string, office_hours: string, office_address: string}>} values
   * @returns {Promise<{office_profile: object, barangays: string[], vocabulary: object}>}
   */
  saveProfile: async (values) => {
    const response = await api.patch("/api/v1/admin/settings", values);

    return response.data?.data ?? {};
  },
};
