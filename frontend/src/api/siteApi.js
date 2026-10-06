import { api, unwrap } from "./client";

/**
 * Public (unauthenticated) site metadata: the office contact profile an
 * administrator edits in System Settings, plus the SPA's own inactivity
 * window.
 *
 * Session-free on purpose — the pages that render it (landing, Support, the
 * password-reset note on the sign-in form) are all used before login.
 */
export const siteApi = {
  /** @returns {Promise<{office: object, session: {idle_minutes: number}}>} */
  config: async () => unwrap(await api.get("/api/v1/site")),
};
