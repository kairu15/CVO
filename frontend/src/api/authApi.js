import { api } from "./client";

/** Fetch the CSRF cookie required before any state-changing SPA request. */
const ensureCsrfCookie = () => api.get("/sanctum/csrf-cookie");

export const authApi = {
  register: (payload) =>
    ensureCsrfCookie().then(() => api.post("/api/v1/register", payload)),

  login: (payload) =>
    ensureCsrfCookie().then(() => api.post("/api/v1/login", payload)),

  logout: () => api.post("/api/v1/logout"),

  fetchUser: () => api.get("/api/v1/user"),
};
