/**
 * The sign-in identifier (username or email) the user asked us to remember.
 *
 * "Remember me on this device" saves the typed identifier here so the field is
 * pre-filled on the next visit — the familiar behaviour users expect from the
 * checkbox. It is deliberately the identifier ONLY: never the password, and
 * never anything role- or record-related.
 *
 * localStorage (not sessionStorage): the point is to survive a browser restart,
 * which is exactly when a session-scoped store would be empty. A user who
 * unticks the box has it cleared on their next successful sign-in.
 *
 * This is a convenience, not a credential: possessing the identifier grants
 * nothing without the password.
 */

const IDENTIFIER_KEY = "cvo.login.identifier";

/** The saved identifier, or "" when nothing is remembered / storage is blocked. */
export function readRememberedIdentifier() {
  try {
    return localStorage.getItem(IDENTIFIER_KEY) ?? "";
  } catch {
    return ""; // private mode / storage disabled
  }
}

/**
 * Save the identifier for next time, or clear it when `identifier` is empty.
 * Best-effort: a blocked storage API must never break sign-in.
 */
export function rememberIdentifier(identifier) {
  try {
    const value = (identifier ?? "").trim();

    if (value) localStorage.setItem(IDENTIFIER_KEY, value);
    else localStorage.removeItem(IDENTIFIER_KEY);
  } catch {
    // ignored — remembering is a convenience
  }
}
