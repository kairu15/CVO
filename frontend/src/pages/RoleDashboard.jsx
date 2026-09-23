import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { getRole } from "../config/roles";
import { useAuth } from "../context/AuthContext";

/**
 * Role dashboard.
 *
 * One component serves all four roles — the sidebar in the shared layout and
 * the module cards here are both driven by `config/roles.js`. Modules backed
 * by real data (the dispersal map, lineage links) render live; the rest
 * remain marked as placeholders so a partly-built dashboard reads as
 * "coming soon" rather than broken.
 */

// MapLibre is heavy — keep it out of the main bundle and load it only when
// the dashboard's map module is actually shown (admin/doctor).
const DashboardMap = lazy(() =>
  import("../components/DispersalMap").then((m) => ({ default: m.DispersalMap })),
);

export default function RoleDashboard({ roleKey }) {
  const { user } = useAuth();
  const config = getRole(roleKey);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Admin and doctor have city-wide oversight, so the dashboard opens with
  // the live dispersal map. Technician/farmer keep scaffold modules for now.
  const showMap = roleKey === "admin" || roleKey === "doctor";

  useEffect(() => {
    if (!showMap) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    beneficiariesApi
      .list({ per_page: 500 })
      .then((rows) => {
        if (!cancelled) setBeneficiaries(rows ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showMap]);

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
        {!showMap && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-pill bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800">
            <Icon name="info" className="h-3.5 w-3.5" />
            Scaffold only — the modules below are not connected to data yet
          </p>
        )}
      </section>

      {showMap && (
        <section className="card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Geo-Tagged Records</p>
              <h3 className="mt-2 font-display text-base font-bold text-slate-900">
                Dispersal map
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Where the program's animals are, and a table view of the same
                records below for accessibility.
              </p>
            </div>
            <Link
              to={`/dashboard/${roleKey}/map`}
              className="btn-secondary !px-3.5 !py-1.5 text-xs"
            >
              Open full map
              <Icon name="arrow-right" className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="mt-5">
            {error ? (
              <p className="text-sm text-red-700">{error}</p>
            ) : (
              <Suspense fallback={<p className="text-sm text-slate-500">Loading map…</p>}>
                <DashboardMap beneficiaries={beneficiaries} loading={loading} />
              </Suspense>
            )}
          </div>
        </section>
      )}

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

        {showMap && user && beneficiaries.length > 0 && (
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
