import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Authentication endpoints. Every method returns already-unwrapped data
 * (see `unwrap` in client.js).
 */
export const authApi = {
  register: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/register", payload));
  },

  login: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/login", payload));
  },

  /**
   * Sign out. Must ensure the CSRF cookie first: after a remember-me restore
   * the session was re-established server-side, so the browser's XSRF-TOKEN
   * cookie can predate the live session — sending it stale would 419 and
   * leave the session alive on the server while the UI shows a signed-out
   * screen.
   */
  logout: async () => {
    await ensureCsrfCookie();
    return api.post("/api/v1/logout");
  },

  fetchUser: async () => unwrap(await api.get("/api/v1/user")),

  /**
   * Request a password-reset link. The response is intentionally uniform
   * (always success) so the caller can never learn whether an address exists;
   * the reset email carries the SPA reset link.
   */
  forgotPassword: async (email) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/forgot-password", { email }));
  },

  /**
   * Complete a reset with the emailed `token`/`email` pair and a new password.
   * A 422 here means the token is invalid, used, or expired.
   */
  resetPassword: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/reset-password", payload));
  },
};
