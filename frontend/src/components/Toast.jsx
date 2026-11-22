/**
 * The rendered side of the toast system (state lives in ToastContext).
 *
 * Positioning: fixed at the top center, below the 4rem dashboard header. The
 * stack is newest-first and capped by the provider so a burst of API errors
 * cannot cover the page. `z-[60]` sits above modals (`z-50`) so feedback stays
 * visible.
 *
 * Behavior: auto-dismiss after the variant's duration, paused while hovered or
 * focused; slide down + fade in from the top, and slide up + fade out on exit.
 * A progress bar shows the remaining lifetime. Persistent messages omit the
 * timer and progress bar and stay until the close button is used.
 *
 * Accessibility: toasts are announced per-variant — `role="status"` for
 * success/info, `role="alert"` for warnings/errors — and the close button is a
 * real button with an accessible label.
 */
import { useEffect, useRef } from "react";
import { Icon } from "./Icons";

/** Icon, accent and progress styling per variant, from the shared palette. */
const VARIANTS = {
  success: {
    role: "status",
    icon: "check",
    accent: "border-l-brand-600",
    iconWrap: "bg-brand-50 text-brand-700 dark:bg-brand-100 dark:text-brand-800",
    progress: "bg-brand-600",
  },
  error: {
    role: "alert",
    icon: "alert-circle",
    accent: "border-l-red-600",
    iconWrap: "bg-red-50 text-red-700 dark:bg-red-100 dark:text-red-700",
    progress: "bg-red-600",
  },
  warning: {
    role: "alert",
    icon: "alert-triangle",
    accent: "border-l-amber-500",
    iconWrap: "bg-amber-50 text-amber-700 dark:bg-amber-100 dark:text-amber-800",
    progress: "bg-amber-500",
  },
  info: {
    role: "status",
    icon: "info",
    accent: "border-l-sky-500",
    iconWrap: "bg-sky-50 text-sky-700 dark:bg-sky-50 dark:text-sky-800",
    progress: "bg-sky-500",
  },
};

/** One toast card: owns its auto-dismiss timer (paused on hover/focus). */
function ToastCard({ toast, onDismiss }) {
  const variant = VARIANTS[toast.variant] ?? VARIANTS.info;
  const timerRef = useRef(null);
  const startRef = useRef(null);
  const remainingRef = useRef(toast.duration);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (toast.leaving || toast.duration <= 0) return undefined;

    startRef.current = Date.now();
    timerRef.current = window.setTimeout(
      () => onDismiss(toast.id),
      remainingRef.current,
    );

    return () => window.clearTimeout(timerRef.current);
  }, [toast.duration, toast.id, toast.leaving, onDismiss]);

  function holdTimer() {
    if (pausedRef.current) return;

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      remainingRef.current = Math.max(
        800,
        remainingRef.current - (Date.now() - (startRef.current ?? Date.now())),
      );
      pausedRef.current = true;
    }
  }

  function releaseTimer() {
    if (hoveredRef.current || focusedRef.current) return;
    if (!pausedRef.current || toast.leaving || toast.duration <= 0) return;

    pausedRef.current = false;
    startRef.current = Date.now();
    timerRef.current = window.setTimeout(
      () => onDismiss(toast.id),
      remainingRef.current,
    );
  }

  function pauseForPointer() {
    hoveredRef.current = true;
    holdTimer();
  }

  function resumeForPointer() {
    hoveredRef.current = false;
    releaseTimer();
  }

  function pauseForFocus() {
    focusedRef.current = true;
    holdTimer();
  }

  function resumeForFocus() {
    focusedRef.current = false;
    releaseTimer();
  }

  const showProgress = toast.duration > 0;

  return (
    <div
      role={variant.role}
      aria-atomic="true"
      data-toast-variant={toast.variant}
      onMouseEnter={pauseForPointer}
      onMouseLeave={resumeForPointer}
      onFocusCapture={pauseForFocus}
      onBlurCapture={resumeForFocus}
      className={`toast-card pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-2xl border border-slate-200/80 border-l-4 bg-white py-3 pr-2.5 pl-3.5 shadow-panel dark:border-slate-200/60 ${variant.accent} ${
        toast.leaving ? "toast-exit" : "toast-enter"
      }`}
    >
      <span
        aria-hidden="true"
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${variant.iconWrap}`}
      >
        <Icon name={variant.icon} className="h-4.5 w-4.5" />
      </span>

      <p className="flex-1 pt-1.5 text-sm leading-snug font-medium text-slate-800 dark:text-slate-600">
        {toast.message}
      </p>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        title="Dismiss"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 dark:hover:bg-slate-200/50 dark:hover:text-slate-500"
      >
        <Icon name="close" className="h-4 w-4" />
      </button>

      {showProgress && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 bg-slate-100 dark:bg-slate-200/50"
        >
          <div
            className={`toast-progress h-full origin-left ${variant.progress}`}
            style={{ "--toast-duration": `${toast.duration}ms` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The fixed top-center stack. `aria-live` lives on each card via its role, so
 * a newly inserted message is announced once, without re-announcing the stack.
 */
export function ToastViewport({ toasts, onDismiss }) {
  return (
    <section
      aria-label="Notifications"
      className="pointer-events-none fixed top-20 left-1/2 z-[60] flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 flex-col gap-2.5"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </section>
  );
}
