import { useEffect, useMemo, useRef, useState } from "react";
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Icon } from "./Icons";
import { InlineAlert } from "./InlineAlert";

/**
 * Geo-tagged beneficiaries on a MapLibre GL map with OpenStreetMap tiles.
 *
 * MapLibre GL is free and open source (no API key, no billing account) and
 * renders WebGL vector/raster tiles. Raster OSM tiles keep the same basemap
 * the app has always had — pragmatic for an LGU deployment. The map is
 * inherently hostile to screen readers, so this component always renders a
 * paired, sortable list view of the same data and the map is aria-hidden.
 *
 * When `onPick` is passed the component becomes a picker: clicking the map
 * reports the chosen coordinates instead of showing popups.
 */

/** Default view: Bayawan City, Negros Oriental — the CVO's coverage area. */
const DEFAULT_CENTER = [9.3638, 122.8022]; // [lat, lng] — same order as the props; converted at the MapLibre callsites

/** Raster style with OSM tiles — no API key, same basemap as before. */
const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

/** Legend colors keyed by animal type — brand/earth ramp tokens. */
const ANIMAL_COLORS = {
  Carabao: "#558b2f",
  Cattle: "#7cb342",
  Goat: "#bb9469",
  Swine: "#825f3c",
  Boar: "#63482e",
};

const RE_DISPERSAL_COLOR = "#2d4d19";

function colorFor(beneficiary) {
  if (beneficiary.is_re_dispersal) return RE_DISPERSAL_COLOR;
  return ANIMAL_COLORS[beneficiary.animal_type] ?? "#558b2f";
}

