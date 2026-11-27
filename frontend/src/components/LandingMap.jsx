import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildChoropleth,
  normalizeBarangayName,
  SEQUENTIAL_STOPS,
} from "../lib/barangayBoundaries";
import {
  buildCircleFeatures,
  circleSizeSamples,
  CIRCLE_PALETTE,
  INTENSITY_STOPS,
} from "../lib/mapCircles";
import { escapeHtml, parseFeatureRow } from "../lib/mapText";
import { useBarangayBoundaries } from "../hooks/useBarangayBoundaries";
import { BarangayMap } from "./BarangayMap";
import { Icon } from "./Icons";
import { MapInfoPanel } from "./MapInfoPanel";
import { MapModeSwitch } from "./MapModeSwitch";

/**
 * The landing page's live dispersal map — the REAL Bayawan City barangay
 * boundaries on the same map the admin pages wear: green fills by recorded
 * beneficiaries, white boundary outlines and a YELLOW hover following the
 * actual boundary.
 *
 * On top of the fills sit the shared circle markers: one per barangay at its
 * interior label point, sized by that barangay's recorded beneficiaries and
 * coloured green → amber → orange → red by relative load. The whole city
 * breathes on a gently staggered pulse (disabled under reduced motion), and
 * the mode switch lets the visitor flatten the markers (Circles) or lean into
 * the radial light (Glow) without changing a single coordinate. Selecting one
 * highlights it, eases the camera to its boundary and opens the public detail
 * panel — aggregate figures only.
 *
 * Data comes from the public map-summary endpoint: aggregate per-barangay
 * COUNTS of recorded beneficiaries plus program totals. Aggregate-only by
 * design — the landing page has no session, so no farmer names or exact farm
 * coordinates are ever sent to it. The dashboard's DispersalMap is the
 * authenticated, per-farm view.
 *
 * Barangays the summary has not counted yet render in the lightest fill and a
 * small grey circle (they are covered barangays of the program, not "no
 * data"), so the whole city reads as one shape.
 *
 * When the summary API is unreachable (offline demo, backend down) the
 * landing page renders the illustrative SVG instead — the page owns that
 * decision, this component just paints the live map.
 */

/**
 * @param {object} props
 * @param {Array<{name: string, count: number}>} [props.barangays]
 *   per-barangay beneficiary counts from the public summary (count>0 rows only)
 * @param {{beneficiaries?: number}|null} [props.totals] program totals from the
 *   same response — used only for the panel's "share of program" figure
 * @param {string} [props.height] tailwind height classes for the map box
 */
