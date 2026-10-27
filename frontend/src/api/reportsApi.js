import { api } from "./client";

/**
 * City-wide program report — admin-only, read-only. The endpoint aggregates
 * the existing tables; nothing here creates or edits anything.
 *
 * The chart functions hit one dedicated aggregation endpoint EACH — the
 * database computes the aggregate, this layer never counts rows.
 */

/**
 * The printable report templates the API can fill. The server validates the
 * key against its own catalogue (ReportTemplateService::TEMPLATES) — this list
 * only drives the picker, which stays hidden while there is just one.
 */
export const REPORT_TEMPLATES = [
  { value: "dispersal", label: "Livestock Dispersal and Re-dispersal Report" },
];

/**
 * The download filename from a Content-Disposition header, preferring the
 * RFC 5987 UTF-8 form when the server sends one.
 */
function filenameFromDisposition(header) {
  if (!header) return null;

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) return decodeURIComponent(encoded[1].trim());

  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/**
 * The report reads aggregate every record in the system, so they are the
 * slowest calls this app makes. 90s is deliberate: the API's hosting tier
 * sleeps when idle and a cold report can take far longer than the client's
 * default 30s socket timeout, which used to surface as "The server took too
 * long to respond" on every chart at once.
 */
const REPORT_READ_TIMEOUT_MS = 90_000;

export const reportsApi = {
  /**
   * @param {object} [params]
   * @param {string} [params.barangay]  Narrow every section to one barangay.
   * @param {string} [params.from]      ISO date; adds a `dispersals_since` counter.
   * @returns {Promise<{scope: object, program: object, activity: object,
   *   clinical: object, per_barangay: Array<object>, trend: Array<object>}>}
   */
  cityWide: async (params = {}) => {
    const response = await api.get("/api/v1/admin/report", {
      params,
      timeout: REPORT_READ_TIMEOUT_MS,
    });

    return response.data?.data ?? {};
  },

  /**
   * Chart 1 — dispersal trend over time: monthly counts, oldest first,
   * zero-filled. Filters: barangay, animal_type, from/to (ISO dates).
   * @returns {Promise<Array<{month: string, label: string, dispersals: number, re_dispersals: number}>>}
   */
  dispersalTrend: async (params = {}) => {
    const response = await api.get("/api/v1/admin/report/charts/dispersal-trend", {
      params,
      timeout: REPORT_READ_TIMEOUT_MS,
    });
    return response.data?.data ?? [];
  },

  /**
   * Chart 2 — animals dispersed by barangay (every covered barangay appears,
   * zero-filled). Filters: animal_type, from/to.
   * @returns {Promise<Array<{barangay: string, dispersals: number, re_dispersals: number}>>}
   */
  animalsByBarangay: async (params = {}) => {
    const response = await api.get("/api/v1/admin/report/charts/animals-by-barangay", {
      params,
      timeout: REPORT_READ_TIMEOUT_MS,
    });
    return response.data?.data ?? [];
  },

  /**
   * Chart 3 — vaccination compliance over time: share of registered animals
   * whose vaccination is inside the cycle at each month end. `rate` is null
   * when nothing was registered yet. Filters: barangay, animal_type.
   * @returns {Promise<Array<{month: string, label: string, total: number, compliant: number, rate: number|null}>>}
   */
  vaccinationCompliance: async (params = {}) => {
    const response = await api.get("/api/v1/admin/report/charts/vaccination-compliance", {
      params,
      timeout: REPORT_READ_TIMEOUT_MS,
    });
    return response.data?.data ?? [];
  },

  /**
   * Chart 4 — animal type distribution (donut) over monitoring records.
   * Filters: month ("YYYY-MM"), from/to — the Monitoring Records filters.
   * @returns {Promise<Array<{animal_type: string, animals: number}>>}
   */
  animalTypeDistribution: async (params = {}) => {
    const response = await api.get("/api/v1/admin/report/charts/animal-type-distribution", {
      params,
      timeout: REPORT_READ_TIMEOUT_MS,
    });
    return response.data?.data ?? [];
  },

  /**
   * Chart 5 — technician workload: active households per technician,
   * zero-filled. Filter: barangay.
   * @returns {Promise<Array<{technician: string, households: number}>>}
   */
  technicianWorkload: async (params = {}) => {
    const response = await api.get("/api/v1/admin/report/charts/technician-workload", {
      params,
      timeout: REPORT_READ_TIMEOUT_MS,
    });
    return response.data?.data ?? [];
  },

  /**
   * The printable report: the office's own Excel template filled with the
   * dispersal records for these filters, downloaded under the admin's name.
   *
   * @param {object} payload
   * @param {string} payload.template   key from REPORT_TEMPLATES
   * @param {string} payload.name       editable report title (also the filename)
   * @param {string} [payload.barangay]
   * @param {string} [payload.animal_type]
   * @param {string} [payload.month]    "YYYY-MM"
   * @param {string} [payload.from]     ISO date
   * @param {string} [payload.to]       ISO date
   * @returns {Promise<{blob: Blob, filename: string}>}
   */
  exportTemplate: async (payload) => {
    try {
      const response = await api.post("/api/v1/admin/report/template-export", payload, {
        responseType: "blob",
        // A large roster takes longer than the SPA's default 30s ceiling.
        timeout: 120_000,
      });

      return {
        blob: response.data,
        filename:
          filenameFromDisposition(response.headers?.["content-disposition"]) ?? "cvo-report.xlsx",
      };
    } catch (error) {
      // Under `responseType: "blob"` a JSON error body arrives as a Blob, so
      // getErrorMessage would see no `.message`. Decode it back into the shape
      // the error helpers expect before rethrowing.
      const data = error?.response?.data;

      if (typeof Blob !== "undefined" && data instanceof Blob) {
        try {
          error.response.data = JSON.parse(await data.text());
        } catch {
          // Not JSON (a proxy error page, say) — leave the original body.
        }
      }

      throw error;
    }
  },
};
