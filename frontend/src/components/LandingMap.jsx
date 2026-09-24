import { useEffect, useMemo, useRef, useState } from "react";
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
} from "maplibre-gl";
import { OSM_STYLE } from "../config/mapStyle";

/**
 * The landing page's live dispersal map — aggregated program statistics on a
 * real, pannable MapLibre map.
 *
 * Data comes from the public map-summary endpoint: one bubble per barangay,
 * sized by how many animals were dispersed there, sitting on the barangay
 * centroid. Aggregate-only by design — the landing page has no session, so
 * no farmer names or exact farm coordinates are ever sent to it. The
 * dashboard's DispersalMap is the authenticated, per-farm view.
 *
 * When the API is unreachable (offline demo, backend down) the card falls
 * back to the original illustrative SVG via `renderFallback`, so the landing
 * page never shows an empty box.
 */

/** Bayawan City centre — the fallback view before/without data. */
const FALLBACK_CENTER = [122.8022, 9.3638]; // [lng, lat] — MapLibre order

/** Bubble size ramp: radius in pixels across the count scale. */
function radiusFor(count, max) {
  if (max <= 1) return 12;
  const t = Math.min(count / max, 1);
  return 8 + t * 10; // 8px → 18px
}

/**
 * @param {object} props
 * @param {Array<{name: string, lat: number, lng: number, count: number}>} [props.barangays]
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
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [ready, setReady] = useState(false);

  const mapCenter = useMemo(
    () => [center?.lng ?? FALLBACK_CENTER[0], center?.lat ?? FALLBACK_CENTER[1]],
    [center?.lng, center?.lat],
  );

  // Create the map once — or re-create it if the fallback boundary flips
  // (error cleared after a retry).
  useEffect(() => {
    if (!containerRef.current || mapRef.current || error) return undefined;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: OSM_STYLE,
      center: mapCenter,
      zoom: 10,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    map.on("load", () => setReady(true));

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = [];
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; the camera is managed below
  }, [error]);

  // Reconcile bubbles with the barangay rows — add, move, resize, remove.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || error) return;

    const max = Math.max(1, ...barangays.map((b) => b.count));
    const byName = new Map(barangays.map((b) => [b.name, b]));
    const seen = new Set();

    for (const entry of markersRef.current) {
      const barangay = byName.get(entry.name);
      if (!barangay) continue;

      seen.add(entry.name);
      const position = [barangay.lng, barangay.lat];

      if (entry.count !== barangay.count || entry.position !== position.join(",")) {
        entry.marker.remove();
        entry.marker = makeBubble(map, position, barangay, max);
        entry.count = barangay.count;
        entry.position = position.join(",");
      }
    }

    for (const [name, barangay] of byName) {
      if (seen.has(name)) continue;
      const position = [barangay.lng, barangay.lat];
      markersRef.current.push({
        name,
        marker: makeBubble(map, position, barangay, max),
        count: barangay.count,
        position: position.join(","),
      });
    }

    markersRef.current = markersRef.current.filter((entry) => {
      if (byName.has(entry.name)) return true;
      entry.marker.remove();
      return false;
    });
  }, [ready, barangays, error]);

  // Reframe when the computed center changes (e.g. first data arrival).
  const centerKey = `${mapCenter[1]},${mapCenter[0]}`;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const [lat, lng] = centerKey.split(",").map(Number);
    map.jumpTo({ center: [lng, lat], zoom: 10 });
  }, [ready, centerKey]);

  if (error && renderFallback) {
    return renderFallback();
  }

  return (
    <div className="relative h-64 w-full sm:h-72">
      {(loading || !ready) && (
        <div className="absolute inset-0 z-[10] grid place-items-center bg-brand-50">
          <span className="text-xs font-medium text-slate-500">Loading map…</span>
        </div>
      )}
      <div
        ref={containerRef}
        aria-hidden="true"
        className="h-full w-full [&_.maplibregl-canvas:focus]:outline-none"
      />
    </div>
  );
}

/**
 * A count bubble: brand circle with the number inside, sized relative to the
 * busiest barangay so the map reads at a glance even before anyone opens a
 * popup, which names the barangay.
 */
function makeBubble(map, position, barangay, max) {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  const radius = radiusFor(barangay.count, max);
  const fontSize = radius >= 14 ? 11 : 10;

  el.style.cssText =
    `width:${radius * 2}px;height:${radius * 2}px;border-radius:9999px;` +
    "display:grid;place-items:center;" +
    "background:var(--color-brand-600);color:#fff;" +
    `font-size:${fontSize}px;font-weight:700;line-height:1;` +
    "border:2px solid #fff;" +
    "box-shadow:0 1px 4px rgb(15 23 42 / 0.35);cursor:pointer;" +
    "font-family:Inter,system-ui,sans-serif;";

  const label = document.createElement("span");
  label.textContent = String(barangay.count);
  el.appendChild(label);

  const marker = new Marker({ element: el })
    .setLngLat(position)
    .setPopup(
      new Popup({ offset: 14 }).setHTML(
        `<div style="font-size:12px;line-height:1.4">` +
          `<p style="margin:0;font-weight:600;color:#0f172a">${escapeHtml(barangay.name)}</p>` +
          `<p style="margin:2px 0 0;color:#64748b">${barangay.count} dispersed</p>` +
          `</div>`,
      ),
    )
    .addTo(map);
  return marker;
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
