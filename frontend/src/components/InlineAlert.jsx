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
 */
export function InlineAlert({ tone = "error", message, onDismiss }) {
  const t = TONES[tone] ?? TONES.error;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`card flex items-start justify-between gap-3 px-4 py-3 text-sm ${t.wrapper}`}
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
