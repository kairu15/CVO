import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Icon } from "./Icons";
import { SkeletonDetail, SkeletonList } from "./Skeleton";
import { WorkloadBadge } from "./WorkloadBadge";
import { labelForAction, labelForEntity } from "../lib/auditLabels";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function formatDateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Never"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function purposeLabel(value) {
  if (!value) return "Field visit";
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function initials(name) {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

/**
 * A right-side profile drawer, loaded only when a directory row is opened.
 *
 * It deliberately stays inside the Technicians screen rather than navigating
 * away: an administrator can inspect workload and reassign a household
 * without losing the filter/scroll position of the directory.
 */
export function TechnicianProfileDrawer({
  open,
  technician,
  loading,
  error,
  onClose,
  onRetry,
  onReassign,
}) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    function onKey(event) {
      if (event.key === "Escape") onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    // Move focus into the dialog so Escape and the close control are
    // immediately usable for keyboard and screen-reader users.
    closeRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const inactive = technician?.status === "deactivated";
  const barangays = (technician?.barangays ?? []).map((entry) =>
    typeof entry === "string" ? { name: entry, households: null } : entry,
  );
  const stats = technician
    ? [
        {
          label: "Assigned households",
          value: technician.assigned_households,
          hint: `${barangays.length} ${barangays.length === 1 ? "barangay" : "barangays"}`,
        },
        {
          label: "Visits completed",
          value: technician.visits_completed,
          hint: `${technician.visits_30d} in the last 30 days`,
        },
        {
          label: "Visits due",
          value: technician.due_households,
          hint: "No contact in 60 days",
        },
        {
          label: "Coverage · 30 days",
          value: technician.coverage_pct === null ? "—" : `${technician.coverage_pct}%`,
          hint: `${technician.visited_households_30d} households seen`,
        },
      ]
    : [];

  return createPortal(
    <div className="fixed inset-0 z-40">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm dark:bg-black/60"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Technician profile"
        className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl dark:bg-slate-900"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-200/60 dark:bg-slate-900/95">
          <div>
            <p className="eyebrow">Technician profile</p>
            <h2 className="mt-0.5 font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              {loading ? "Loading…" : (technician?.name ?? "Profile")}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close technician profile"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 dark:hover:bg-brand-100 dark:hover:text-brand-700"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="space-y-6 p-5 sm:p-6">
          {loading && (
            <>
              <SkeletonDetail />
              <SkeletonList rows={4} rowClassName="h-16" className="space-y-3" />
              <SkeletonList rows={3} rowClassName="h-12" className="space-y-3" />
            </>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-sm font-semibold text-rose-800">Could not load this profile</p>
              <p className="mt-1 text-xs text-rose-700">{error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 rounded-pill bg-white px-3.5 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100"
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && technician && (
            <>
              <div className="flex items-start gap-4">
                {technician.avatar_url ? (
                  <img
                    src={technician.avatar_url}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-2xl object-cover ring-1 ring-slate-200"
                  />
                ) : (
                  <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-brand-100 font-display text-lg font-bold text-brand-800">
                    {initials(technician.name)}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                      {technician.name}
                    </h3>
                    <span
                      className={`rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ring-1 ${
                        inactive
                          ? "bg-slate-100 text-slate-600 ring-slate-200"
                          : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                      }`}
                    >
                      {inactive ? "Inactive" : "Active"}
                    </span>
                  </div>
                  <a
                    href={`mailto:${technician.email}`}
                    className="mt-1 block truncate text-sm text-brand-700 hover:underline"
                  >
                    {technician.email}
                  </a>
                  <p className="mt-1 text-xs text-slate-500">
                    Joined {formatDate(technician.created_at)} · Last sign-in{" "}
                    {formatDateTime(technician.last_login_at)}
                  </p>
                </div>
              </div>

              {inactive && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-800">
                  This account is deactivated. Reactivate it in User Management before
                  assigning new households.
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                {stats.map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-xl border border-slate-200 px-3.5 py-3 dark:border-slate-200/60"
                  >
                    <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                      {stat.label}
                    </p>
                    <p className="mt-1 font-display text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                      {stat.value}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{stat.hint}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-200/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                      Workload
                    </p>
                    <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                      {technician.workload.range}
                    </p>
                  </div>
                  <WorkloadBadge workload={technician.workload} />
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Based on households currently assigned, not scheduled visits.
                </p>
              </div>

              <section>
                <div className="flex items-center justify-between gap-3">
                  <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Assigned barangays
                  </h4>
                  <span className="text-xs text-slate-500">{barangays.length}</span>
                </div>
                {barangays.length === 0 ? (
                  <p className="mt-2 rounded-xl bg-slate-50 px-3.5 py-3 text-xs text-slate-500">
                    No barangay assigned yet.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {barangays.map((barangay) => (
                      <span
                        key={barangay.name}
                        className="inline-flex items-center gap-1.5 rounded-pill bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800 ring-1 ring-brand-100"
                      >
                        <Icon name="map-pin" className="h-3.5 w-3.5" />
                        {barangay.name}
                        {barangay.households !== null && (
                          <span className="text-brand-600">· {barangay.households}</span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Assigned households
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      {technician.assigned_households} total
                    </p>
                  </div>
                  <Link
                    to={`/dashboard/admin/beneficiaries?assignment=${technician.id}`}
                    onClick={onClose}
                    className="text-xs font-semibold text-brand-700 hover:underline"
                  >
                    View all
                  </Link>
                </div>

                {technician.assignments.length === 0 ? (
                  <p className="mt-2 rounded-xl bg-slate-50 px-3.5 py-3 text-xs text-slate-500">
                    No households assigned.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-slate-200/60 dark:border-slate-200/60">
                    {technician.assignments.map((beneficiary) => (
                      <li
                        key={beneficiary.id}
                        className="flex items-center gap-3 px-3.5 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {beneficiary.name}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {beneficiary.animal_type}
                            {beneficiary.sex ? ` (${beneficiary.sex})` : ""} ·{" "}
                            {beneficiary.address}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onReassign(beneficiary)}
                          disabled={inactive}
                          className="shrink-0 rounded-pill px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                          title={
                            inactive
                              ? "Reactivate the account before reassigning households."
                              : undefined
                          }
                        >
                          Reassign
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Recent field visits
                </h4>
                {technician.recent_visits.length === 0 ? (
                  <p className="mt-2 rounded-xl bg-slate-50 px-3.5 py-3 text-xs text-slate-500">
                    No field visits logged yet.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {technician.recent_visits.map((visit) => (
                      <li
                        key={visit.id}
                        className="flex items-start gap-3 rounded-xl border border-slate-100 px-3.5 py-2.5 dark:border-slate-200/60"
                      >
                        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
                          <Icon name="route" className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {visit.beneficiary}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {purposeLabel(visit.purpose)} · {visit.address}
                          </p>
                        </div>
                        <time className="shrink-0 text-[11px] text-slate-500">
                          {formatDate(visit.visited_on)}
                        </time>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Recent activity
                </h4>
                {technician.recent_activity.length === 0 ? (
                  <p className="mt-2 rounded-xl bg-slate-50 px-3.5 py-3 text-xs text-slate-500">
                    No recorded activity yet.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {technician.recent_activity.map((event) => (
                      <li key={event.id} className="flex items-start gap-3 text-xs">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                        <div className="min-w-0 flex-1">
                          <p className="text-slate-700 dark:text-slate-300">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {labelForAction(event.action)}
                            </span>
                            {event.target_type
                              ? ` · ${labelForEntity(event.target_type)}`
                              : ""}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {formatDateTime(event.created_at)}
                            {event.actor_name ? ` · ${event.actor_name}` : ""}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