function popupHtml(beneficiary) {
  const badge = beneficiary.is_re_dispersal
    ? '<p style="margin:4px 0 0;padding:1px 8px;display:inline-block;border-radius:9999px;background:#e7efdd;color:#2d4d19;font-size:10px;font-weight:600;text-transform:uppercase">Re-dispersal recipient</p>'
    : "";
  return (
    `<div style="min-width:12rem;font-size:13px;line-height:1.4">` +
    `<p style="margin:0;font-weight:600;color:#0f172a">${escapeHtml(beneficiary.name_of_farmer)}</p>` +
    `<p style="margin:0;font-size:12px;color:#64748b">${escapeHtml(beneficiary.address)} &middot; ${escapeHtml(beneficiary.animal_type)}</p>` +
    badge +
    `</div>`
  );
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

/**
 * @param {object} props
 * @param {Array<object>} props.beneficiaries geo-tagged rows (latitude/longitude set)
 * @param {boolean} [props.loading]
 * @param {string|null} [props.error]
 * @param {Function} [props.onPick] — picker mode: reports [lat, lng] on map click
 * @param {[number, number]} [props.center] — initial map center as [lat, lng]
 * @param {Array<number>|null} [props.selected] — [lat, lng] marker in picker mode
 */
export function DispersalMap({
  beneficiaries = [],
  loading = false,
  error = null,
  onPick,
  center,
  selected = null,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]); // { marker, beneficiary }
  const selectedMarkerRef = useRef(null);
  const onPickRef = useRef(onPick);
  const [mapReady, setMapReady] = useState(false);
  const [animalFilter, setAnimalFilter] = useState("all");

  // Keep the latest callback without re-creating the map on every render.
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  const centerTo = center ?? selected ?? DEFAULT_CENTER;

  const animalTypes = useMemo(
    () => [...new Set(beneficiaries.map((b) => b.animal_type))].sort(),
    [beneficiaries],
  );

  // Only rows carrying coordinates can be pinned. Without this guard a
  // coordinate-less row (e.g. an import whose address named no covered
  // barangay) would render at 0,0 in the ocean.
  const pinnable = useMemo(
    () =>
      beneficiaries.filter(
        (b) =>
          Number.isFinite(Number(b.latitude)) &&
          Number.isFinite(Number(b.longitude)) &&
          b.latitude !== null &&
          b.longitude !== null &&
          !(Number(b.latitude) === 0 && Number(b.longitude) === 0),
      ),
    [beneficiaries],
  );

  const visible = useMemo(
    () =>
      animalFilter === "all"
        ? pinnable
        : pinnable.filter((b) => b.animal_type === animalFilter),
    [pinnable, animalFilter],
  );

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [centerTo[1], centerTo[0]],
      zoom: 12,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new AttributionControl({ compact: true }),
      "bottom-right",
    );

    if (onPickRef.current) {
      map.getCanvas().style.cursor = "crosshair";
      map.on("click", (event) => {
        onPickRef.current?.([event.lngLat.lat, event.lngLat.lng]);
      });
    }

    map.on("load", () => setMapReady(true));

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = [];
      selectedMarkerRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- center/selected only recenter via the effect below; the map is created once
  }, []);

  // Reconcile markers with the visible rows — add, move, remove.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || onPick) return;

    const byId = new Map(visible.map((beneficiary) => [String(beneficiary.id), beneficiary]));
    const seen = new Set();

    for (const entry of markersRef.current) {
      const beneficiary = byId.get(entry.key);
      if (!beneficiary) continue;

      seen.add(entry.key);
      const position = [Number(beneficiary.longitude), Number(beneficiary.latitude)];
      const color = colorFor(beneficiary);

      if (entry.color !== color || entry.position !== `${position[0]},${position[1]}`) {
        entry.marker.remove();
        entry.marker = makeMarker(map, position, color, popupHtml(beneficiary));
        entry.color = color;
        entry.position = `${position[0]},${position[1]}`;
      }
    }

    for (const [key, beneficiary] of byId) {
      if (seen.has(key)) continue;
      const position = [Number(beneficiary.longitude), Number(beneficiary.latitude)];
      const color = colorFor(beneficiary);
      markersRef.current.push({
        key,
        marker: makeMarker(map, position, color, popupHtml(beneficiary)),
        color,
        position: `${position[0]},${position[1]}`,
      });
    }

    markersRef.current = markersRef.current.filter((entry) => {
      if (byId.has(entry.key)) return true;
      entry.marker.remove();
      return false;
    });
  }, [mapReady, visible, onPick]);

  // Picker mode: keep exactly one marker on the selected spot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !onPick) return;

    selectedMarkerRef.current?.remove();
    selectedMarkerRef.current = null;

    if (selected) {
      selectedMarkerRef.current = makeMarker(
        map,
        [selected[1], selected[0]],
        RE_DISPERSAL_COLOR,
        "<p style=\"margin:0;font-size:13px\">Selected location</p>",
      );
    }
  }, [mapReady, onPick, selected]);

  // Follow the requested center (e.g. geocoded barangay pin) when it moves,
  // in viewer and picker mode alike. Keyed on the coordinates (not the array
  // identity) so unrelated parent re-renders never yank the camera.
  const centerKey = `${centerTo[0]},${centerTo[1]}`;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const [lat, lng] = centerKey.split(",").map(Number);
    map.jumpTo({ center: [lng, lat] });
  }, [mapReady, centerKey]);

  if (error) {
    return <InlineAlert message={error} />;
  }

  if (!loading && pinnable.length === 0 && !onPick) {
    return (
      <div className="py-2">
        <InlineAlert
          tone="info"
          message="No geo-tagged beneficiaries yet — a pin is placed automatically from the barangay when a beneficiary is registered."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!onPick && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-700">Legend:</span>
          {animalTypes.map((type) => (
            <span key={type} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-3 w-3 rounded-full ring-2 ring-white"
                style={{ backgroundColor: colorFor({ animal_type: type }), boxShadow: "0 0 0 1px rgb(15 23 42 / 0.2)" }}
              />
              {type}
            </span>
          ))}
          <label className="ml-auto flex items-center gap-2">
            <span className="sr-only">Filter by animal type</span>
            <select
              className="field !w-auto !py-1.5 text-xs"
              value={animalFilter}
              onChange={(event) => setAnimalFilter(event.target.value)}
              aria-label="Filter map by animal type"
            >
              <option value="all">All animal types</option>
              {animalTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="relative h-[26rem] w-full">
          {loading && (
            <div className="absolute inset-0 z-[500] grid place-items-center bg-white/70">
              <span className="text-sm text-slate-500">Loading map…</span>
            </div>
          )}
          <div
            ref={containerRef}
            aria-hidden="true"
            className="h-full w-full [&_.maplibregl-canvas:focus]:outline-none"
          />
        </div>
      </div>

      {/* Accessible alternative: same data, screen-reader friendly. */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Geo-tagged beneficiaries ({visible.length})
          </h3>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Icon name="info" className="h-3.5 w-3.5" />
            Table view of the map above
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <colgroup>
              <col className="w-[40%]" />
              <col className="w-[30%]" />
              <col />
            </colgroup>
            <caption className="sr-only">
              Beneficiaries with coordinates, sorted by farmer name
            </caption>
            <thead>
              <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                <th scope="col" className="px-4 py-2.5 font-semibold">Farmer</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Barangay</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Animal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...visible]
                .sort((a, b) => a.name_of_farmer.localeCompare(b.name_of_farmer))
                .map((beneficiary) => (
                  <tr key={beneficiary.id} className="transition hover:bg-brand-50/40">
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap text-slate-900">
                      {beneficiary.name_of_farmer}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{beneficiary.address}</td>
                    <td className="px-4 py-2.5 text-slate-600">{beneficiary.animal_type}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function makeMarker(map, position, color, html) {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText =
    "width:18px;height:18px;border-radius:9999px;" +
    `background:${color};border:3px solid #fff;` +
    "box-shadow:0 1px 4px rgb(15 23 42 / 0.45);cursor:pointer";

  const marker = new Marker({ element: el })
    .setLngLat(position)
    .setPopup(new Popup({ offset: 12 }).setHTML(html))
    .addTo(map);
  return marker;
}
