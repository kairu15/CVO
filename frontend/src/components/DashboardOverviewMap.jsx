import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { mapApi } from "../api/mapApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { Icon } from "./Icons";
import { useBarangayBoundaries } from "../hooks/useBarangayBoundaries";
import { buildChoropleth } from "../lib/barangayBoundaries";
import { fetchAnimalTrail } from "../lib/ownershipPath";

// MapLibre is heavy — keep it out of the main bundle and load it only when
// a dashboard actually shows its map module.
const DashboardMap = lazy(() =>
  import("./DispersalMap").then((m) => ({ default: m.DispersalMap })),
);

// The same barangay choropleth the Dispersal Map page wears. Loaded with the
// map, never with the page, so the maplibre bundle stays out of the first paint.
const DashboardChoropleth = lazy(() => import("./BarangayChoropleth"));

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

/**
 * The dashboards' live "Flight paths" card — the overview's Geographical
 * Overview section, shared by the admin command center and the technician
 * dashboard.
 *
 * Reads the SAME dated snapshot as the Dispersal Map page: the newest day
 * with ownership events, in "on this date" mode — exactly what the Dispersal
 * Map opens on. Its pins and per-barangay counts come from ONE server
 * answer, so the two maps cannot disagree about where an animal is, and a
 * handover recorded there shows up here on the next poll.
 */
export function DashboardOverviewMap({ roleKey }) {
  const [snapshot, setSnapshot] = useState(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState(null);
  const boundaries = useBarangayBoundaries();

  const snapshotAbortRef = useRef(null);
  const snapshotTokenRef = useRef(0);

  const loadMap = useCallback(async (quiet = false) => {
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
  }, []);

  useEffect(() => {
    loadMap();
  }, [loadMap]);

  // Quietly re-fetch so an update made on the Dispersal Map — or anywhere
  // else — appears here too, without a manual reload.
  useAutoRefresh(loadMap);

  const pins = useMemo(() => snapshot?.pins ?? [], [snapshot]);
  const choropleth = useMemo(() => {
    if (boundaries.status !== "ready") return null;
    return buildChoropleth(boundaries.collection, snapshot?.barangays ?? [], {
      metric: "pins",
    });
  }, [boundaries, snapshot]);

  return (
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
                  fallback={<div className="h-[60vh] min-h-[460px] w-full rounded-xl bg-slate-100" />}
                >
                  <DashboardChoropleth
                    boundaries={boundaries}
                    choropleth={choropleth}
                    height="h-[60vh] min-h-[460px]"
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
                    // Every barangay wears its name and its dispersal
                    // count on the map itself — no hover needed, and no
                    // cursor-side label to cover the controls.
                    showLabels
                    labelShowCounts
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
  );
}
