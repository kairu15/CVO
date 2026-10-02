/**
 * Why the last session ended, carried across a redirect to /login.
 *
 * A 401 (or the inactivity guard) clears the auth state, which bounces the
 * user to the sign-in screen. That redirect would otherwise be silent, so the
 * reason is parked here and claimed once by the login form.
 *
 * Codes, not messages: the login page translates them, so a notice set while
 * the app was in English still reads correctly if the language changed.
 *
 * sessionStorage (not module memory) so it survives the hard reload a
 * back/forward-cache restore or a full-page redirect can cause — and it is
 * cleared as soon as it is read, so it never reappears on a later visit.
 */

const NOTICE_KEY = "cvo.auth.notice";

/** The server rejected the session/token (expired, revoked, or reset). */
export const NOTICE_SESSION_EXPIRED = "expired";

/** The client-side inactivity guard signed the user out. */
export const NOTICE_INACTIVITY = "inactivity";

/** Record why the session ended, for the next login screen to show. */
export function setSessionNotice(code) {
  try {
    sessionStorage.setItem(NOTICE_KEY, code);
  } catch {
    // Storage blocked (private mode) — the notice is best-effort.
  }
}

/** Read and clear the pending notice; null when there is nothing to show. */
export function takeSessionNotice() {
  try {
    const code = sessionStorage.getItem(NOTICE_KEY);

    if (code) sessionStorage.removeItem(NOTICE_KEY);

    return code;
  } catch {
    return null;
  }
}