export function LandingMap({
  barangays = [],
  totals = null,
  // Height classes for the map box. The landing snapshot passes a compact,
  // responsive height; the default keeps the roomier hero treatment for any
  // caller that does not.
  height = "h-[60vh] min-h-[420px]",
}) {
  const boundaries = useBarangayBoundaries();
  const [selected, setSelected] = useState(null);
  // Whole view by default; the visitor can flatten the markers (Circles) or
  // lean into the radial light (Glow). Purely presentational — every mode
  // reads the same aggregate snapshot.
  const [mode, setMode] = useState("whole");

  // Join the public counts onto the boundary polygons by barangay name —
  // covered barangays the summary has not counted yet show zero, so the whole
  // city paints in one shape instead of greying out. `count` drives the fill
  // colour, the circle size and the hover label.
  const rows = useMemo(() => {
    if (boundaries.status !== "ready") return [];
    const counts = new Map(
      barangays.map((barangay) => [
        normalizeBarangayName(barangay.name),
        barangay.count,
      ]),
    );
    return boundaries.collection.features.map((feature) => ({
      name: feature.properties?.name ?? "",
      count: counts.get(normalizeBarangayName(feature.properties?.name)) ?? 0,
    }));
  }, [boundaries, barangays]);

  const choropleth = useMemo(() => {
    if (boundaries.status !== "ready") return null;
    return buildChoropleth(boundaries.collection, rows, { metric: "count" });
  }, [boundaries, rows]);

  // Circles are derived from the SAME choropleth, so a circle can never
  // disagree with the polygon it sits on.
  const circles = useMemo(
    () =>
      choropleth
        ? buildCircleFeatures(choropleth, { intensity: true })
        : null,
    [choropleth],
  );

  const selectedRow = useMemo(
    () =>
      selected
        ? rows.find(
            (row) => normalizeBarangayName(row.name) === normalizeBarangayName(selected),
          ) ?? null
        : null,
    [rows, selected],
  );

  // Stable tooltip (the choropleth is memoised); the row rides the feature
  // properties and may arrive serialized — a malformed string must not throw
  // inside a hover handler.
  const tooltipHtml = useCallback((properties) => {
    const parsed = parseFeatureRow(properties?.row);
    const name = parsed?.name ?? properties?.name ?? "";
    const count = parsed?.count ?? 0;
    const safeName = escapeHtml(name);
    return (
      `<div style="min-width:150px">` +
      `<p style="margin:0;font-weight:600;color:#f8fafc">${safeName}</p>` +
      `<p style="margin:2px 0 0;font-size:12px;color:#cbd5e1">${count === 0 ? "No beneficiaries recorded yet" : `<strong>${count}</strong> beneficiar${count === 1 ? "y" : "ies"} recorded`}</p>` +
      `</div>`
    );
  }, []);

  const handleCircleClick = useCallback((name) => {
    setSelected((previous) => (previous === name ? null : name));
  }, []);
  const clearSelection = useCallback(() => setSelected(null), []);

  const samples = useMemo(() => circleSizeSamples(choropleth?.max ?? 0), [choropleth]);
  const cityTotal = Number(totals?.beneficiaries);
  const hasCityTotal = Number.isFinite(cityTotal) && cityTotal > 0;
  const count = selectedRow?.count ?? 0;
  const share = hasCityTotal ? Math.round((count / cityTotal) * 1000) / 10 : null;

  // The public map is the one place markers wear the relative-load ramp, so
  // the ramp needs a key of its own — the polygon legend explains the fill,
  // not the dots.
  const intensityLegend = (
    <div className="flex items-center gap-2">
      <span className="font-semibold">Marker colour</span>
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {[...INTENSITY_STOPS].reverse().map((stop) => (
          <span
            key={stop.id}
            className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-white"
            style={{ background: stop.color }}
            title={stop.label}
          />
        ))}
      </span>
      <span>fewer → more beneficiaries</span>
    </div>
  );

  const sizeLegend = samples.length > 0 && (
    <div className="flex items-center gap-2">
      <span className="font-semibold">Circle size</span>
      <span>recorded beneficiaries</span>
      <span className="flex items-end gap-1" aria-hidden="true">
        {samples.map((sample) => (
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
    <BarangayMap
      boundaries={boundaries}
      choropleth={choropleth}
      circles={circles}
      selectedCircle={selected}
      selectedName={selected}
      onCircleClick={handleCircleClick}
      circleMetricLabel="beneficiaries"
      height={height}
      ariaLabel="Map of Bayawan City's barangays with a circle for each barangay, sized by the number of recorded beneficiaries. Select a barangay for aggregate figures."
      legend={{
        stops: SEQUENTIAL_STOPS,
        minLabel: "fewer beneficiaries",
        maxLabel: "more",
      }}
      sizeLegend={sizeLegend}
      legendNotes={intensityLegend}
      circleMode={mode}
      pulseCircles
      shellClassName="cvo-map--modes"
      // The card is compact: no app toolbar, but the map still pans, zooms
      // (ctrl/scroll guard) and eases to a selected barangay.
      interactive
      cooperativeGestures
      zoomControls
      showToolbar={false}
      showLabels
      tooltipHtml={tooltipHtml}
      overlay={
        <>
          <div className="absolute bottom-3 left-3 z-[600]">
            <MapModeSwitch value={mode} onChange={setMode} />
          </div>
        <MapInfoPanel
          open={Boolean(selectedRow)}
          onClose={clearSelection}
          label="Public barangay summary"
          badge={
            <span className="mb-1.5 inline-flex items-center gap-1 rounded-pill bg-[#285F6B]/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-[#285F6B] uppercase">
              Public aggregate
            </span>
          }
          title={selectedRow?.name ?? ""}
          subtitle="Bayawan City barangay · program participation"
          footer={
            <Link
              to="/transparency"
              className="inline-flex items-center gap-1 font-semibold text-[#285F6B] hover:underline"
            >
              Citywide transparency dashboard
              <Icon name="arrow-right" className="h-3 w-3" />
            </Link>
          }
        >
          <div className="map-panel__stats">
            <div className="map-panel__stat">
              <p className="map-panel__stat-label">Beneficiaries</p>
              <p className="map-panel__stat-value">{count.toLocaleString()}</p>
            </div>
            <div className="map-panel__stat">
              <p className="map-panel__stat-label">Share of program</p>
              <p className="map-panel__stat-value">
                {share === null ? "—" : `${share}%`}
              </p>
            </div>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-slate-600">
            {count === 0
              ? "This barangay is covered by the program but has no beneficiary records in the published summary yet."
              : `${count.toLocaleString()} beneficiar${count === 1 ? "y is" : "ies are"} recorded in ${selectedRow?.name ?? "this barangay"} as of the latest published summary.`}
          </p>

          <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
            <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#367D8A]" />
            Figures are barangay-level aggregates from the office's records. The map
            intentionally carries no household pins on the public site.
          </p>
        </MapInfoPanel>
        </>
      }
    />
  );
}

export default LandingMap;
