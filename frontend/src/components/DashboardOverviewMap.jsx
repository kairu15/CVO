import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { mapApi } from "../api/mapApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { Icon } from "./Icons";
import { useBarangayBoundaries } from "../hooks/useBarangayBoundaries";
import { buildChoropleth, SEQUENTIAL_STOPS } from "../lib/barangayBoundaries";
import { buildCircleFeatures, circleSizeSamples, CIRCLE_PALETTE } from "../lib/mapCircles";
import { fetchAnimalTrail } from "../lib/ownershipPath";
import { MapInfoPanel } from "./MapInfoPanel";
import { FLIGHT_TRAIL_LAYER_IDS } from "./DispersalMap";

// MapLibre is heavy — keep it out of the main bundle and load it only when
// a dashboard actually shows its map module.
const DashboardMap = lazy(() =>
  import("./DispersalMap").then((m) => ({ default: m.DispersalMap })),
);

// The same barangay choropleth the Dispersal Map page wears. Loaded with the
// map, never with the page, so the maplibre bundle stays out of the first paint.
const DashboardChoropleth = lazy(() => import("./BarangayMap"));

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

// Static choropleth props, hoisted so the memoised BarangayMap keeps
// its identity across the overview's polls. The trail layers are click-
// through: the trails ARE the content here, and clicking one should never
// select the barangay polygon underneath it.
const OVERVIEW_CLICK_THROUGH = [
  "cvo-date-pins-clusters",
  "cvo-date-pins-point",
  "cvo-date-pins-spider-point",
  ...FLIGHT_TRAIL_LAYER_IDS,
];
const OVERVIEW_LEGEND = {
  stops: SEQUENTIAL_STOPS,
  minLabel: "fewer animals",
  maxLabel: "more",
};
const OVERVIEW_ARIA =
  "Map of Bayawan City's barangays with the program's geo-tagged animals' journeys drawn. Click a barangay to focus its journeys.";

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

  // Circles sized by the same snapshot counts as the polygon fills.
  const circles = useMemo(
    () => (choropleth ? buildCircleFeatures(choropleth) : null),
    [choropleth],
  );
  const sizeSamples = useMemo(() => circleSizeSamples(choropleth?.max ?? 0), [choropleth]);

  // Click-to-focus: selecting a barangay highlights it and dims every other
  // barangay's journeys, so an administrator can read ONE barangay's trails
  // out of the city-wide tangle. The same selection opens the summary panel;
  // clicking it again (or closing the panel) clears both.
  const [focusedBarangay, setFocusedBarangay] = useState(null);
  const [focusedFeatureId, setFocusedFeatureId] = useState(null);
  const handleBarangayClick = useCallback(
    (name, event) => {
      const clear = focusedBarangay === name || name === null;
      setFocusedBarangay(clear ? null : name);
      setFocusedFeatureId(clear ? null : (event?.features?.[0]?.id ?? null));
    },
    [focusedBarangay],
  );
  const handleResetFocus = useCallback(() => {
    setFocusedBarangay(null);
    setFocusedFeatureId(null);
  }, []);

  // The panel reads its number from the SAME snapshot rows as the fills, so
  // it cannot show a different count.
  const focusedRow = useMemo(() => {
    if (!focusedBarangay) return null;
    const row = (snapshot?.barangays ?? []).find(
      (candidate) => candidate.name === focusedBarangay,
    );
    return {
      name: focusedBarangay,
      pins: Number(row?.pins ?? row?.count ?? 0),
    };
  }, [snapshot, focusedBarangay]);

  const sizeLegend = sizeSamples.length > 0 && (
    <div className="flex items-center gap-2">
      <span className="font-semibold">Circle size</span>
      <span>geo-tagged animals</span>
      <span className="flex items-end gap-1" aria-hidden="true">
        {sizeSamples.map((sample) => (
          <span
            key={sample.value}
            className="inline-block rounded-full"
            style={{
              width: sample.size,
              height: sample.size,
              background: CIRCLE_PALETTE.fill,
              boxShadow: `0 0 0 2px #fff, 0 0 8px ${CIRCLE_PALETTE.glow}66`,
            }}
            title={`${sample.value}`}
          />
        ))}
      </span>
    </div>
  );

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
            ownership records for the latest recorded day. Click a barangay
            to focus its journeys; open the Dispersal Map to work with a
            single animal.
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
              selectedBarangay={focusedBarangay}
              renderChoropleth={(onMapReady) => (
                <Suspense
                  fallback={<div className="h-[60vh] min-h-[460px] w-full rounded-xl bg-slate-100" />}
                >
                  <DashboardChoropleth
                    boundaries={boundaries}
                    choropleth={choropleth}
                    height="h-[60vh] min-h-[460px]"
                    // The overview scrolls: the wheel guard keeps the page
                    // scroll free (ctrl+scroll zooms, two fingers on touch).
                    cooperativeGestures
                    // The pin layers are added by the map; the polygons
                    // insert beneath them so a pin is never buried.
                    beforeLayerId="cvo-date-pins-clusters"
                    clickThroughLayers={OVERVIEW_CLICK_THROUGH}
                    onMapReady={onMapReady}
                    ariaLabel={OVERVIEW_ARIA}
                    legend={OVERVIEW_LEGEND}
                    // The trails are the overlay here: the shared toolbar's
                    // "Flight paths" toggle hides them (casing, line, arrows
                    // and stop dots together) without touching the barangay
                    // fills.
                    markerLayerIds={FLIGHT_TRAIL_LAYER_IDS}
                    markerLabel="Flight paths"
                    selectedName={focusedBarangay}
                    selectedFeatureId={focusedFeatureId}
                    onBarangayClick={handleBarangayClick}
                    onReset={handleResetFocus}
                    circles={circles}
                    selectedCircle={focusedBarangay}
                    onCircleClick={handleBarangayClick}
                    circleMetricLabel="geo-tagged animals"
                    sizeLegend={sizeLegend}
                    overlay={
                      <MapInfoPanel
                        open={Boolean(focusedBarangay)}
                        onClose={handleResetFocus}
                        label="Barangay flight-path summary"
                        badge={
                          <span className="mb-1.5 inline-flex items-center gap-1 rounded-pill bg-[#285F6B]/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-[#285F6B] uppercase">
                            Focused barangay
                          </span>
                        }
                        title={focusedRow?.name ?? ""}
                        subtitle={
                          snapshot?.date
                            ? `Latest recorded day · ${formatDay(snapshot.date)}`
                            : "Latest recorded snapshot"
                        }
                        footer={
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span>The map is now filtered to this barangay's trails.</span>
                            <Link
                              to={`/dashboard/${roleKey}/map?barangay=${encodeURIComponent(focusedRow?.name ?? "")}`}
                              className="inline-flex items-center gap-1 font-semibold text-[#285F6B] hover:underline"
                            >
                              Open map
                              <Icon name="arrow-right" className="h-3 w-3" />
                            </Link>
                          </div>
                        }
                      >
                        <div className="map-panel__stats">
                          <div className="map-panel__stat">
                            <p className="map-panel__stat-label">Geo-tagged animals</p>
                            <p className="map-panel__stat-value">
                              {(focusedRow?.pins ?? 0).toLocaleString()}
                            </p>
                          </div>
                          <div className="map-panel__stat">
                            <p className="map-panel__stat-label">Recorded day</p>
                            <p className="map-panel__stat-value">
                              {snapshot?.date ? formatDay(snapshot.date) : "—"}
                            </p>
                          </div>
                        </div>
                        <p className="mt-3 text-xs leading-relaxed text-slate-600">
                          {(focusedRow?.pins ?? 0) === 0
                            ? "No geo-tagged animal in this barangay on the selected snapshot."
                            : `${(focusedRow?.pins ?? 0).toLocaleString()} animal${focusedRow?.pins === 1 ? "" : "s"} in ${focusedRow?.name} have a journey drawn from the same ownership records as the Dispersal Map.`}
                        </p>
                      </MapInfoPanel>
                    }
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
              ? `Latest recorded day ${formatDay(snapshot.date)} — ${pins.length} geo-tagged animal${pins.length === 1 ? "" : "s"}'s journey drawn. The same snapshot the Dispersal Map opens on.`
              : "No dispersal records yet — a recorded dispersal appears here and on the Dispersal Map."}
          </p>
        )}
      </div>
    </section>
  );
}
