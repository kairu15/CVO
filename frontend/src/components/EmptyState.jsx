/**
 * Empty / placeholder state for dashboard content areas.
 *
 * The illustration is inline SVG so it inherits the design tokens and needs no
 * asset pipeline — see `--color-brand-*` in index.css.
 */
export function EmptyState({ title, description, action, className = "" }) {
  return (
    <div
      className={`flex flex-col items-center justify-center px-6 py-14 text-center ${className}`}
    >
      <svg viewBox="0 0 160 120" fill="none" className="h-28 w-36" aria-hidden="true">
        <circle cx="80" cy="54" r="44" fill="var(--color-brand-50)" />
        <circle
          cx="80"
          cy="54"
          r="32"
          stroke="var(--color-brand-200)"
          strokeWidth="2"
          strokeDasharray="6 6"
        />
        <path
          d="M80 32c-9.4 0-17 7.6-17 17 0 12.8 17 27 17 27s17-14.2 17-27c0-9.4-7.6-17-17-17Z"
          fill="var(--color-brand-400)"
        />
        <circle cx="80" cy="49" r="6" fill="#ffffff" />
        <rect x="40" y="92" width="80" height="4" rx="2" fill="var(--color-brand-200)" />
        <rect x="52" y="84" width="4" height="12" rx="2" fill="var(--color-earth-200)" />
        <rect x="104" y="84" width="4" height="12" rx="2" fill="var(--color-earth-200)" />
      </svg>

      <h3 className="mt-4 font-display text-base font-semibold text-slate-900">
        {title}
      </h3>
      {description && (
        <p className="mt-1.5 max-w-md text-sm text-slate-500">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
