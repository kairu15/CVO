import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { SkeletonList } from "../components/Skeleton";
import { flatNav, getRole } from "../config/roles";
import { useAuth } from "../context/AuthContext";
import { useBarangayBoundaries } from "../hooks/useBarangayBoundaries";
import { buildChoropleth, choroplethTooltipHtml } from "../lib/barangayBoundaries";
import { validCoordinates } from "../lib/mapPins";

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

// The same barangay choropleth the Dispersal Map page wears. Loaded with the
// map, never with the page, so the maplibre bundle stays out of the first paint.
const DashboardChoropleth = lazy(() => import("../components/BarangayChoropleth"));

// The barangay analytics widget (admin/doctor) fetches its own aggregate.
const BarangayDispersalWidget = lazy(() =>
  import("../components/BarangayDispersalWidget").then((m) => ({ default: m.BarangayDispersalWidget })),
);

export default function RoleDashboard({ roleKey }) {
  const { user } = useAuth();
  const config = getRole(roleKey);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Admin and doctor have city-wide oversight, so the dashboard opens with
  // the live dispersal map. Technician keeps scaffold modules for now.
  const showMap = roleKey === "admin" || roleKey === "doctor";
  const boundaries = useBarangayBoundaries();

  // The Overview pins HOUSEHOLDS, not a date's dispatches: every beneficiary
  // becomes one pin at its registered location, keyed by its own id. Shaping
  // the rows as pins puts them on the shared CLUSTERED layer the Dispersal Map
  // uses, so the two maps look and behave alike without the Overview growing
  // a date selector or a per-date side list.
  const locationPins = useMemo(
    () =>
      beneficiaries.map((row) => ({
        animal_id: row.id,
        owner: {
          id: row.id,
          label: row.name_of_farmer ?? "Unknown owner",
          masked: false,
        },
        barangay: row.address ?? "",
        animal_type: row.animal_type_name ?? row.animal_type ?? "Unspecified",
        ear_tag_number: row.ear_tag_number ?? null,
        latitude: row.latitude,
        longitude: row.longitude,
      })),
    [beneficiaries],
  );

  // The same pins, counted per barangay, are the choropleth's fill: the
  // polygons answer "how many households are pinned here" — the Overview's
  // question, not the Dispersal Map's per-date counts. Rows whose address is
  // not a covered barangay simply get no count.
  const barangayRows = useMemo(() => {
    const counts = new Map();
    for (const pin of locationPins) {
      if (!pin.barangay) continue;
      if (!validCoordinates(Number(pin.latitude), Number(pin.longitude))) continue;
      counts.set(pin.barangay, (counts.get(pin.barangay) ?? 0) + 1);
    }
    return [...counts].map(([name, pins]) => ({ name, pins }));
  }, [locationPins]);

  const choropleth = useMemo(() => {
    if (boundaries.status !== "ready") return null;
    return buildChoropleth(boundaries.collection, barangayRows, { metric: "pins" });
  }, [boundaries, barangayRows]);

  const load = useCallback(
    async (quiet = false) => {
      if (!showMap) {
        setLoading(false);
        return;
      }

      if (!quiet) setLoading(true);
      setError(null);

      try {
        setBeneficiaries((await beneficiariesApi.list({ per_page: 500 })) ?? []);
      } catch (err) {
        if (!quiet) setError(getErrorMessage(err));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [showMap],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Quietly re-fetch so the dashboard map tracks beneficiary additions made elsewhere.
  useAutoRefresh(load);

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

      {showMap && (
        <section className="card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Geo-Tagged Records</p>
              <h3 className="mt-2 font-display text-base font-bold text-slate-900">
                Pinned locations
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Every household on record, pinned on the barangay map. A pin
                names its farmer and animal; the table below lists the same
                records for accessibility.
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
                <DashboardMap
                  pins={locationPins}
                  pinMode="beneficiary"
                  loading={loading}
                  renderChoropleth={(onMapReady) => (
                    <Suspense
                      fallback={<div className="h-[26rem] w-full rounded-xl bg-slate-100" />}
                    >
                      <DashboardChoropleth
                        boundaries={boundaries}
                        choropleth={choropleth}
                        height="h-[26rem]"
                        // The pin layers are added by the map; the polygons
                        // insert beneath them so a pin is never buried.
                        beforeLayerId="cvo-date-pins-clusters"
                        clickThroughLayers={[
                          "cvo-date-pins-clusters",
                          "cvo-date-pins-point",
                          "cvo-date-pins-spider-point",
                        ]}
                        onMapReady={onMapReady}
                        ariaLabel="Map of Bayawan City's barangays with the program's geo-tagged households pinned."
                        legend={{
                          stops: ["#eaf3dd", "#c7e2a6", "#8bc34a", "#558b2f", "#33691e"],
                          minLabel: "fewer pins",
                          maxLabel: "more",
                        }}
                        tooltipHtml={choroplethTooltipHtml}
                      />
                    </Suspense>
                  )}
                />
              </Suspense>
            )}
          </div>
        </section>
      )}

      {/* Barangay dispersal at a glance — top/bottom five for one metric,
          linking to the full analytics tab. Admin and doctor oversight. */}
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
