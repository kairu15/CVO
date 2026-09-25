import axios from "axios";

/**
 * Centralized axios instance for the Laravel API.
 *
 * - Base URL comes from VITE_API_URL (see .env)
 * - withCredentials sends/receives Sanctum session cookies
 * - Axios automatically attaches the X-XSRF-TOKEN header from the
 *   XSRF-TOKEN cookie set by /sanctum/csrf-cookie
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8005",
  withCredentials: true,
  // axios >= 1.8 only auto-attaches the X-XSRF-TOKEN header for same-origin
  // requests unless this is explicitly enabled — required for our
  // localhost:5173 -> localhost:8005 setup.
  withXSRFToken: true,
  headers: { Accept: "application/json" },
});

let onUnauthorized = null;

/** Register a callback invoked on any 401 response (e.g. clear auth state). */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      onUnauthorized?.(error);
    }
    return Promise.reject(error);
  },
);

/**
 * Fetch the CSRF cookie required before any state-changing SPA request.
 * Shared by every API module so the handshake lives in exactly one place.
 */
export const ensureCsrfCookie = () => api.get("/sanctum/csrf-cookie");

/**
 * Unwrap a Laravel API Resource envelope (`{ data: ... }`) into the plain
 * payload. Every API module returns already-unwrapped data so pages never
 * repeat the `res.data.data ?? []` dance.
 *
 * - `unwrap(res)`          → the resource object (or the raw body when the
 *                            endpoint does not use an envelope)
 * - `unwrap.list(res)`     → the resource collection array, defaulting to []
 */
export function unwrap(response) {
  const body = response?.data;
  if (body && typeof body === "object" && "data" in body) return body.data;
  return body;
}

unwrap.list = (response) => {
  const data = unwrap(response);
  return Array.isArray(data) ? data : [];
};

/**
 * Extract Laravel validation errors keyed by field name, so forms can show
 * messages against the offending input. Returns null when the failure was not
 * a 422 validation response.
 *
 * @returns {Record<string, string> | null}
 */
export function getFieldErrors(error) {
  const errors = error.response?.data?.errors;
  if (!errors || typeof errors !== "object") return null;

  return Object.fromEntries(
    Object.entries(errors).map(([field, messages]) => [
      field,
      Array.isArray(messages) ? messages[0] : String(messages),
    ]),
  );
}

/**
 * Extract a human-readable message from an API error.
 *
 * A request that never got a response (the API is down, offline, or a CORS
 * preflight was blocked) rejects with axios's opaque "Network Error", which
 * tells the user nothing they can act on — so those cases get an explicit
 * message. Everything else is the server's own wording.
 */
export function getErrorMessage(error) {
  if (!error?.response) {
    if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") {
      return "The server took too long to respond. Please try again.";
    }
    if (error?.request) {
      return "Can't reach the server. Check your connection and try again.";
    }
  }

  if (error.response?.data?.message) return error.response.data.message;
  if (error.response?.data?.errors) {
    const first = Object.values(error.response.data.errors)[0];
    if (Array.isArray(first) && first.length > 0) return first[0];
  }

  // Bare statuses (Laravel's abort() bodies carry no message) must not leak
  // axios internals like "Request failed with status code 404".
  if (error.response?.status === 404) {
    return "The record you're looking for could not be found. It may have been removed, or your account does not have access to it.";
  }
  if (error.response?.status === 403) {
    return "Your account does not have permission to do that.";
  }

  return error.message ?? "Something went wrong";
}
