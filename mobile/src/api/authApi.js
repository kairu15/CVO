import { api } from "./client";

export const authApi = {
  /** Bearer-token login for mobile clients. */
  tokenLogin: (payload) => api.post("/api/v1/token-login", payload),

  /** Registration returns the created user; follow with tokenLogin. */
  register: (payload) => api.post("/api/v1/register", payload),

  logout: () => api.post("/api/v1/logout"),

  fetchUser: () => api.get("/api/v1/user"),
};
