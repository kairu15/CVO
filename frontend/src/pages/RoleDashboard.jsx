import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { mapApi } from "../api/mapApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { SkeletonList } from "../components/Skeleton";
import { flatNav, getRole } from "../config/roles";
import { useAuth } from "../context/AuthContext";
import { useBarangayBoundaries } from "../hooks/useBarangayBoundaries";
import { buildChoropleth, choroplethTooltipHtml } from "../lib/barangayBoundaries";
import { fetchAnimalTrail } from "../lib/ownershipPath";

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

/** The latest recorded day, spelled the way the Dispersal Map page spells it. */
function formatDay(iso) {
  const parsed = new Date(`${iso}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

export default function RoleDashboard({ roleKey }) {
  const { user } = useAuth();
  const config = getRole(roleKey);
  const [snapshot, setSnapshot] = useState(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState(null);

  // Admin and doctor have city-wide oversight, so the dashboard opens with
  // the live dispersal map. Technician keeps scaffold modules for now.
  const showMap = roleKey === "admin" || roleKey === "doctor";
  const boundaries = useBarangayBoundaries();

  // The Overview reads the SAME dated snapshot as the Dispersal Map page:
  // the newest day with ownership events, in "on this date" mode — exactly
  // what the Dispersal Map opens on. Its pins and per-barangay counts come
  // from ONE server answer, so the two maps cannot disagree about where an
  // animal is, and a handover recorded there shows up here on the next poll.
  const snapshotAbortRef = useRef(null);
  const snapshotTokenRef = useRef(0);

  const loadMap = useCallback(
    async (quiet = false) => {
      if (!showMap) {
        setMapLoading(false);
        return;
      }

      if (!quiet) {
        snapshotAbortRef.current?.abort();
        snapshotAbortRef.current = new AbortController();
        setMapLoading(true);
      }
      const signal = snapshotAbortRef.current?.signal;
      const token = ++snapshotTokenRef.current;
      setMapError(null);

      try {
        const dates = await mapApi.dates({ perPage: 1, signal });
        const latest = dates?.dates?.[0]?.date ?? null;
        const data = latest
          ? await mapApi.pins({ date: latest, mode: "on", signal })
          : { pins: [], barangays: [], skipped_no_location: 0, date: null };

        // A slow earlier answer must never overwrite a newer one.
        if (token !== snapshotTokenRef.current) return;

        setSnapshot(data);
        setMapLoading(false);
      } catch (err) {
        if (token !== snapshotTokenRef.current) return;
        if (err?.name === "AbortError" || err?.code === "ERR_CANCELED") return;
        if (!quiet) setMapLoading(false);
        setMapError(getErrorMessage(err));
      }
    },
    [showMap],
  );

  useEffect(() => {
    loadMap();
  }, [loadMap]);

  // Quietly re-fetch so an update made on the Dispersal Map — or anywhere
  // else — appears here too, without a manual reload.
  useAutoRefresh(loadMap, { enabled: showMap });

  const pins = useMemo(() => snapshot?.pins ?? [], [snapshot]);
  const choropleth = useMemo(() => {
    if (boundaries.status !== "ready") return null;
    return buildChoropleth(boundaries.collection, snapshot?.barangays ?? [], {
      metric: "pins",
    });
  }, [boundaries, snapshot]);

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
                Flight paths
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Every dispersed animal's journey at once — origin, handovers
                and where each one stands today — drawn automatically from the
                ownership records for the latest recorded day. Open the
                Dispersal Map to work with a single animal.
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
            {mapError ? (
              <p className="text-sm text-red-700">{mapError}</p>
            ) : (
              <Suspense fallback={<p className="text-sm text-slate-500">Loading map…</p>}>
                <DashboardMap
                  pins={pins}
                  trailFetcher={fetchAnimalTrail}
                  flightPathsOnly
                  loading={mapLoading}
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
                        ariaLabel="Map of Bayawan City's barangays with the program's geo-tagged animals pinned."
                        legend={{
                          stops: ["#eaf3dd", "#c7e2a6", "#8bc34a", "#558b2f", "#33691e"],
                          minLabel: "fewer animals",
                          maxLabel: "more",
                        }}
                        tooltipHtml={choroplethTooltipHtml}
                      />
                    </Suspense>
                  )}
                />
              </Suspense>
            )}
            {!mapLoading && !mapError && (
              <p className="mt-2 text-xs text-slate-500">
                {snapshot?.date
                  ? `${pins.length} flight path${pins.length === 1 ? "" : "s"} drawn for ${formatDay(snapshot.date)} — the same snapshot the Dispersal Map opens on.`
                  : "No dispersal records yet — a recorded dispersal appears here and on the Dispersal Map."}
              </p>
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

        {showMap && user && pins.length > 0 && (
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
