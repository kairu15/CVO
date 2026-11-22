import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useOptionalToast } from "../context/ToastContext";
import { getErrorMessage } from "../api/client";
import { Modal } from "./Modal";
import { InlineAlert } from "./InlineAlert";
import { ButtonSpinner } from "./LoadingSpinner";
import { Icon } from "./Icons";

/** Exit animation length; keep in sync with `.modal-panel-exit` in index.css. */
const CLOSE_ANIMATION_MS = 140;

/**
 * Shared "are you sure" dialog for logging out.
 *
 * Both authenticated logout entry points — the header account menu and the
 * sidebar footer — render this component, so there is exactly one confirmation
 * flow. Cancel is the safe default and receives initial focus. While the server
 * request runs, every dismissal path and both action buttons are disabled.
 *
 * The local session is always cleared by AuthContext. If the server could not
 * confirm revocation, a persistent toast explains that this device is signed
 * out but the server-side session may still need to expire; the app does not
 * pretend the server call succeeded.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import("react").RefObject<HTMLElement>} [props.returnFocusRef]
 */
export function LogoutConfirmDialog({ open, onClose, returnFocusRef }) {
  const { logout } = useAuth();
  const toast = useOptionalToast();
  const navigate = useNavigate();

  const [signingOut, setSigningOut] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState(null);

  const signingOutRef = useRef(false);
  const cancelRef = useRef(null);
  const closeTimer = useRef(null);

  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current);
    },
    [],
  );

  // Fade the panel and backdrop out before the parent unmounts the dialog.
  const requestClose = useCallback(() => {
    if (signingOutRef.current || closing) return;

    setClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setClosing(false);
      onClose();
    }, CLOSE_ANIMATION_MS);
  }, [closing, onClose]);

  async function handleLogout() {
    if (signingOutRef.current || closing) return;

    signingOutRef.current = true;
    setSigningOut(true);
    setError(null);

    try {
      const result = await logout();

      if (result?.serverError) {
        toast?.error(
          "You were signed out on this device, but the server could not confirm it. Close the browser if this is a shared device.",
          { persistent: true },
        );
      }

      navigate("/login", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
      signingOutRef.current = false;
      setSigningOut(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Log out"
      titleClassName="text-xl sm:text-2xl"
      onClose={requestClose}
      contentClassName="!max-w-lg !shadow-panel"
      closeDisabled={signingOut}
      trapFocus
      initialFocusRef={cancelRef}
      returnFocusRef={returnFocusRef}
      describedById="logout-description"
      animated
      closing={closing}
    >
      <div className="flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-100 dark:text-red-700">
          <Icon name="logout" className="h-6 w-6" />
        </span>
        <p
          id="logout-description"
          className="pt-1 text-sm leading-6 text-slate-600 sm:text-base"
        >
          Are you sure you want to log out? You'll need to sign in again to
          return to your dashboard.
        </p>
      </div>

      {error && (
        <div className="mt-4">
          <InlineAlert
            tone="error"
            message={`Couldn't log out — ${error}`}
            onDismiss={() => setError(null)}
          />
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          ref={cancelRef}
          type="button"
          onClick={requestClose}
          disabled={signingOut || closing}
          className="btn-secondary w-full active:bg-slate-100 sm:w-auto"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleLogout}
          disabled={signingOut || closing}
          className="inline-flex w-full items-center justify-center gap-2 rounded-pill bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 active:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {signingOut ? (
            <>
              <ButtonSpinner />
              Logging out...
            </>
          ) : (
            <>
              <Icon name="logout" className="h-4 w-4" />
              Log out
            </>
          )}
        </button>
      </div>
    </Modal>
  );
}
