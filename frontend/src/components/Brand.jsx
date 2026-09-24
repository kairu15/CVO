import { site } from "../config/site";

/**
 * CVO seal + wordmark.
 *
 * The official seal is served from `public/logo.png` (also the source of the
 * favicon set and the mobile app icon), so the browser caches it across the
 * landing page, auth page and dashboards without touching the JS bundle.
 *
 * @param {object} props
 * @param {string} [props.subtitle] secondary line, e.g. the role label
 * @param {boolean} [props.onBrand] true when sitting on the green overlay
 * @param {string} [props.className]
 */
export function Brand({ subtitle, onBrand = false, className = "" }) {
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <img
        src="/logo.png"
        alt=""
        width={40}
        height={40}
        className={`h-10 w-10 shrink-0 rounded-xl bg-white object-contain shadow-card ${
          onBrand ? "ring-1 ring-white/40" : "ring-1 ring-slate-200/70"
        }`}
      />
      <span className="min-w-0">
        <span
          className={`block font-display text-sm leading-tight font-bold ${
            onBrand ? "text-white" : "text-slate-900"
          }`}
        >
          {site.shortName}
        </span>
        {subtitle && (
          <span
            className={`block truncate text-xs ${
              onBrand ? "text-white/80" : "text-slate-500"
            }`}
          >
            {subtitle}
          </span>
        )}
      </span>
    </div>
  );
}
