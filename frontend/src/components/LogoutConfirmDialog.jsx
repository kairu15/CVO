import { useState } from "react";
import { Modal } from "./Modal";
import { ButtonSpinner } from "./LoadingSpinner";
import { Icon } from "./Icons";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";

/**
 * Floating "are you sure" dialog for logging out.
 *
 * Log out is destructive to the session and sits in two places (the sidebar
 * footer and the header's profile panel), so both confirm through this one
 * dialog instead of signing the user out on a stray tap. Cancel is the safe
 * default; the destructive button states plainly what happens.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export function LogoutConfirmDialog({ open, onClose }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Log out"
      onClose={signingOut ? () => {} : onClose}
      contentClassName="!max-w-md"
    >
      <div className="flex items-start gap-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-100 dark:text-red-700">
          <Icon name="logout" className="h-5 w-5" />
        </span>
        <p className="text-sm text-slate-600">
          Are you sure you want to log out? You'll need to sign in again to
          return to your dashboard.
        </p>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={signingOut}
          className="btn-secondary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleLogout}
          disabled={signingOut}
          className="inline-flex items-center justify-center gap-2 rounded-pill bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {signingOut ? (
            <>
              <ButtonSpinner />
              Logging out…
            </>
          ) : (
            "Yes, log out"
          )}
        </button>
      </div>
    </Modal>
  );
}
