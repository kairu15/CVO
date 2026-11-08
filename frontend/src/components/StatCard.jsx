import { Link } from "react-router-dom";
import { Icon } from "./Icons";

/**
 * Small labelled figure — the KPI tile the summary bands are built from.
 *
 * Plain by default (Reports' summary bands); with `to` it becomes a
 * quick-access card that navigates to the module behind the number, and
 * `icon`/`tone` dress that variant. Same DOM shape either way.
 */
export function StatCard({ label, value, hint, to, icon, tone = "default" }) {
  const toneClass =
    tone === "warning"
      ? "bg-amber-50 border-amber-200"
      : tone === "brand"
        ? "bg-brand-50/70 border-brand-200"
        : "";

  const body = (
    <div className={`rounded-xl border border-slate-200 px-4 py-3 ${toneClass}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        {icon && <Icon name={icon} className="h-3.5 w-3.5 text-brand-600" />}
        {label}
      </p>
      <p className="mt-1 font-display text-xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );

  if (!to) return body;

  return (
    <Link to={to} className="block transition hover:border-brand-300 hover:shadow-card rounded-xl">
      {body}
    </Link>
  );
}
