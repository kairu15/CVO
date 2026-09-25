import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * The authenticated user's own profile. Every endpoint is caller-scoped on
 * the server (no id parameter exists), so these take no identifiers.
 */
export const profileApi = {
  get: async () => unwrap(await api.get("/api/v1/profile")),

  /**
   * Update the account (name/email) and, for farmers, the household
   * location (address = barangay name, purok_id, coordinates, source).
   * Returns the fresh profile payload.
   */
  update: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.patch("/api/v1/profile", payload));
  },

  changePassword: async (payload) => {
    await ensureCsrfCookie();
    await api.patch("/api/v1/profile/password", payload);
  },

  /** Multipart upload; the server validates type/size again. */
  uploadAvatar: async (file) => {
    await ensureCsrfCookie();
    return unwrap(
      await api.post("/api/v1/profile/avatar", { avatar: file }, {
        headers: { "Content-Type": "multipart/form-data" },
      }),
    );
  },

  removeAvatar: async () => {
    await ensureCsrfCookie();
    return unwrap(await api.delete("/api/v1/profile/avatar"));
  },
};
