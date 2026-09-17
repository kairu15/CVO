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

/** Extract a human-readable message from an API error. */
export function getErrorMessage(error) {
  if (error.response?.data?.message) return error.response.data.message;
  if (error.response?.data?.errors) {
    const first = Object.values(error.response.data.errors)[0];
    if (Array.isArray(first) && first.length > 0) return first[0];
  }
  return error.message ?? "Something went wrong";
}
