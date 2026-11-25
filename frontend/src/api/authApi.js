import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Authentication endpoints. Every method returns already-unwrapped data
 * (see `unwrap` in client.js).
 */
export const authApi = {
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
   * Request a 6-digit password-reset code. The response is intentionally
   * uniform (always success) so the caller can never learn whether an address
   * exists; the reset email carries the code, which the reset page submits as
   * `otp`.
   */
  forgotPassword: async (email) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/forgot-password", { email }));
  },

  /**
   * Verify the emailed 6-digit `otp`. A 422 means the code is invalid, used,
   * or expired. On success the API returns `{ reset_token }` — a short-lived,
   * single-use ticket that the reset request must present; the code itself is
   * consumed and never returned.
   */
  verifyResetCode: async ({ email, otp }) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/verify-reset-code", { email, otp }));
  },

  /**
   * Verify a staff account's email address with the token from the emailed
   * link. Public: the recipient may not have signed in yet. On success the
   * API marks the address verified and, for an account created without a
   * password, returns a one-time `setup_url`.
   */
  verifyEmail: async (token) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/email/verify", { token }));
  },

  /**
   * Complete a reset with a new password plus either the verified
   * `reset_token` or an administrator invite `token` (with its `email`). A 422
   * here means the ticket or token is invalid, used, or expired.
   */
  resetPassword: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/reset-password", payload));
  },
};
