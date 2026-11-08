import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { SkeletonList } from "../components/Skeleton";
import { DashboardOverviewMap } from "../components/DashboardOverviewMap";
import { flatNav, getRole } from "../config/roles";
import { useAuth } from "../context/AuthContext";

/**
 * Role dashboard.
 *
 * Serves the technician (and any future role without a purpose-built
 * overview): the sidebar in the shared layout and the module cards here are
 * both driven by `config/roles.js`. Modules backed by real data (the
 * dispersal map, lineage links) render live; the rest remain marked as
 * placeholders so a partly-built dashboard reads as "coming soon" rather
 * than broken. The admin role has its own command center instead
 * (AdminOverviewPage).
 */

// The barangay analytics widget fetches its own aggregate.
const BarangayDispersalWidget = lazy(() =>
  import("../components/BarangayDispersalWidget").then((m) => ({ default: m.BarangayDispersalWidget })),
);

export default function RoleDashboard({ roleKey }) {
  const { user } = useAuth();
  const config = getRole(roleKey);

  // Both staff roles have city-wide oversight (the technician absorbed the
  // old doctor role's), so this dashboard opens with the live dispersal map.
  const showMap = roleKey === "admin" || roleKey === "technician";

  if (!config) {
    return (
      <div className="card">
        <EmptyState
          title="No dashboard assigned"
          description="Your account does not have a dashboard yet. Contact the CVO administrator."
        />
      </div>
    );
  }

  const modules = flatNav(config.key).filter((item) => !item.to);

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <p className="eyebrow">{config.label}</p>
        <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
          {config.dashboardLabel}
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">{config.blurb}</p>
        {!showMap && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-pill bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800">
            <Icon name="info" className="h-3.5 w-3.5" />
            Scaffold only — the modules below are not connected to data yet
          </p>
        )}
      </section>

      {showMap && <DashboardOverviewMap roleKey={roleKey} />}

      {/* Barangay dispersal at a glance — top/bottom five for one metric,
          linking to the full analytics tab. City-wide oversight for both
          staff roles. */}
      {showMap && (
        <Suspense fallback={<SkeletonList rows={1} rowClassName="h-48" />}>
          <BarangayDispersalWidget roleKey={roleKey} />
        </Suspense>
      )}

      <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {modules.map((item) => (
          <article key={item.label} className="card flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <Icon name={item.icon} className="h-5 w-5" />
              </span>
              <span className="rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-slate-500 uppercase dark:bg-slate-200/60 dark:text-slate-500">
                No data yet
              </span>
            </div>

            <h3 className="mt-4 font-display text-sm font-semibold text-slate-900">
              {item.label}
            </h3>
            <p className="mt-1.5 text-xs text-slate-500">
              Placeholder for this module — widgets arrive in a later iteration.
            </p>

            {/* Skeleton lines stand in for the future table/chart/map. */}
            <div className="mt-4 space-y-2" aria-hidden="true">
              <div className="h-2.5 w-full rounded-full bg-slate-100" />
              <div className="h-2.5 w-4/5 rounded-full bg-slate-100" />
              <div className="h-2.5 w-2/3 rounded-full bg-slate-100" />
            </div>
          </article>
        ))}

        {showMap && user && (
          <article className="card flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <Icon name="refresh" className="h-5 w-5" />
              </span>
              <span className="rounded-pill bg-brand-100 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-brand-800 uppercase">
                Live
              </span>
            </div>

            <h3 className="mt-4 font-display text-sm font-semibold text-slate-900">
              Re-dispersal tracking
            </h3>
            <p className="mt-1.5 text-xs text-slate-500">
              Trace where a dispersed animal's offspring went — open any
              beneficiary's lineage from the beneficiaries directory.
            </p>
            <Link
              to={`/dashboard/${roleKey}/beneficiaries`}
              className="btn-secondary mt-4 !px-3.5 !py-1.5 text-xs"
            >
              View beneficiaries
            </Link>
          </article>
        )}
      </section>

      {!showMap && (
        <section className="card">
          <EmptyState
            title="No data yet"
            description={`Once records are encoded, ${config.dashboardLabel} widgets — maps, tables and summary statistics — will appear here.`}
          />
        </section>
      )}
    </div>
  );
}
