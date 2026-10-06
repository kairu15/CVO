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

  /**
   * The same user list, paginated: resolves to `{ data, meta }` so the table
   * can render its page footer (see `unwrap.page`).
   */
  listUsersPage: async (params = {}) =>
    unwrap.page(await api.get("/api/v1/admin/users", { params })),

  /** Set a user's role (self-registration stays farmer-only; this is the elevation path). */
  assignRole: async (userId, role) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/admin/users/${userId}/role`, { role }));
  },

  /**
   * Create a staff account (admin/doctor/technician). Farmer accounts come
   * from public self-registration, so the server rejects that role here.
   * `password` + `password_confirmation` must match the registration policy.
   */
  createUser: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/admin/users", payload));
  },

  /**
   * Edit an account's name/email, and its role when one is sent. A role
   * change on the signed-in administrator's own account is refused by the
   * server (422 on `role`), same as the dedicated role endpoint.
   */
  updateUser: async (userId, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/admin/users/${userId}`, payload));
  },

  /**
   * Deactivate an account — the system soft-deletes accounts rather than
   * removing them, so rows that reference the account stay intact. Revokes
   * the account's sessions at the same time. Reversible via reactivateUser.
   */
  deactivateUser: async (userId) => {
    await ensureCsrfCookie();
    return unwrap(await api.delete(`/api/v1/admin/users/${userId}`));
  },

  /** Reactivate a deactivated account (restores the soft-deleted row). */
  reactivateUser: async (userId) => {
    await ensureCsrfCookie();
    return unwrap(await api.post(`/api/v1/admin/users/${userId}/reactivate`));
  },

  /** Admin-wide beneficiary directory including current technician. */
  listBeneficiaries: async (params = {}) =>
    unwrap.list(await api.get("/api/v1/admin/beneficiaries", { params })),

  /**
   * The same directory, paginated: resolves to `{ data, meta }` so the table
   * can render its page footer (see `unwrap.page`).
   */
  listBeneficiariesPage: async (params = {}) =>
    unwrap.page(await api.get("/api/v1/admin/beneficiaries", { params })),

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
   * (one sheet per month). `month` is an optional "YYYY-MM" filter and
   * `animalType` an optional animal-type filter — both are passed through so
   * the file matches whatever filters are active on screen, and the server
   * names the file after them.
   */
  exportMonitoringExcelUrl: (month = null, animalType = null) => {
    const base = api.defaults.baseURL ?? "";
    const params = new URLSearchParams();

    if (month) params.set("month", month);
    if (animalType) params.set("animal_type", animalType);

    const query = params.toString();
    return `${base}/api/v1/admin/monitoring-records/export${query ? `?${query}` : ""}`;
  },
};
