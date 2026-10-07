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
   *
   * With `password` + `password_confirmation` (matching the registration
   * policy), the account signs in with them immediately. WITHOUT a password
   * the account is invited: the server emails a one-time setup link (when a
   * mailer is configured) and ALWAYS returns `setup_url` on the response so
   * the admin can hand it over directly — real email delivery is an SMTP
   * configuration away, not a code change. Resolves to
   * `{ ...user, setup_url }`.
   */
  createUser: async (payload) => {
    await ensureCsrfCookie();
    const response = await api.post("/api/v1/admin/users", payload);

    return {
      ...unwrap(response),
      setup_url: response.data?.setup_url ?? null,
    };
  },

  /**
   * Deactivate several accounts in one request. Resolves to
   * { updated, failed_ids } — the actor's own account is refused by the
   * server (mirrored by disabling its checkbox), never a batch crash.
   */
  bulkDeactivateUsers: async (ids) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/admin/users/bulk-deactivate", { ids }));
  },

  /**
   * One account's activity trail: { user, activity } — the activity rows are
   * events performed BY the account (sign-ins, password work) and ABOUT it
   * (created, invited, edited, role changed, deactivated, reactivated).
   */
  userActivity: async (userId) =>
    unwrap(await api.get(`/api/v1/admin/users/${userId}/activity`)),

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

  // ── Roles & Permissions: the capability matrix ──────────────────────────

  /**
   * The whole capability matrix: { roles: [{key,label}], groups:
   * [{group, permissions: [{key, label, granted: {admin: bool, ...}}]}],
   * manage_roles_holders: {role: activeAccountCount} }.
   */
  getRolePermissions: async () =>
    unwrap(await api.get("/api/v1/admin/roles/permissions")),

  /**
   * Flip one cell of the matrix. Resolves to the fresh matrix (the server's
   * answer, not an optimistic guess). The server refuses (422) a change that
   * would leave no active account holding manage_roles.
   */
  setRolePermission: async (role, permissionKey, granted) =>
    unwrap(
      await api.patch(`/api/v1/admin/roles/${role}/permissions`, {
        permission: permissionKey,
        granted,
      }),
    ),

  // ── Reference data: barangays & puroks (System Settings) ────────────────
  //
  // Puroks can be added, renamed and deleted while unused. Barangays can be
  // added and re-centered but never renamed — the server drops a name on
  // PATCH because free-text historical addresses normalize against it.

  /** Add a coverage area: { name, latitude, longitude }. */
  createBarangay: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/admin/barangays", payload));
  },

  /** Re-center a barangay: { latitude, longitude }. Name is immutable. */
  updateBarangay: async (barangayId, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/admin/barangays/${barangayId}`, payload));
  },

  /** Record a purok/sitio in one barangay: { name, latitude?, longitude? }. */
  createPurok: async (barangayId, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post(`/api/v1/admin/barangays/${barangayId}/puroks`, payload));
  },

  /** Rename / re-center / un-placeholder a purok. */
  updatePurok: async (purokId, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch(`/api/v1/admin/puroks/${purokId}`, payload));
  },

  /**
   * Delete a purok. Resolves true; rejects with the server's 409 message when
   * households still reference it.
   */
  deletePurok: async (purokId) => {
    await ensureCsrfCookie();
    return unwrap(await api.delete(`/api/v1/admin/puroks/${purokId}`));
  },
};
