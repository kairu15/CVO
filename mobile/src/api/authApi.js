import { api } from "./client";

/**
 * Bearer-token auth for mobile clients.
 *
 * There is no self-registration endpoint: accounts are staff-only and are
 * created by the CVO administrator (beneficiaries are program records, not
 * logins), so the app offers sign-in and nothing else.
 */
export const authApi = {
  /** Bearer-token login for mobile clients. */
  tokenLogin: (payload) => api.post("/api/v1/token-login", payload),

  logout: () => api.post("/api/v1/logout"),

  fetchUser: () => api.get("/api/v1/user"),
};
