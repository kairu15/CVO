/**
 * Workload band over a technician's assigned households.
 *
 * The thresholds live server-side (`TechnicianDirectoryService`); this
 * component only paints the `{ key, label, range }` the API returns, so the
 * badge and the filter can never use different boundaries.
 */
const TONES = {
  unassigned: "bg-slate-100 text-slate-600 ring-slate-200",
  light: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  moderate: "bg-amber-50 text-amber-800 ring-amber-200",
  heavy: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function WorkloadBadge({ workload, className = "" }) {
  if (!workload) return null;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ring-1 ${
        TONES[workload.key] ?? TONES.unassigned
      } ${className}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {workload.label}
    </span>
  );
}
