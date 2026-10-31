import { api } from "./client";

/**
 * Barangay dispersal and re-dispersal analytics — the Reports "Barangay
 * dispersal" tab and the dashboard widget's data. Read-only aggregates: the
 * database computes the answer, this layer never counts rows.
 *
 * Access is the view_analytics capability server-side; a technician's payload
 * is already row-scoped to their assigned households when it arrives here.
 */

/** Aggregates over every event — as slow as the report charts, same ceiling. */
const ANALYTICS_READ_TIMEOUT_MS = 90_000;

/** The download filename from a Content-Disposition header. */
function filenameFromDisposition(header) {
  if (!header) return null;

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) return decodeURIComponent(encoded[1].trim());

  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

export const analyticsApi = {
  /**
   * One row per barangay (zeros included) + the per-metric highest/lowest
   * summary with ties and the generated sentence.
   *
   * @param {object} [params]
   * @param {string} [params.from]          ISO date
   * @param {string} [params.to]            ISO date
   * @param {number} [params.animal_type_id]
   * @param {number} [params.classification_id]
   * @param {string[]} [params.event_types]
   * @param {boolean} [params.per_1000]
   * @returns {Promise<{barangays: Array<object>, summary: object,
   *   min_rate_animals: number, filters: object, scoped: boolean, generated_at: string}>}
   */
  barangayDispersal: async (params = {}) => {
    const response = await api.get("/api/v1/analytics/barangay-dispersal", {
      params,
      timeout: ANALYTICS_READ_TIMEOUT_MS,
    });
    return response.data?.data ?? {};
  },

  /**
   * One barangay's floating card: its summary row (`totals`), the animal mix
   * it received, and the newest handovers in (`received`) and out
   * (`passed_on`), under the same filters as the map and the table.
   *
   * @param {number} barangayId
   * @param {object} [params]  Same filters as barangayDispersal, plus limit.
   * @param {AbortSignal} [params.signal]
   * @returns {Promise<{barangay: object, totals: object, categories: Array<object>,
   *   received: {total: number, items: Array<object>},
   *   passed_on: {total: number, items: Array<object>},
   *   scoped: boolean, filters: object, limit: number}>}
   */
  barangayDetail: async (barangayId, { signal, ...params } = {}) => {
    const response = await api.get(`/api/v1/analytics/barangay-dispersal/${barangayId}`, {
      params,
      signal,
      timeout: ANALYTICS_READ_TIMEOUT_MS,
    });
    return response.data?.data ?? {};
  },

  /**
   * Barangay → barangay re-dispersal flows (and CVO → barangay when asked).
   *
   * @param {object} [params]  Same filters, plus include_cvo.
   * @returns {Promise<{flows: Array<object>, filters: object, scoped: boolean, generated_at: string}>}
   */
  barangayFlows: async (params = {}) => {
    const response = await api.get("/api/v1/analytics/barangay-flows", {
      params,
      timeout: ANALYTICS_READ_TIMEOUT_MS,
    });
    return response.data?.data ?? {};
  },

  /**
   * The barangay table + flow matrix + filter summary as one workbook, behind
   * the active filters.
   *
   * @param {object} params  Same filters as barangayDispersal + include_cvo.
   * @returns {Promise<{blob: Blob, filename: string}>}
   */
  exportExcel: async (params = {}) => {
    try {
      const response = await api.get("/api/v1/analytics/barangay-dispersal/export", {
        params,
        responseType: "blob",
        timeout: 120_000,
      });

      return {
        blob: response.data,
        filename:
          filenameFromDisposition(response.headers?.["content-disposition"]) ??
          "cvo-barangay-dispersal.xlsx",
      };
    } catch (error) {
      // Under `responseType: "blob"` a JSON error body arrives as a Blob, so
      // decode it back into the shape the error helpers expect.
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
