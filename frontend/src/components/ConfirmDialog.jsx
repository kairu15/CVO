import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";

/**
 * "Leave without saving?" confirmation for unsaved form data.
 *
 * Shown when the user (or the app) tries to move away from a form with
 * unsaved input — a modal's close button, Escape, a link out of the page —
 * so nothing typed is ever silently destroyed. Distinct from Modal because
 * Escape must close ONLY this dialog: its key listener runs in the capture
 * phase and stops the event before the underlying Modal's bubble-phase
 * listener can also act on it (both sit on `document`, where two ordinary
 * listeners for the same keydown would both fire and dismiss both dialogs).
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} [props.title]
 * @param {string} props.message what is lost by leaving
 * @param {string} [props.confirmLabel]
 * @param {() => void} props.onConfirm leave without saving
 * @param {() => void} props.onCancel keep editing
 */
export function ConfirmDialog({
  open,
  title = "Discard unsaved changes?",
  message,
  confirmLabel = "Discard",
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return undefined;

    function onKey(event) {
      if (event.key !== "Escape") return;
      // Capture phase: this dialog is on top of the form modal, so it — and
      // only it — may consume Escape.
      event.stopPropagation();
      onCancel();
    }

    document.addEventListener("keydown", onKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={onCancel}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm dark:bg-black/60"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="card relative z-10 w-full max-w-md p-6"
      >
        <div className="flex items-start gap-3.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700">
            <Icon name="alert-circle" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-lg font-bold text-slate-900">{title}</h3>
            <p className="mt-1.5 text-sm text-slate-600">{message}</p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Keep editing
          </button>
          <button type="button" onClick={onConfirm} className="btn-primary">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
