import { useEffect } from "react";
import { Icon } from "./Icons";

/**
 * Minimal accessible modal dialog.
 *
 * Renders over a click-away surface, closes on Escape, and locks body scroll
 * while open. Content is a plain function of props so callers keep full
 * control of the interior layout.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} props.title
 * @param {() => void} props.onClose
 * @param {import("react").ReactNode} props.children
 */
export function Modal({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined;

    function onKey(event) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <h3 className="font-display text-lg font-bold text-slate-900">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-brand-50 hover:text-brand-700"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
