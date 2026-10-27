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
  // A request against a dead link (tower lost mid-flush, captive portal) must
  // eventually REJECT, not hang forever: the offline queue's flush pass holds
  // a module-level latch while one pass runs, so a single hung socket used to
  // park the whole queue in "syncing" and silently freeze every later
  // submission. 30s is far beyond a healthy round trip on a field connection
  // while still short enough to hand control back to the queue; the photo
  // upload overrides this upward (see fieldVisitsApi.uploadPhoto).
  timeout: 30_000,
});

let onUnauthorized = null;

/** Register a callback invoked on any 401 response (e.g. clear auth state). */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

/**
 * Device timestamp of an offline submission currently being replayed.
 *
 * While set, every request carries it as `X-Offline-Queued-At`, and the API
 * records it on the audit row (device_created_at) beside its own created_at
 * (the sync time) — so a visit logged in the field three days ago is not
 * presented as having happened the moment connectivity returned.
 *
 * A module-level flag is safe because the offline queue replays items one at
 * a time (oldest first); it is cleared in `finally` so a failed replay never
 * leaks the header into ordinary requests.
 */
let offlineQueuedAt = null;

/**
 * Run one queued submission with the device timestamp attached.
 *
 * @template T
 * @param {string|null|undefined} queuedAt  ISO timestamp from the queue row.
 * @param {() => Promise<T>} request
 * @returns {Promise<T>}
 */
export async function withOfflineQueuedAt(queuedAt, request) {
  const previous = offlineQueuedAt;
  offlineQueuedAt = queuedAt ?? null;

  try {
    return await request();
  } finally {
    offlineQueuedAt = previous;
  }
}

api.interceptors.request.use((config) => {
  if (offlineQueuedAt) {
    config.headers ??= {};
    // Axios 1.x exposes AxiosHeaders (with .set); the plain object branch
    // keeps this correct for any adapter that hands back a bare object.
    if (typeof config.headers.set === "function") {
      config.headers.set("X-Offline-Queued-At", offlineQueuedAt);
    } else {
      config.headers["X-Offline-Queued-At"] = offlineQueuedAt;
    }
  }

  return config;
});

/**
 * A read that never got an answer is retried ONCE, after a short pause.
 *
 * The API runs on a hosting tier that sleeps when idle: the first request
 * after a quiet period can outlast the socket timeout while the instance
 * boots, even though the identical request a moment later succeeds. Retrying
 * a GET is safe (no side effects) and turns that cold start into a slower
 * page instead of "The server took too long to respond" on every card.
 *
 * Only reads are retried, only once, and only when no response arrived
 * (timeout / dropped connection) or the edge answered 502–504 while the
 * process was restarting. Cancelled reads (React Query aborts a request whose
 * component unmounted) are never retried, and writes keep the existing
 * single-attempt behavior so a replayed form can never double-submit.
 */
const READ_RETRY_DELAY_MS = 1_500;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      onUnauthorized?.(error);
    }

    const config = error.config;
    const isRead = (config?.method ?? "").toLowerCase() === "get";
    const cancelled = error.code === "ERR_CANCELED" || config?.signal?.aborted;
    const noAnswer = !error.response;
    const upstreamRestarting = RETRYABLE_STATUSES.has(error.response?.status);

    if (isRead && !cancelled && !config.__readRetried && (noAnswer || upstreamRestarting)) {
      config.__readRetried = true;
      await new Promise((resolve) => setTimeout(resolve, READ_RETRY_DELAY_MS));
      return api.request(config);
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
 * Unwrap a paginated Laravel resource collection into `{ data, meta }`.
 *
 * `meta` carries total / current_page / last_page / per_page so a table can
 * render its footer; it is null on a bare `{ data: [...] }` response, which is
 * what lets an unpaginated endpoint degrade gracefully.
 */
unwrap.page = (response) => {
  const body = response?.data;

  return {
    data: Array.isArray(body?.data) ? body.data : [],
    meta: body?.meta ?? null,
  };
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
