import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { NOTICE_INACTIVITY, setSessionNotice } from "../lib/sessionNotice";
import { Modal } from "./Modal";
import { Icon } from "./Icons";

/**
 * Client-side inactivity guard.
 *
 * The server already enforces an idle window on its own clock, but the user
 * deserves warning BEFORE they lose an unsaved form to a silent 401. This
 * watches real interaction and signs the user out after a quiet period,
 * showing a countdown first so they can keep the session with one click.
 *
 * Defaults mirror config/security.php's intent (a stricter 15 minutes than
 * the server's 120-minute session): the client nudges early, and a user who
 * ignores even the warning is still covered by the server's own idle expiry.
 *
 * Activity resets the clock and dismisses the warning, so the only way to be
 * signed out is to genuinely walk away. Mounted inside the authenticated
 * shell (see DashboardLayout), so it stops the moment the user navigates to
 * the login screen.
 *
 * @param {object} [props]
 * @param {number} [props.idleMs] quiet period before sign-out (test seam)
 * @param {number} [props.warningMs] how long the warning shows (test seam)
 */
const MINUTE = 60_000;

export const DEFAULT_IDLE_MS = 15 * MINUTE;
export const DEFAULT_WARNING_MS = 60_000;

/** How often the elapsed clock is checked; 1s keeps the countdown honest. */
const TICK_MS = 1_000;

/** Events that count as a human still being present. */
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "wheel",
  "scroll",
];

export function IdleSessionGuard({
  idleMs = DEFAULT_IDLE_MS,
  warningMs = DEFAULT_WARNING_MS,
}) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  // null = no warning showing; otherwise the whole seconds left to react.
  const [secondsLeft, setSecondsLeft] = useState(null);
  // Seeded by the effect below, which also starts the clock, so render stays
  // pure (Date.now() must not run during render).
  const lastActivityRef = useRef(0);
  const signingOutRef = useRef(false);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setSecondsLeft(null);
  }, []);

  useEffect(() => {
    signingOutRef.current = false;
    lastActivityRef.current = Date.now();

    const onActivity = () => resetActivity();

    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, onActivity, { passive: true }),
    );

    async function signOut() {
      if (signingOutRef.current) return;

      signingOutRef.current = true;

      // Record the reason BEFORE the auth state flips, so the login screen
      // that replaces this one can explain itself.
      setSessionNotice(NOTICE_INACTIVITY);

      try {
        await logout();
      } finally {
        navigate("/login", { replace: true });
      }
    }

    const timer = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;

      if (elapsed >= idleMs) {
        signOut();
        return;
      }

      if (elapsed >= idleMs - warningMs) {
        setSecondsLeft(Math.max(1, Math.ceil((idleMs - elapsed) / 1000)));
      }
    }, TICK_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, onActivity));
      clearInterval(timer);
    };
  }, [idleMs, warningMs, resetActivity, logout, navigate]);

  function signOutNow() {
    if (signingOutRef.current) return;

    signingOutRef.current = true;
    setSessionNotice(NOTICE_INACTIVITY);
    logout().finally(() => navigate("/login", { replace: true }));
  }

  return (
    <Modal
      open={secondsLeft !== null}
      title="Are you still there?"
      onClose={resetActivity}
      contentClassName="!max-w-md"
    >
      <div className="flex items-start gap-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700 dark:bg-amber-100 dark:text-amber-800">
          <Icon name="alert-circle" className="h-5 w-5" />
        </span>
        <p className="text-sm text-slate-600" role="status" aria-live="polite">
          You'll be signed out in{" "}
          <span className="font-semibold text-slate-900">{secondsLeft}s</span> due
          to inactivity. Stay signed in to keep working.
        </p>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={signOutNow} className="btn-secondary">
          Sign out now
        </button>
        <button type="button" onClick={resetActivity} className="btn-primary">
          Stay signed in
        </button>
      </div>
    </Modal>
  );
}
