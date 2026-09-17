import { api } from "./client";

/**
 * Admin-only account management and technician assignment.
 */

const ensureCsrfCookie = () => api.get("/sanctum/csrf-cookie");

export const adminApi = {
  /** List users, e.g. { role: "technician" } for the Technicians screen. */
  listUsers: (params = {}) => api.get("/api/v1/admin/users", { params }),

  /** Set a user's role (self-registration stays farmer-only; this is the elevation path). */
  assignRole: async (userId, role) => {
    await ensureCsrfCookie();
    return api.patch(`/api/v1/admin/users/${userId}/role`, { role });
  },

  /** Admin-wide beneficiary directory including current technician. */
  listBeneficiaries: (params = {}) => api.get("/api/v1/admin/beneficiaries", { params }),

  /** Attach / detach (technicianId = null) a technician on a beneficiary. */
  assignTechnician: async (beneficiaryId, technicianId) => {
    await ensureCsrfCookie();
    return api.patch(`/api/v1/admin/beneficiaries/${beneficiaryId}/assign-technician`, {
      technician_id: technicianId,
    });
  },
};
