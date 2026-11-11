import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * The public contact form (`POST /public/contact`).
 *
 * A valid submission resolves to `{ message }` — the office-facing
 * confirmation text the form shows after success. Field-level validation
 * errors (422) surface through getFieldErrors in the caller.
 */
export const publicContactApi = {
  send: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/public/contact", payload));
  },
};
