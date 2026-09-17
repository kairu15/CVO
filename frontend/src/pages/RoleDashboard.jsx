import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { getRole } from "../config/roles";

/**
 * Blank scaffold dashboard.
 *
 * One component serves all four roles — the sidebar in the shared layout and
 * the placeholder modules here are both driven by `config/roles.js`. Nothing is
 * fetched yet; each card marks a module that will be built against the API
 * later, so the layout can be reviewed before any data model exists.
 */
export default function RoleDashboard({ roleKey }) {
  const config = getRole(roleKey);

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

  const modules = config.nav.filter((item) => !item.to);

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <p className="eyebrow">{config.label}</p>
        <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
          {config.dashboardLabel}
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">{config.blurb}</p>
        <p className="mt-4 inline-flex items-center gap-2 rounded-pill bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800">
          <Icon name="info" className="h-3.5 w-3.5" />
          Scaffold only — the modules below are not connected to data yet
        </p>
      </section>

      <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {modules.map((item) => (
          <article key={item.label} className="card flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <Icon name={item.icon} className="h-5 w-5" />
              </span>
              <span className="rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
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
      </section>

      <section className="card">
        <EmptyState
          title="No data yet"
          description={`Once records are encoded, ${config.dashboardLabel} widgets — maps, tables and summary statistics — will appear here.`}
        />
      </section>
    </div>
  );
}
