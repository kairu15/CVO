import { useMemo } from "react";
import {
  buildChoropleth,
  normalizeBarangayName,
  SEQUENTIAL_STOPS,
} from "../lib/barangayBoundaries";
import { useBarangayBoundaries } from "../hooks/useBarangayBoundaries";
import { BarangayChoropleth } from "./BarangayChoropleth";

/**
 * The landing page's live dispersal map — the REAL Bayawan City barangay
 * boundaries on the same choropleth the admin pages wear: green fills by
 * dispersal count, white boundary outlines, a YELLOW hover following the
 * actual boundary with the barangay's name and count.
 *
 * DELIBERATELY a pinned display map: no barangay name labels (they overlap
 * at the city-wide frame) and NO zoom or pan — the camera fits the
 * barangay boundaries exactly and stays there, so the card always shows the
 * same clean, uncluttered view of Bayawan City with the neighbouring
 * municipalities cropped out. Hovering a barangay is the way to read it.
 *
 * Data comes from the public map-summary endpoint: aggregate per-barangay
 * counts only. Aggregate-only by design — the landing page has no session,
 * so no farmer names or exact farm coordinates are ever sent to it. The
 * dashboard's DispersalMap is the authenticated, per-farm view.
 *
 * Barangays the summary has not counted yet render in the lightest fill
 * (they are covered barangays of the program, not "no data"), so the whole
 * city reads as one shape.
 *
 * When the summary API is unreachable (offline demo, backend down) the card
 * falls back to the illustrative SVG via `renderFallback`, so the landing
 * page never shows an empty box.
 */

/**
 * @param {object} props
 * @param {Array<{name: string, lat: number, lng: number, count: number}>} [props.barangays]
 *   per-barangay dispersal counts from the public summary (count>0 rows only)
 * @param {{lat: number, lng: number}} [props.center]
 * @param {boolean} [props.loading]
 * @param {string|null} [props.error]
 * @param {Function} [props.renderFallback] — rendered instead of the map when `error` is set
 */
export function LandingMap({
  barangays = [],
  center,
  loading = false,
  error = null,
  renderFallback,
}) {
  const boundaries = useBarangayBoundaries();

  // Join the public counts onto the boundary polygons by barangay name —
  // covered barangays the summary has not counted yet disperse zero, so the
  // whole city paints in one shape instead of greying out. `count` drives
  // the fill colour and the hover label.
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

  if (error && renderFallback) {
    return renderFallback();
  }

  return (
    <BarangayChoropleth
      boundaries={boundaries}
      choropleth={choropleth}
      height="h-72 sm:h-96"
      ariaLabel="Map of Bayawan City's barangays, shaded by how many animals were dispersed to each"
      legend={{
        stops: SEQUENTIAL_STOPS,
        minLabel: "fewer dispersals",
        maxLabel: "more",
      }}
      // Pinned display map: the camera never moves, the labels never
      // overlap — a barangay identifies itself on hover instead.
      interactive={false}
      tooltipHtml={(properties) => {
        const row = properties?.row;
        const parsed = typeof row === "string" ? JSON.parse(row) : row;
        const name = parsed?.name ?? properties?.name ?? "";
        const count = parsed?.count ?? 0;
        const safeName = String(name).replace(/[&<>"']/g, (ch) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch]);
        return (
          `<div style="min-width:150px">` +
          `<p style="margin:0;font-weight:600;color:#f8fafc">${safeName}</p>` +
          `<p style="margin:2px 0 0;font-size:12px;color:#cbd5e1">${count === 0 ? "No dispersals yet" : `<strong>${count}</strong> dispersed`}</p>` +
          `</div>`
        );
      }}
    />
  );
}

export default LandingMap;
