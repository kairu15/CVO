import { useEffect, useRef, useState } from "react";
import { AttributionControl, Map as MapLibreMap, Marker, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Compact live map for the registration cascade.
 *
 * - No selection: framed on the whole city (center of mass of the covered
 *   barangays, which beats anchoring on Poblacion for a zoomed-out view).
 * - Barangay chosen: pans/zooms to that barangay's center.
 * - Purok chosen: moves the marker onto the purok and zooms in further.
 *
 * Uses the same free MapLibre GL + OSM raster basemap as the dashboard maps
 * (no API key). The map is decorative support for the two selects above it —
 * the selects are the accessible controls, so this map is aria-hidden.
 */

/** Default view: Bayawan City, Negros Oriental — the CVO's coverage area. */
const CITY_FALLBACK = [9.3638, 122.8022]; // [lat, lng]

const CITY_ZOOM = 11;
const BARANGAY_ZOOM = 14;
const PUROK_ZOOM = 16;

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

/** Center of mass of the covered barangays, or the city fallback. */
function cityCenter(barangays) {
  const withCoords = (barangays ?? []).filter(
    (b) => Number.isFinite(b.latitude) && Number.isFinite(b.longitude),
  );

  if (withCoords.length === 0) return CITY_FALLBACK;

  return [
    withCoords.reduce((sum, b) => sum + b.latitude, 0) / withCoords.length,
    withCoords.reduce((sum, b) => sum + b.longitude, 0) / withCoords.length,
  ];
}

/**
 * @param {object} props
 * @param {Array<{id: number|null, name: string, latitude: number|null, longitude: number|null}>} props.barangays
 *   the covered barangays (used to frame the whole city before any selection)
 * @param {{latitude: number|null, longitude: number|null}|null} props.barangay
 *   the selected barangay row, or null
 * @param {{latitude: number|null, longitude: number|null}|null} props.purok
 *   the selected purok row, or null
 */
export function RegisterLocationMap({ barangays = [], barangay = null, purok = null }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  // Create the map once, framed on the whole coverage area.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const [lat, lng] = cityCenter(barangays);

    const map = new MapLibreMap({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [lng, lat],
      zoom: CITY_ZOOM,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    map.on("load", () => setMapReady(true));

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- barangays only frame the initial view; camera moves happen in the effect below
  }, []);

  // Follow the selection: barangay pans the camera, purok moves the marker.
  const target = purok?.latitude != null ? purok : barangay?.latitude != null ? barangay : null;
  const targetKey = target ? `${target.latitude},${target.longitude}` : "";

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!target) return;

    const isPurok = target === purok;
    map.jumpTo({
      center: [Number(target.longitude), Number(target.latitude)],
      zoom: isPurok ? PUROK_ZOOM : BARANGAY_ZOOM,
    });

    if (isPurok) {
      markerRef.current?.remove();
      markerRef.current = new Marker({ color: "#2d4d19" })
        .setLngLat([Number(target.longitude), Number(target.latitude)])
        .addTo(map);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the coordinates below, not object identity
  }, [mapReady, targetKey]);

  return (
    <figure className="overflow-hidden rounded-xl border border-brand-200">
      <div
        ref={containerRef}
        aria-hidden="true"
        className="h-64 w-full [&_.maplibregl-canvas:focus]:outline-none"
      />
      <figcaption className="border-t border-brand-100 bg-brand-50/60 px-3 py-2 text-xs text-slate-600">
        {purok
          ? `Showing ${purok.name}, ${barangay?.name ?? ""}`
          : barangay
            ? `Showing ${barangay.name} — pick a purok to pin the exact spot`
            : "Showing Bayawan City — pick a barangay to zoom in"}
      </figcaption>
    </figure>
  );
}
