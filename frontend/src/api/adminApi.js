import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Admin-only account management and technician assignment.
 *
 * Every method returns already-unwrapped data (see `unwrap` in client.js);
 * list methods always resolve to an array.
 */

export const adminApi = {
  /** List users, e.g. { role: "technician" } for the Technicians screen. */
  listUsers: async (params = {}) => unwrap.list(await api.get("/api/v1/admin/users", { params })),

  /** Set a user's role (self-registration stays farmer-only; this is the elevation path). */
  assignRole: async (userId, role) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/admin/users/${userId}/role`, { role }));
  },

  /** Admin-wide beneficiary directory including current technician. */
  listBeneficiaries: async (params = {}) =>
    unwrap.list(await api.get("/api/v1/admin/beneficiaries", { params })),

  /** Attach / detach (technicianId = null) a technician on a beneficiary. */
  assignTechnician: async (beneficiaryId, technicianId) => {
    await ensureCsrfCookie();
    return unwrap(
      await api.patch(`/api/v1/admin/beneficiaries/${beneficiaryId}/assign-technician`, {
        technician_id: technicianId,
      }),
    );
  },

  /**
   * Assign (or clear) a technician on many beneficiaries in one transactional
   * request. Resolves to { updated, failed_ids } so the UI can surface
   * partial failures per row.
   */
  bulkAssignTechnician: async (ids, technicianId) => {
    await ensureCsrfCookie();
    return unwrap(
      await api.patch("/api/v1/admin/beneficiaries/bulk-assign-technician", {
        ids,
        technician_id: technicianId,
      }),
    );
  },

  /**
   * Upload a "Livestock Monthly Monitoring Report" workbook (.xlsx/.csv) and
   * import every sheet into beneficiaries + monitoring records.
   * Returns an import summary { sheets, rows_read, beneficiaries_created, ... }.
   */
  importMonitoringExcel: async (file) => {
    await ensureCsrfCookie();
    const formData = new FormData();
    formData.append("file", file);

    return unwrap(
      await api.post("/api/v1/admin/monitoring-records/import", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      }),
    );
  },

  /**
   * Download the monitoring report workbook in the CVO Excel template layout
   * (one sheet per month). `month` is an optional "YYYY-MM" filter.
   */
  exportMonitoringExcelUrl: (month = null) => {
    const base = api.defaults.baseURL ?? "";
    const params = month ? `?month=${encodeURIComponent(month)}` : "";
    return `${base}/api/v1/admin/monitoring-records/export${params}`;
  },
};
