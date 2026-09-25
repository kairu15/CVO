/**
 * The rendered side of the toast system (state lives in ToastContext).
 *
 * Positioning: fixed, top-right, at `top-20` (5rem) — the dashboard header is
 * `h-16` (4rem, all widths) and the landing page header is content-height, so
 * 5rem clears both without overlapping their buttons at desktop or mobile
 * widths. `z-[60]` sits above modals (`z-50`) so feedback stays visible.
 *
 * Behavior: auto-dismiss after the variant's duration, paused while hovered
 * (each toast owns its timer and resets on hover); slide + fade in from the
 * right, and the same in reverse on exit.
 *
 * Accessibility: toasts are announced per-variant — `role="status"` for
 * success/info, `role="alert"` for errors — and the close button is a real
 * button with an accessible label.
 */
import { useEffect, useRef } from "react";
import { Icon } from "./Icons";

/** Icon + accent styling per variant, all from the shared palette. */
const VARIANTS = {
  success: {
    role: "status",
    icon: "check",
    accent: "border-l-brand-600",
    iconWrap: "bg-brand-50 text-brand-700",
  },
  error: {
    role: "alert",
    icon: "alert-circle",
    accent: "border-l-red-600",
    iconWrap: "bg-red-50 text-red-700",
  },
  info: {
    role: "status",
    icon: "info",
    accent: "border-l-slate-400",
    iconWrap: "bg-slate-100 text-slate-600",
  },
};

/** One toast card: owns its auto-dismiss timer (paused while hovered). */
function ToastCard({ toast, onDismiss }) {
  const variant = VARIANTS[toast.variant] ?? VARIANTS.info;
  const timerRef = useRef(null);
  const startRef = useRef(null);
  const remainingRef = useRef(toast.duration);

  useEffect(() => {
    function arm() {
      startRef.current = Date.now();
      timerRef.current = window.setTimeout(() => onDismiss(toast.id), remainingRef.current);
    }

    if (!toast.leaving) arm();

    return () => window.clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- armed once per toast; hover pauses via the handlers below
  }, [toast.leaving]);

  function pause() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      remainingRef.current = Math.max(
        800,
        remainingRef.current - (Date.now() - (startRef.current ?? Date.now())),
      );
    }
  }

  function resume() {
    if (!timerRef.current && !toast.leaving) {
      startRef.current = Date.now();
      timerRef.current = window.setTimeout(() => onDismiss(toast.id), remainingRef.current);
    }
  }

  return (
    <div
      role={variant.role}
      onMouseEnter={pause}
      onMouseLeave={resume}
      className={`card pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 border-l-4 py-3 pr-2 pl-3.5 shadow-panel ${variant.accent} ${
        toast.leaving
          ? "toast-exit"
          : "toast-enter"
      }`}
    >
      <span
        aria-hidden="true"
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${variant.iconWrap}`}
      >
        <Icon name={variant.icon} className="h-4 w-4" />
      </span>

      <p className="flex-1 pt-1 text-sm leading-snug font-medium text-slate-800">
        {toast.message}
      </p>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
      >
        <Icon name="close" className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * The fixed stack. aria-live lives on the stable container (it never
 * unmounts), so announcements fire as children change.
 */
export function ToastViewport({ toasts, onDismiss }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed top-20 right-4 z-[60] flex flex-col items-end gap-2.5"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
