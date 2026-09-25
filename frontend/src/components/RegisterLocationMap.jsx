import { useEffect, useRef, useState } from "react";
import { AttributionControl, Map as MapLibreMap, Marker, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Compact live map for the registration cascade.
 *
 * - No selection: framed on the whole city (center of mass of the covered
 *   barangays, which beats anchoring on Poblacion for a zoomed-out view).
 * - Barangay chosen: pans/zooms to that barangay's center.
 * - Purok chosen: zooms in further.
 * - Pin set (GPS fix or a dropped/dragged marker): the marker sits on the
 *   farmer's ACTUAL point, is draggable, and clicking the map re-places it.
 *   An accuracy circle shows how precise a GPS fix was.
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
 * @param {[number, number]|null} props.pin
 *   the farmer's actual [lat, lng] — GPS fix or placed/dragged marker
 * @param {number|null} props.accuracy
 *   GPS accuracy in metres for the pin, when the fix reported one
 * @param {([lat, lng]: [number, number]) => void} [props.onPinMove]
 *   called with the new [lat, lng] when the marker is dragged or the map clicked
 */
export function RegisterLocationMap({
  barangays = [],
  barangay = null,
  purok = null,
  pin = null,
  accuracy = null,
  onPinMove,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  // Latest callback/props for event handlers registered once — avoids
  // re-attaching map listeners on every render.
  const onPinMoveRef = useRef(onPinMove);
  const canPlaceRef = useRef(Boolean(barangay));
  onPinMoveRef.current = onPinMove;
  canPlaceRef.current = Boolean(barangay);
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

    // Click-to-place: only meaningful once a barangay is chosen, so the pin
    // always lands inside a known cascade context.
    map.on("click", (event) => {
      if (!canPlaceRef.current || !onPinMoveRef.current) return;
      const { lat: clickLat, lng: clickLng } = event.lngLat;
      onPinMoveRef.current([clickLat, clickLng]);
    });

    map.on("load", () => setMapReady(true));

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- barangays only frame the initial view; camera moves happen in the effect below
  }, []);

  // Marker: sits on the farmer's pin, else on the selected purok's center.
  // Draggable either way — dragging the purok marker simply creates the pin.
  const markerTarget = pin ?? (purok?.latitude != null ? [purok.latitude, purok.longitude] : null);
  const markerKey = markerTarget ? markerTarget.map(Number).join(",") : "";

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!markerTarget) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    const [mLat, mLng] = markerTarget.map(Number);

    if (markerRef.current) {
      markerRef.current.setLngLat([mLng, mLat]);
      return;
    }

    markerRef.current = new Marker({ color: "#2d4d19", draggable: true })
      .setLngLat([mLng, mLat])
      .addTo(map);

    markerRef.current.on("dragend", () => {
      const { lat: draggedLat, lng: draggedLng } = markerRef.current.getLngLat();
      onPinMoveRef.current?.([draggedLat, draggedLng]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the coordinates below, not object identity
  }, [mapReady, markerKey]);

  // GPS accuracy circle around the pin — the farmer sees how precise the
  // fix is before trusting the detected barangay suggestion.
  const accuracyM = Number.isFinite(Number(accuracy)) && pin ? Number(accuracy) : 0;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const update = () => {
      const source = map.getSource("accuracy");
      if (!source) return;

      if (!accuracyM || !pin) {
        source.setData({ type: "FeatureCollection", features: [] });
        return;
      }

      source.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Point",
              coordinates: [Number(pin[1]), Number(pin[0])],
            },
          },
        ],
      });
    };

    if (!map.getSource("accuracy")) {
      map.addSource("accuracy", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "accuracy-circle",
        type: "circle",
        source: "accuracy",
        paint: {
          "circle-radius": 0,
          "circle-color": "#2d4d19",
          "circle-opacity": 0.15,
          "circle-stroke-color": "#2d4d19",
          "circle-stroke-width": 1.5,
          "circle-stroke-opacity": 0.5,
        },
      });
    }

    update();

    const repaint = () => {
      const mapInstance = mapRef.current;
      if (!mapInstance || !accuracyM || !pin) return;

      const zoom = mapInstance.getZoom();
      const latRad = (Number(pin[0]) * Math.PI) / 180;
      // Metres per pixel at this zoom/latitude (Web Mercator, 512px tiles).
      const metresPerPixel =
        (156543.03392 * Math.cos(latRad)) / 2 ** zoom;

      mapInstance.setPaintProperty(
        "accuracy-circle",
        "circle-radius",
        Math.max(3, accuracyM / metresPerPixel),
      );
    };

    repaint();
    map.on("zoom", repaint);

    return () => {
      map.off("zoom", repaint);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on accuracy/pin below
  }, [mapReady, accuracyM, markerKey]);

  // Follow the selection: barangay pans the camera, purok/pin zoom in.
  const target = pin
    ? { lat: Number(pin[0]), lng: Number(pin[1]), zoom: purok ? PUROK_ZOOM : BARANGAY_ZOOM }
    : purok?.latitude != null
      ? { lat: Number(purok.latitude), lng: Number(purok.longitude), zoom: PUROK_ZOOM }
      : barangay?.latitude != null
        ? { lat: Number(barangay.latitude), lng: Number(barangay.longitude), zoom: BARANGAY_ZOOM }
        : null;
  const targetKey = target ? `${target.lat},${target.lng},${target.zoom}` : "";

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !target) return;

    map.jumpTo({
      center: [target.lng, target.lat],
      zoom: target.zoom,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the coordinates below, not object identity
  }, [mapReady, targetKey]);

  return (
    <figure className="overflow-hidden rounded-xl border border-brand-200">
      <div
        ref={containerRef}
        aria-hidden="true"
        className={`h-64 w-full [&_.maplibregl-canvas:focus]:outline-none ${
          barangay ? "cursor-crosshair" : ""
        }`}
      />
      <figcaption className="border-t border-brand-100 bg-brand-50/60 px-3 py-2 text-xs text-slate-600">
        {pin
          ? `Pinned at your ${accuracy ? `location (±${Math.round(accuracy)} m)` : "chosen spot"} — drag the marker or click the map to adjust`
          : purok
            ? `Showing ${purok.name}, ${barangay?.name ?? ""} — drag the marker to the exact spot`
            : barangay
              ? `Showing ${barangay.name} — click the map to pin the exact spot`
              : "Showing Bayawan City — pick a barangay to zoom in"}
      </figcaption>
    </figure>
  );
}
