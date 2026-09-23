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

  logout: () => api.post("/api/v1/logout"),

  fetchUser: async () => unwrap(await api.get("/api/v1/user")),
};
