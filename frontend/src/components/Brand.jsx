import { site } from "../config/site";
import { Icon } from "./Icons";

/**
 * CVO logo mark + wordmark.
 *
 * @param {object} props
 * @param {string} [props.subtitle] secondary line, e.g. the role label
 * @param {boolean} [props.onBrand] true when sitting on the green overlay
 * @param {string} [props.className]
 */
export function Brand({ subtitle, onBrand = false, className = "" }) {
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl shadow-card ${
          onBrand
            ? "bg-white/20 text-white ring-1 ring-white/40"
            : "bg-gradient-to-br from-brand-300 to-brand-600 text-white"
        }`}
      >
        <Icon name="sprout" className="h-6 w-6" />
      </span>
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
