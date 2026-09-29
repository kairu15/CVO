import { useEffect, useRef } from "react";
import { Icon } from "./Icons";

const TONES = {
  error: {
    wrapper: "border-red-200 bg-red-50 text-red-700",
    icon: "alert-circle",
    iconClass: "text-red-500",
  },
  success: {
    wrapper: "border-brand-200 bg-brand-50 text-brand-800",
    icon: "check",
    iconClass: "text-brand-700",
  },
  info: {
    wrapper: "border-slate-200 bg-slate-50 text-slate-700",
    icon: "info",
    iconClass: "text-slate-400",
  },
};

/**
 * The one inline feedback block. Every mutating screen renders success and
 * failure feedback through this component so the pattern is identical
 * everywhere (role="alert", dismissable, token-styled).
 *
 * The box hugs its message (`w-fit`, capped at the container width) instead of
 * stretching across the row — a one-line confirmation should not read as a
 * full-width banner.
 *
 * @param {object} props
 * @param {"error"|"success"|"info"} [props.tone]
 * @param {string} props.message
 * @param {() => void} [props.onDismiss] renders the close button; also the
 *   callback an `autoDismiss` timer fires
 * @param {number|false} [props.autoDismiss] milliseconds before the alert
 *   dismisses itself. Leave unset for errors: a failure the user has not seen
 *   should stay on screen. Notices pass 5000.
 */
export function InlineAlert({ tone = "error", message, onDismiss, autoDismiss = false }) {
  const t = TONES[tone] ?? TONES.error;

  // Callers pass inline arrow functions, so depending on `onDismiss` directly
  // would restart the countdown on every parent render. Read it through a ref
  // and key the timer on the delay and the message instead.
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!autoDismiss) return undefined;

    const timer = setTimeout(() => dismissRef.current?.(), autoDismiss);

    return () => clearTimeout(timer);
  }, [autoDismiss, message]);

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`card inline-flex w-fit max-w-full items-start justify-between gap-3 px-4 py-3 text-sm ${t.wrapper}`}
    >
      <span className="flex items-start gap-2.5">
        <Icon name={t.icon} className={`mt-0.5 h-4 w-4 shrink-0 ${t.iconClass}`} />
        <span>{message}</span>
      </span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="shrink-0 rounded-lg p-1 opacity-60 transition hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
