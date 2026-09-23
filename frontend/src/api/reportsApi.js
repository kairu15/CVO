import { api } from "./client";

/**
 * City-wide program report — admin-only, read-only. The endpoint aggregates
 * the existing tables; nothing here creates or edits anything.
 */

export const reportsApi = {
  /**
   * @param {object} [params]
   * @param {string} [params.barangay]  Narrow every section to one barangay.
   * @param {string} [params.from]      ISO date; adds a `dispersals_since` counter.
   * @returns {Promise<{scope: object, program: object, activity: object,
   *   clinical: object, per_barangay: Array<object>, trend: Array<object>}>}
   */
  cityWide: async (params = {}) => {
    const response = await api.get("/api/v1/admin/report", { params });

    return response.data?.data ?? {};
  },
};
