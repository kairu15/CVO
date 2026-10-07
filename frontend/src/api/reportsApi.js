import { api } from "./client";

/**
 * City-wide program report — admin-only, read-only. The endpoint aggregates
 * the existing tables; nothing here creates or edits anything.
 *
 * The chart functions hit one dedicated aggregation endpoint EACH — the
 * database computes the aggregate, this layer never counts rows.
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

  /**
   * Chart 1 — dispersal trend over time: monthly counts, oldest first,
   * zero-filled. Filters: barangay, animal_type, from/to (ISO dates).
   * @returns {Promise<Array<{month: string, label: string, dispersals: number, re_dispersals: number}>>}
   */
  dispersalTrend: async (params = {}) => {
    const response = await api.get("/api/v1/admin/report/charts/dispersal-trend", { params });
    return response.data?.data ?? [];
  },

  /**
   * Chart 2 — animals dispersed by barangay (every covered barangay appears,
   * zero-filled). Filters: animal_type, from/to.
   * @returns {Promise<Array<{barangay: string, dispersals: number, re_dispersals: number}>>}
   */
  animalsByBarangay: async (params = {}) => {
    const response = await api.get("/api/v1/admin/report/charts/animals-by-barangay", { params });
    return response.data?.data ?? [];
  },

  /**
   * Chart 3 — vaccination compliance over time: share of registered animals
   * whose vaccination is inside the cycle at each month end. `rate` is null
   * when nothing was registered yet. Filters: barangay, animal_type.
   * @returns {Promise<Array<{month: string, label: string, total: number, compliant: number, rate: number|null}>>}
   */
  vaccinationCompliance: async (params = {}) => {
    const response = await api.get("/api/v1/admin/report/charts/vaccination-compliance", { params });
    return response.data?.data ?? [];
  },

  /**
   * Chart 4 — animal type distribution (donut) over monitoring records.
   * Filters: month ("YYYY-MM"), from/to — the Monitoring Records filters.
   * @returns {Promise<Array<{animal_type: string, animals: number}>>}
   */
  animalTypeDistribution: async (params = {}) => {
    const response = await api.get("/api/v1/admin/report/charts/animal-type-distribution", { params });
    return response.data?.data ?? [];
  },

  /**
   * Chart 5 — technician workload: active households per technician,
   * zero-filled. Filter: barangay.
   * @returns {Promise<Array<{technician: string, households: number}>>}
   */
  technicianWorkload: async (params = {}) => {
    const response = await api.get("/api/v1/admin/report/charts/technician-workload", { params });
    return response.data?.data ?? [];
  },
};
