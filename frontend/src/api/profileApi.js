import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * The authenticated user's own profile. Every endpoint is caller-scoped on
 * the server (no id parameter exists), so these take no identifiers.
 */
export const profileApi = {
  get: async () => unwrap(await api.get("/api/v1/profile")),

  /**
   * Last sign-in, active browser/mobile sessions and recent account activity.
   * The server scopes every row to the caller.
   */
  security: async () => unwrap(await api.get("/api/v1/profile/security")),

  /**
   * Update the account name, email and optional personal contact details.
   * Role, permissions and username are deliberately not accepted.
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

  /** Sign out every other browser/mobile session, keeping this one. */
  revokeOtherSessions: async () => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/profile/sessions/revoke-others"));
  },

  /**
   * Revoke every session and token this account holds — including the one
   * making the call. The caller is signed out everywhere.
   */
  logoutAll: async () => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/logout-all"));
  },
};
