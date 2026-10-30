import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { fetchOwnershipTrail } from "../lib/ownershipPath";
import { colorFor, pinFeatures, spiderPositions, validCoordinates } from "../lib/mapPins";
import { getErrorMessage } from "../api/client";
import { useOptionalToast } from "../context/ToastContext";
import {
  buildArrows,
  buildPointMarkers,
  buildSegments,
  dateRangeLabel,
  formatPointDate,
  sameLocationPoints,
  sanitizePoints,
  toLngLat,
} from "../lib/flightPath";
import { spreadPositions } from "../lib/mapPositions";

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

/** The element the browser currently shows fullscreen, vendor-prefixed for older Safari. */
function fullscreenElement() {
  return document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
}

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

const RE_DISPERSAL_COLOR = "#2d4d19";

/*
 * The per-beneficiary "flight path": the chronological trail from an
 * animal's origin, through every GPS-tagged field visit, to its current pin.
 *
 * Drawn as MapLibre sources/layers (not DOM markers) so a long trail stays
 * one WebGL-drawn feature per segment — hundreds of segments still render in
 * a frame — and so the fade, arrows and hover all come from the same data.
 * Nothing is rendered until a pin asks for it: with a screen full of
 * households, every trail on at once would be visual noise, not history.
 */
const PATH_SOURCES = {
  segments: "cvo-flight-segments",
  arrows: "cvo-flight-arrows",
  points: "cvo-flight-points",
};

const PATH_LAYERS = {
  casing: "cvo-flight-casing",
  line: "cvo-flight-line",
  approximate: "cvo-flight-approximate",
  arrows: "cvo-flight-arrows",
  points: "cvo-flight-points",
};

const PATH_ARROW_IMAGE = "cvo-flight-arrow";

/** All-trails overview: cap arrowheads so a city-wide view stays legible. */
const ALL_PATHS_ARROW_LIMIT = 400;

/** Concurrent path requests while the overview is being assembled. */
const ALL_PATHS_CONCURRENCY = 6;

/** Idle "show all flight paths" state. */
const NO_ALL_PATHS = {
  active: false,
  loading: false,
  loaded: 0,
  total: 0,
  failed: 0,
  paths: [], // [{ beneficiary, points }] — only trails with movement
};

/** Trail endpoints, from the brand ramp — deliberately NOT an animal colour. */
const PATH_OLD_COLOR = "#a5d6a7"; // brand-300, the faded origin end
const PATH_NEW_COLOR = "#2d4d19"; // brand-900, the saturated recent end

/** Flag glyph for the origin: a pole with a pennant, in the brand green. */
const ORIGIN_FLAG_SVG =
  '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M5 2v16" stroke="#2d4d19" stroke-width="2.2" stroke-linecap="round" fill="none"/>' +
  '<path d="M6 3h8l-2.6 3L14 9H6z" fill="#2d4d19"/>' +
  "</svg>";

/** Arrowhead pointing UP the page; `icon-rotate` then swings it by bearing. */
const PATH_ARROW_SVG =
  // width/height are not decoration: an SVG with only a viewBox decodes to a
  // zero-sized image in Chrome, and MapLibre then refuses to register it.
  '<svg viewBox="0 0 12 12" width="12" height="12" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M6 0.7 10.9 10.5 6 8.1 1.1 10.5Z" fill="#2d4d19" stroke="#ffffff" stroke-width="0.9" stroke-linejoin="round"/>' +
  "</svg>";

/**
 * @param {object} props
 * @param {boolean} [props.flightActive] this household's trail is on the map
 * @param {boolean} [props.showFlightPath] offer the show/hide toggle (viewer
 *   mode only — the picker's popup has no trail to reveal)
 */
function popupHtml(
  beneficiary,
  { flightActive = false, showFlightPath = false, offerRedisperse = false } = {},
) {
  const badge = beneficiary.is_re_dispersal
    ? '<p style="margin:4px 0 0;padding:1px 8px;display:inline-block;border-radius:9999px;background:#e7efdd;color:#2d4d19;font-size:10px;font-weight:600;text-transform:uppercase">Re-dispersal recipient</p>'
    : "";
  // The pin's own "Re-disperse" action: a dispersal starts where the animal
  // already is, so the map pin is the natural place to record one.
  const redisperse = offerRedisperse
    ? '<button type="button" class="cvo-redisperse"' +
      ` data-redisperse-id="${escapeHtml(String(beneficiary.id))}"` +
      ' style="margin-top:8px;margin-left:6px;display:inline-flex;align-items:center;gap:5px;border-radius:9999px;border:1px solid #c8e6c9;background:#f3f9ee;padding:3px 10px;font-size:11px;font-weight:600;color:#3f6b22;cursor:pointer">' +
      "Re-disperse</button>"
    : "";
  const toggle = showFlightPath
    ? '<button type="button" class="cvo-path-toggle"' +
      ` data-path-id="${escapeHtml(String(beneficiary.id))}"` +
      ' style="margin-top:8px;display:inline-flex;align-items:center;gap:5px;border-radius:9999px;border:1px solid #c8e6c9;background:#f3f9ee;padding:3px 10px;font-size:11px;font-weight:600;color:#3f6b22;cursor:pointer">' +
      `<svg viewBox="0 0 20 20" width="11" height="11" aria-hidden="true" style="flex:none"><path d="M5 2v16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/><path d="M6 3h8l-2.6 3L14 9H6z" fill="currentColor"/></svg>` +
      (flightActive ? "Hide flight path" : "Show flight path") +
      "</button>"
    : "";
  return (
    `<div style="min-width:12rem;font-size:13px;line-height:1.4">` +
    `<p style="margin:0;font-weight:600;color:#0f172a">${escapeHtml(beneficiary.name_of_farmer)}</p>` +
    `<p style="margin:0;font-size:12px;color:#64748b">${escapeHtml(beneficiary.address)} &middot; ${escapeHtml(beneficiary.animal_type)}</p>` +
    badge +
    toggle +
    redisperse +
    `</div>`
  );
}

/** Popup for one point on a trail — the same card language as the pins. */
function pathPointHtml(properties) {
  const label = properties.label ?? "";
  return (
    `<div style="min-width:10rem;font-size:13px;line-height:1.4">` +
    `<p style="margin:0;font-weight:600;color:#0f172a">${escapeHtml(properties.title ?? "")}</p>` +
    (label
      ? `<p style="margin:0;font-size:12px;color:#64748b">${escapeHtml(label)}</p>`
      : "") +
    (properties.subtitle
      ? `<p style="margin:2px 0 0;font-size:12px;color:#64748b">${escapeHtml(properties.subtitle)}</p>`
      : "") +
    `</div>`
  );
}

/**
 * Why a selected household's trail cannot be drawn — in plain language.
 *
 * "No line" has two very different meanings (a failed request vs. an animal
 * with only one recorded stop), and the user can act on each one. Returning
 * null means there IS a line, so the panel shows its normal heading.
 */
function noPathReason(flightPath) {
  if (flightPath.error) return "Couldn't load the path. Try again.";
  if (!flightPath.empty) return null;

  const points = flightPath.points ?? [];
  const unlocated = flightPath.unlocated ?? [];
  const namedOwner = unlocated.find((node) => node.kind !== "origin" && node.label);

  if (points.length === 0) {
    return namedOwner
      ? `Owner ${namedOwner.label} has no location yet. Add a geotag to draw this stop.`
      : "No location recorded for this household yet. Add a geotag to draw it.";
  }

  if (unlocated.length > 0) {
    return namedOwner
      ? `Owner ${namedOwner.label} has no location yet. Add a geotag to draw this stop.`
      : "Only one location recorded. Re-disperse this animal to see a path.";
  }

  return "Only one location recorded. Re-disperse this animal to see a path.";
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

/*
 * The DATE-VIEW pin layer: animal-keyed pins on a CLUSTERED MapLibre source.
 *
 * Why clustered: several animals share one household pin (and barangay-
 * centroid fallbacks share a centre), so plain markers stack into one dot
 * and hide each other. Clusters carry a count badge and expand on click;
 * zooming past the cluster threshold leaves single pins. No jitter is added
 * — a pin sits where the record says it is.
 */

const PIN_SOURCE = "cvo-date-pins";
const SPIDER_SOURCE = "cvo-date-pins-spider";
const PIN_LAYERS = {
  clusters: "cvo-date-pins-clusters",
  clusterCount: "cvo-date-pins-cluster-count",
  points: "cvo-date-pins-point",
  selected: "cvo-date-pins-selected",
  spider: "cvo-date-pins-spider-point",
};

/** The cluster sources and layers, added once per map instance. */
function ensurePinLayers(map) {
  if (map.getSource(PIN_SOURCE)) return;

  map.addSource(PIN_SOURCE, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterRadius: 44,
    clusterMaxZoom: 15,
  });
  map.addSource(SPIDER_SOURCE, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: PIN_LAYERS.clusters,
    type: "circle",
    source: PIN_SOURCE,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#3f6b22",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-opacity": 0.9,
      "circle-radius": ["step", ["get", "point_count"], 13, 5, 17, 15, 22],
    },
  });
  map.addLayer({
    id: PIN_LAYERS.clusterCount,
    type: "symbol",
    source: PIN_SOURCE,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-size": 11,
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#ffffff" },
  });
  map.addLayer({
    id: PIN_LAYERS.points,
    type: "circle",
    source: PIN_SOURCE,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-radius": 7,
      // Approximate pins (barangay-centroid fallbacks) are HOLLOW — a shape
      // cue that survives colour blindness and the printout alike.
      "circle-color": ["case", ["get", "approximate"], "#ffffff", ["get", "color"]],
      "circle-opacity": 0.95,
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": ["case", ["get", "approximate"], 2.5, 2],
    },
  });
  map.addLayer({
    id: PIN_LAYERS.selected,
    type: "circle",
    source: PIN_SOURCE,
    filter: ["==", ["get", "animal_id"], -1],
    paint: {
      "circle-radius": 11,
      "circle-color": "transparent",
      "circle-stroke-color": "#2d4d19",
      "circle-stroke-width": 3,
    },
  });
  map.addLayer({
    id: PIN_LAYERS.spider,
    type: "circle",
    source: SPIDER_SOURCE,
    paint: {
      "circle-radius": 7,
      "circle-color": ["get", "color"],
      "circle-opacity": 0.95,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
}

/** Popup for one animal pin — the same card language as the household pins. */
function pinPopupHtml(pin, { flightActive = false, showFlightPath = false, offerRedisperse = false } = {}) {
  const badge = pin.approximate
    ? '<p style="margin:4px 0 0;padding:1px 8px;display:inline-block;border-radius:9999px;background:#fef9c3;color:#854d0e;font-size:10px;font-weight:600;text-transform:uppercase">Approximate location</p>'
    : "";
  const redisperse = offerRedisperse && pin.owner?.id !== null && !pin.owner?.masked
    ? '<button type="button" class="cvo-redisperse"' +
      ` data-redisperse-id="${escapeHtml(String(pin.animal_id))}"` +
      ' style="margin-top:8px;margin-left:6px;display:inline-flex;align-items:center;gap:5px;border-radius:9999px;border:1px solid #c8e6c9;background:#f3f9ee;padding:3px 10px;font-size:11px;font-weight:600;color:#3f6b22;cursor:pointer">' +
      "Re-disperse</button>"
    : "";
  const toggle = showFlightPath
    ? '<button type="button" class="cvo-path-toggle"' +
      ` data-path-id="${escapeHtml(String(pin.animal_id))}"` +
      ' style="margin-top:8px;display:inline-flex;align-items:center;gap:5px;border-radius:9999px;border:1px solid #c8e6c9;background:#f3f9ee;padding:3px 10px;font-size:11px;font-weight:600;color:#3f6b22;cursor:pointer">' +
      `<svg viewBox="0 0 20 20" width="11" height="11" aria-hidden="true" style="flex:none"><path d="M5 2v16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/><path d="M6 3h8l-2.6 3L14 9H6z" fill="currentColor"/></svg>` +
      (flightActive ? "Hide flight path" : "Show flight path") +
      "</button>"
    : "";
  const earTag = pin.ear_tag_number
    ? `<p style="margin:0;font-size:12px;color:#64748b">Ear tag: ${escapeHtml(pin.ear_tag_number)}</p>`
    : "";

  return (
    `<div style="min-width:12rem;font-size:13px;line-height:1.4">` +
    `<p style="margin:0;font-weight:600;color:#0f172a">${escapeHtml(pin.owner?.label ?? "Unknown owner")}</p>` +
    `<p style="margin:0;font-size:12px;color:#64748b">${escapeHtml(pin.barangay ?? "No barangay on record")} &middot; ${escapeHtml(pin.animal_type ?? "Unspecified animal")}</p>` +
    earTag +
    badge +
    toggle +
    redisperse +
    `</div>`
  );
}

/**
 * @param {object} props
 * @param {Array<object>} [props.beneficiaries] geo-tagged household rows (the
 *   legacy view) — ignored when `pins` is provided
 * @param {Array<object>} [props.pins] ANIMAL-keyed date-view pins (animal_id,
 *   owner, barangay, latitude, longitude, approximate, animal_type, ear tag);
 *   rendered on a clustered source instead of household markers
 * @param {Function} [props.renderChoropleth] (onMapReady) => ReactNode — the
 *   shared BarangayChoropleth rendered INSIDE this component's shell; this
 *   component adopts its map (controls, camera and removal stay with the
 *   choropleth) instead of creating its own
 * @param {Function} [props.trailFetcher] (row) => trail payload; defaults to
 *   the household trail — the date view passes the ANIMAL trail fetcher
 * @param {number|null} [props.selectedAnimalId] ring this animal's pin (the
 *   side list's hover/selection)
 * @param {Function} [props.onRowHover] (animalId|null) => void — the built-in
 *   table's rows highlight their pins
 * @param {boolean} [props.showTable] render the built-in accessible table
 *   (the date view renders its own side list instead)
 * @param {string} [props.pinMode] what a clustered pin STANDS FOR: "animal"
 *   (the date view's animal-keyed pins) or "beneficiary" (the Overview's
 *   household locations). Both draw the same clustered layer; only the
 *   wording (table headings, ear-tag column) follows it.
 * @param {boolean} [props.loading]
 * @param {string|null} [props.error]
 * @param {Function} [props.onPick] — picker mode: reports [lat, lng] on map click
 * @param {[number, number]} [props.center] — initial map center as [lat, lng]
 * @param {Array<number>|null} [props.selected] — [lat, lng] marker in picker mode
 */
export function DispersalMap({
  beneficiaries = [],
  pins = null,
  pinMode = "animal",
  renderChoropleth = null,
  trailFetcher = null,
  selectedAnimalId = null,
  onRowHover = null,
  showTable = true,
  loading = false,
  error = null,
  onPick,
  center,
  selected = null,
  onRedisperse,
  refreshTrail = null,
}) {
  const toast = useOptionalToast();
  const containerRef = useRef(null);
  const shellRef = useRef(null); // the box that flips to fullscreen (container + overlay)
  const mapRef = useRef(null);
  const markersRef = useRef([]); // { marker, beneficiary }
  const selectedMarkerRef = useRef(null);
  // Latest "Re-disperse" handler, read by the delegated popup click below.
  const onRedisperseRef = useRef(onRedisperse);
  const onPickRef = useRef(onPick);
  // True while fullscreen is emulated with fixed positioning because the
  // Fullscreen API is missing (iPhone Safari) or refused the request.
  const cssFallbackRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [animalFilter, setAnimalFilter] = useState("all");

  // The single trail revealed from a pin's popup. Deliberately singular: a
  // pin's popup asks for its own trail, and the two views never share the
  // map — showing one hides the other.
  const [flightPath, setFlightPath] = useState({
    id: null,
    name: null,
    beneficiary: null,
    points: null,
    unlocated: [],
    loading: false,
    error: null,
    empty: false,
  });

  // The overview: every visible household's trail at once, fetched on demand.
  // Kept separate from `flightPath` so the pin-popup labels and chips keep
  // their single-trail wording.
  const [allPaths, setAllPaths] = useState(NO_ALL_PATHS);

  const flightRef = useRef(flightPath); // latest state, read by bound handlers
  const pathCacheRef = useRef(new Map()); // id -> points ([] = no movement)
  const allPathsTokenRef = useRef(0); // cancels in-flight overview fetches
  const pathMarkersRef = useRef([]); // the origin/end markers of a revealed trail
  const hoverPopupRef = useRef(null); // segment tooltip, reused while hovering
  const toggleRef = useRef(null); // latest reveal/hide, read by popup clicks
  const previousPathIdRef = useRef(null); // pin popup that needs relabelling
  const refreshTokenRef = useRef(0); // last `refreshTrail` token acted on
  const spiderfiedRef = useRef(null); // the cluster currently spiderfied, if any
  const pinKeyRef = useRef(null); // the animal set the spiderfy was built from
  const selectedAnimalIdRef = useRef(selectedAnimalId); // row-hover ring, read by the data effect
  const onRowHoverRef = useRef(onRowHover); // side-list hover → pin ring

  useEffect(() => {
    selectedAnimalIdRef.current = selectedAnimalId;
  }, [selectedAnimalId]);

  useEffect(() => {
    onRowHoverRef.current = onRowHover;
  }, [onRowHover]);

  // Keep the latest callback without re-creating the map on every render.
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    flightRef.current = flightPath;
  }, [flightPath]);

  const centerTo = center ?? selected ?? DEFAULT_CENTER;

  // The date view: ANIMAL-keyed pins normalised into the row shape every
  // downstream effect already speaks (id, name_of_farmer, address, …). Keyed
  // by animal_id, so a date change updates pins in place instead of
  // remounting them, and an animal can never appear twice.
  const pinRows = useMemo(
    () =>
      (pins ?? []).map((pin) => ({
        ...pin,
        id: pin.animal_id,
        name_of_farmer: pin.owner?.label ?? "Unknown owner",
        address: pin.barangay ?? "",
        is_re_dispersal: false,
      })),
    [pins],
  );
  // Cluster pins either stand for ANIMALS (the date view) or for the
  // HOUSEHOLDS that hold them (the Overview's location map). The pin layer is
  // the same; only the wording follows `pinMode`.
  const hasPins = pins !== null;
  const isDateView = hasPins && pinMode === "animal";

  const animalTypes = useMemo(
    () =>
      [...new Set((hasPins ? pinRows : beneficiaries).map((b) => b.animal_type).filter(Boolean))].sort(),
    [hasPins, pinRows, beneficiaries],
  );

  // Only rows carrying sane coordinates can be pinned. Without this guard a
  // coordinate-less row (e.g. an import whose address named no covered
  // barangay) would render at 0,0 in the ocean. The date view additionally
  // rejects out-of-range pairs (the Negros Oriental sanity window in
  // validCoordinates) so a botched import can never draw a pin abroad.
  const pinnable = useMemo(
    () =>
      hasPins
        ? pinRows.filter((row) => validCoordinates(Number(row.latitude), Number(row.longitude)))
        : beneficiaries.filter(
            (b) =>
              Number.isFinite(Number(b.latitude)) &&
              Number.isFinite(Number(b.longitude)) &&
              b.latitude !== null &&
              b.longitude !== null &&
              !(Number(b.latitude) === 0 && Number(b.longitude) === 0),
          ),
    [hasPins, pinRows, beneficiaries],
  );

  const visible = useMemo(
    () =>
      animalFilter === "all"
        ? (isDateView ? pinRows : pinnable)
        : (isDateView ? pinRows : pinnable).filter((b) => b.animal_type === animalFilter),
    [isDateView, pinRows, pinnable, animalFilter],
  );

  // Rows that cannot be placed — no coordinates, or a malformed pair.
  // Surfaced explicitly so the pin count never silently disagrees with the
  // side list, and so "Location not recorded" has its section.
  const unpinned = (hasPins ? pinRows : beneficiaries).length - pinnable.length;

  // The shared choropleth's map, adopted when renderChoropleth is used (the
  // date view): the owner keeps its lifecycle (controls, camera, removal);
  // this component only draws on it.
  const [sharedMapState, setSharedMapState] = useState({ map: null, ready: false });
  const handleChoroplethMapReady = useCallback((map) => {
    // The choropleth calls this inside its own load event, so the map is
    // ready the moment we get it.
    setSharedMapState({ map, ready: true });
  }, []);
  const sharedMap = renderChoropleth ? sharedMapState.map : null;
  const sharedReady = sharedMapState.ready;
  // The render function is a fresh closure on every parent render; the map
  // adoption must NOT churn with it (every re-render would tear the layers
  // and handlers down), so the effect reads it through a ref.
  const renderChoroplethRef = useRef(renderChoropleth);
  useEffect(() => {
    renderChoroplethRef.current = renderChoropleth;
  }, [renderChoropleth]);

  // Create the map once — or ADOPT the shared choropleth's map when one is
  // provided (the date view). Picker mode always creates its own map,
  // exactly as before.
  useEffect(() => {
    if (sharedMap && !onPick) {
      if (!sharedReady || mapRef.current === sharedMap) return undefined;

      mapRef.current = sharedMap;
      markersRef.current = [];
      selectedMarkerRef.current = null;
      setMapReady(true);

      return () => {
        // The shared map is removed by its owner (BarangayChoropleth); stop
        // our own in-flight work from touching a dying map and clear refs.
        allPathsTokenRef.current += 1;
        mapRef.current = null;
        markersRef.current = [];
        selectedMarkerRef.current = null;
        setMapReady(false);
      };
    }

    if (renderChoroplethRef.current && !onPick) return undefined;

    if (!containerRef.current || mapRef.current) return undefined;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [centerTo[1], centerTo[0]],
      zoom: 12,
      attributionControl: false,
    });
    mapRef.current = map;
    // Debug/support handle: lets a support session (or the browser check)
    // inspect what the WebGL canvas is actually drawing. No user data lives
    // here — the map object is already reachable from the console via the
    // container's __cvoMap, exactly like any devtools inspection.
    containerRef.current.__cvoMap = map;

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
      // Stop an overview fetch still in flight from updating a dead map.
      allPathsTokenRef.current += 1;
      mapRef.current = null;
      if (containerRef.current) delete containerRef.current.__cvoMap;
      markersRef.current = [];
      selectedMarkerRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- center/selected only recenter via the effect below; the map is created once
  }, [sharedMap, sharedReady, onPick]);

  async function toggleFullscreen() {
    const shell = shellRef.current;
    if (!shell) return;

    // Already fullscreen — leave the native session first, then the emulated one.
    if (fullscreenElement()) {
      (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document);
      return;
    }
    if (cssFallbackRef.current) {
      cssFallbackRef.current = false;
      setIsFullscreen(false);
      return;
    }

    const request = shell.requestFullscreen ?? shell.webkitRequestFullscreen;
    const allowed =
      document.fullscreenEnabled ?? document.webkitFullscreenEnabled ?? true;
    if (request && allowed) {
      try {
        await request.call(shell);
        return;
      } catch {
        // Refused (e.g. an iframe without allow="fullscreen") — emulate below.
      }
    }

    cssFallbackRef.current = true;
    setIsFullscreen(true);
  }

  // Stay in sync with browser-initiated fullscreen changes (Esc, F11-style
  // exits) so the button icon and the shell sizing follow reality.
  useEffect(() => {
    function sync() {
      if (fullscreenElement() === shellRef.current) {
        cssFallbackRef.current = false;
        setIsFullscreen(true);
      } else if (!cssFallbackRef.current) {
        setIsFullscreen(false);
      }
    }
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  // The emulated fullscreen has no browser chrome to leave, so Esc closes it.
  useEffect(() => {
    if (!isFullscreen || fullscreenElement()) return undefined;
    function onKey(event) {
      if (event.key === "Escape") {
        cssFallbackRef.current = false;
        setIsFullscreen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  // MapLibre watches its container with a ResizeObserver, but redraw
  // explicitly around the fullscreen switch anyway so the canvas never keeps
  // the 26rem-sized backing buffer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return undefined;
    const frame = requestAnimationFrame(() => map.resize());
    const timer = setTimeout(() => map.resize(), 200);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [mapReady, isFullscreen]);

  /**
   * Reveal one household's trail, fetched on demand (and cached by the
   * browser like every other GET).
   */
  async function showFlightPath(beneficiary) {
    resetAllPaths(); // the two trail views share one map

    const id = Number(beneficiary.id);
    const base = {
      id,
      name: beneficiary.name_of_farmer,
      beneficiary,
      points: null,
      unlocated: [],
      loading: true,
      error: null,
      empty: false,
    };
    setFlightPath(base);

    try {
      // The date view trails the ANIMAL (its own flight path); the legacy
      // household view trails the beneficiary chain. Same point shape both
      // ways, so the drawing pipeline is untouched.
      const payload = await (trailFetcher ?? fetchOwnershipTrail)(id);
      // The user may have hidden the trail (or opened another) while this was
      // in flight: applying the result then would pop the chip back up after
      // it was dismissed.
      if (flightRef.current.id !== id) return;

      // Drop (and report) anything that is not a real coordinate: MapLibre
      // would otherwise draw the point at [0, 0].
      const points = sanitizePoints(Array.isArray(payload?.points) ? payload.points : []);
      const unlocated = Array.isArray(payload?.unlocated) ? payload.unlocated : [];

      // Fewer than two spots means there is no journey to draw yet. The panel
      // says WHICH reason applies (one stop only, or a stop with no geotag)
      // rather than leaving the user guessing why the line is missing.
      if (points.length < 2) {
        // Keep the (few) points: the panel needs their count to say WHY there
        // is no line (one stop vs none).
        setFlightPath({ ...base, loading: false, empty: true, points, unlocated });
        return;
      }

      setFlightPath({ ...base, loading: false, points, unlocated });
    } catch (err) {
      if (flightRef.current.id !== id) return;
      const message = getErrorMessage(err);
      setFlightPath({ ...base, loading: false, error: message });
      // A failed request must never look like "no path": say so, both on the
      // panel and in a toast, with the panel's Retry re-running this fetch.
      toast?.error("Couldn't load the flight path. Try again.");
    }
  }

  function hideFlightPath() {
    // The chip disappears with the id, so an empty or failed reveal is
    // dismissed by the same control that hides a drawn trail.
    setFlightPath({
      id: null,
      name: null,
      beneficiary: null,
      points: null,
      unlocated: [],
      loading: false,
      error: null,
      empty: false,
    });
  }

  /** Tear the overview down and cancel any fetches still assembling it. */
  function resetAllPaths() {
    allPathsTokenRef.current += 1;
    setAllPaths((prev) => (prev.active ? { ...NO_ALL_PATHS } : prev));
  }

  /**
   * Fetch every visible household's trail and draw them on one map.
   *
   * One request per beneficiary is the shape the API offers (there is no bulk
   * endpoint), so the workers below keep at most ALL_PATHS_CONCURRENCY in
   * flight. Results are cached for the life of the map: toggling the overview
   * off and on again does not refetch the same trails. Households with no
   * movement are cached too (as an empty list) and simply contribute nothing.
   */
  async function showAllFlightPaths() {
    if (visible.length === 0) return;

    hideFlightPath();

    const token = ++allPathsTokenRef.current;
    const rows = visible;
    const cache = pathCacheRef.current;
    const trails = [];
    let failed = 0;
    let loaded = 0;
    let next = 0;

    setAllPaths({
      active: true,
      loading: true,
      loaded: 0,
      total: rows.length,
      failed: 0,
      paths: [],
    });

    async function worker() {
      while (next < rows.length && token === allPathsTokenRef.current) {
        const row = rows[next++];
        const id = Number(row.id);
        let points = cache.get(id);

        if (points === undefined) {
          try {
            const payload = await (trailFetcher ?? fetchOwnershipTrail)(id);
            points = sanitizePoints(Array.isArray(payload?.points) ? payload.points : []);
            cache.set(id, points);
          } catch {
            points = null; // not cached, so a retry can try again
          }
        }

        if (token !== allPathsTokenRef.current) return;

        if (points === null) failed += 1;
        else if (points.length >= 2) trails.push({ beneficiary: row, points });

        loaded += 1;
        setAllPaths((prev) =>
          prev.active ? { ...prev, loaded, failed } : prev,
        );
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(ALL_PATHS_CONCURRENCY, rows.length) }, worker),
    );

    if (token !== allPathsTokenRef.current) return;

    setAllPaths({
      active: true,
      loading: false,
      loaded,
      total: rows.length,
      failed,
      paths: trails,
    });
  }

  // Latest handler, read by the delegated popup click — popups are created
  // once per marker, so a closure would pin a stale callback.
  useEffect(() => {
    onRedisperseRef.current = onRedisperse;
  }, [onRedisperse]);

  // A handover just saved: the trail on screen (and the overview cache) were
  // built before the new event existed, so they are stale by definition. The
  // page bumps `refreshTrail` after every save, naming the household that now
  // holds the animal; refetch THAT trail so the new stop appears immediately,
  // with no page refresh. Live polling of the household list is unchanged.
  useEffect(() => {
    const token = refreshTrail?.token ?? 0;
    if (token === refreshTokenRef.current) return;
    refreshTokenRef.current = token;

    // Every cached trail predates the handover. The overview is re-assembled
    // from scratch; a single revealed trail is refetched below.
    pathCacheRef.current.clear();

    if (allPaths.active) {
      showAllFlightPaths();
      return;
    }

    // Nothing was on screen, so there is nothing to refresh — and popping a
    // trail up unasked after a save would be a surprise.
    if (flightRef.current.id === null) return;

    // The date view trails ANIMALS: the revealed trail's own animal is the
    // one that must refetch (the save named no household in that world).
    const targetId = Number(refreshTrail?.beneficiaryId ?? 0);
    const target = targetId
      ? visible.find((row) => Number(row.id) === targetId)
      : (isDateView
        ? visible.find((row) => String(row.id) === String(flightRef.current.id))
        : undefined);

    // The animal left for a household the map cannot draw (filtered out, or
    // with no pin): the old line must go rather than keep pointing at a
    // household that no longer holds it.
    if (!target) {
      hideFlightPath();
      return;
    }

    showFlightPath(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the token is the trigger; re-running on `visible` would refetch on every poll
  }, [refreshTrail?.token]);

  // Latest toggle, read by the delegated popup click — popups are created
  // once per marker, so a closure would pin a stale state.
  useEffect(() => {
    toggleRef.current = (beneficiary) => {
      if (flightRef.current.id === Number(beneficiary.id)) hideFlightPath();
      else showFlightPath(beneficiary);
    };
  });

  // One delegated listener for every pin popup's "Show flight path" button:
  // markers are recycled as the visible set changes, so per-popup listeners
  // would leak on every reconcile.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || onPick) return undefined;

    function onClick(event) {
      const toggle = event.target?.closest?.(".cvo-path-toggle");

      if (toggle) {
        const id = toggle.getAttribute("data-path-id");
        const beneficiary = visible.find((row) => String(row.id) === String(id));
        if (beneficiary) toggleRef.current?.(beneficiary);
        return;
      }

      const redisperse = event.target?.closest?.(".cvo-redisperse");

      if (redisperse) {
        const id = redisperse.getAttribute("data-redisperse-id");
        const beneficiary = visible.find((row) => String(row.id) === String(id));
        if (beneficiary) onRedisperseRef.current?.(beneficiary);
      }
    }

    shell.addEventListener("click", onClick);
    return () => shell.removeEventListener("click", onClick);
  }, [onPick, visible]);

  // Pin popups carry a show/hide label that must follow the active trail —
  // refresh their contents instead of recreating every marker (that would
  // slam each open popup shut).
  useEffect(() => {
    const previousId = previousPathIdRef.current;
    previousPathIdRef.current = flightPath.id;

    for (const entry of markersRef.current) {
      const isActive = String(entry.key) === String(flightPath.id);
      const wasActive = String(entry.key) === String(previousId);
      if (!isActive && !wasActive) continue;

      // `setHTML` rather than a DOM swap: it is MapLibre's own content API,
      // and re-setting it re-renders the popup even while it is open.
      entry.marker
        .getPopup()
        ?.setHTML(
          popupHtml(entry.beneficiary, {
            showFlightPath: !onPick,
            offerRedisperse: !onPick && Boolean(onRedisperseRef.current),
            flightActive: isActive,
          }),
        );
    }
  }, [flightPath.id, onPick]);

  // A household the user filters away must not leave its trail behind — the
  // line would point at a pin that is no longer drawn.
  useEffect(() => {
    if (flightPath.id === null) return;
    if (visible.some((row) => Number(row.id) === flightPath.id)) return;
    hideFlightPath();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hideFlightPath is stable in behaviour; re-running on its identity would churn
  }, [visible, flightPath.id]);

  // Bind the trail's click/hover behaviour once the map exists. Handlers are
  // layer-keyed, so they survive every reveal/hide — only the source data
  // changes between trails. They are UNBOUND on cleanup and rebound on the
  // next mount: React's StrictMode (dev) mounts, discards and mounts again,
  // and a one-shot guard would have left the surviving map with no handlers
  // at all — no point popups, no segment tooltip.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || onPick) return undefined;

    ensurePathLayers(map);
    ensurePathArrowIcon(map);

    const onPointClick = (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      new Popup({ offset: 12, closeButton: false })
        .setLngLat(feature.geometry.coordinates)
        .setHTML(pathPointHtml(feature.properties))
        .addTo(map);
    };

    // Hovering a SEGMENT names the dates it spans — a whole trail can only
    // tell you "when", a span tells you "between when".
    const onSegmentMove = (event) => {
      const feature = event.features?.[0];
      if (!feature) return;

      const { from_date: from, to_date: to } = feature.properties;
      hoverPopupRef.current ??= new Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 12,
      });
      hoverPopupRef.current
        .setLngLat(event.lngLat)
        .setHTML(
          `<p style="margin:0;font-size:12px;font-weight:600;color:#0f172a;` +
            `background:#fff;padding:2px 8px;border-radius:9999px;` +
            `box-shadow:0 1px 4px rgb(15 23 42 / 0.25)">${escapeHtml(dateRangeLabel(from, to))}</p>`,
        )
        .addTo(map);
      map.getCanvas().style.cursor = "pointer";
    };

    const onSegmentLeave = () => {
      hoverPopupRef.current?.remove();
      map.getCanvas().style.cursor = "";
    };

    const onPointEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onPointLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", PATH_LAYERS.points, onPointClick);
    map.on("mousemove", PATH_LAYERS.line, onSegmentMove);
    map.on("mousemove", PATH_LAYERS.approximate, onSegmentMove);
    map.on("mouseleave", PATH_LAYERS.line, onSegmentLeave);
    map.on("mouseleave", PATH_LAYERS.approximate, onSegmentLeave);
    map.on("mouseenter", PATH_LAYERS.points, onPointEnter);
    map.on("mouseleave", PATH_LAYERS.points, onPointLeave);

    return () => {
      try {
        map.off("click", PATH_LAYERS.points, onPointClick);
        map.off("mousemove", PATH_LAYERS.line, onSegmentMove);
        map.off("mousemove", PATH_LAYERS.approximate, onSegmentMove);
        map.off("mouseleave", PATH_LAYERS.line, onSegmentLeave);
        map.off("mouseleave", PATH_LAYERS.approximate, onSegmentLeave);
        map.off("mouseenter", PATH_LAYERS.points, onPointEnter);
        map.off("mouseleave", PATH_LAYERS.points, onPointLeave);
      } catch {
        // The map instance was already removed (its own cleanup ran first).
      }
      hoverPopupRef.current?.remove();
    };
  }, [mapReady, onPick]);

  // Draw (or clear) the revealed trail(s). Segments are painted as separate
  // features so hover can name a span, and the gradient rides on each
  // segment's `age` property rather than a whole-line gradient.
  const pathPoints = flightPath.points;
  const pathKey = flightPath.id;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || onPick) return undefined;

    const segmentsSource = map.getSource(PATH_SOURCES.segments);
    if (!segmentsSource) return undefined;

    // Endpoint markers and the previous trail go first — a stale flag on a
    // hidden trail is worse than no trail.
    for (const marker of pathMarkersRef.current) marker.remove();
    pathMarkersRef.current = [];
    hoverPopupRef.current?.remove();

    const empty = { type: "FeatureCollection", features: [] };
    segmentsSource.setData(empty);
    map.getSource(PATH_SOURCES.arrows)?.setData(empty);
    map.getSource(PATH_SOURCES.points)?.setData(empty);
    // Observable without reaching into the map instance: how many points the
    // revealed trail(s) were built from (also handy when supporting a report).
    // The date view renders no container of its own — the attribute rides on
    // whichever container actually hosts the map.
    const host = containerRef.current ?? map.getContainer();
    host?.removeAttribute("data-flight-path-points");

    // One group per trail: the overview draws every household's trail, a pin
    // popup draws exactly one.
    const groups = allPaths.active
      ? allPaths.paths
      : pathPoints && pathPoints.length >= 2
        ? [{ beneficiary: flightPath.beneficiary, points: pathPoints }]
        : [];

    if (groups.length === 0) return undefined;

    // Endpoints are anchored to the pin the map actually DRAWS (households
    // sharing a barangay centre are spread over a ring), so the trail meets
    // the dot the user clicked instead of stopping short of it. Visit fixes
    // stay on their real coordinates — they are GPS readings, not pins.
    const drawn = spreadPositions(visible);
    const align = (points) =>
      points.map((point) => {
        const pin = point.anchor_id != null ? drawn.get(String(point.anchor_id)) : null;
        return pin ? { ...point, longitude: pin[0], latitude: pin[1] } : point;
      });

    const positionedGroups = groups.map((group) => align(group.points));
    const segments = {
      type: "FeatureCollection",
      features: positionedGroups.flatMap((points) => buildSegments(points).features),
    };
    const arrows = {
      type: "FeatureCollection",
      features: positionedGroups
        .flatMap((points) => buildArrows(points).features)
        // Several trails at once would otherwise multiply MAX_ARROWS by the
        // number of households and flood the map with arrowheads.
        .slice(0, allPaths.active ? ALL_PATHS_ARROW_LIMIT : undefined),
    };
    const markers = {
      type: "FeatureCollection",
      features: positionedGroups.flatMap((points) => buildPointMarkers(points).features),
    };
    (containerRef.current ?? map.getContainer())?.setAttribute(
      "data-flight-path-points",
      String(positionedGroups.reduce((count, points) => count + points.length, 0)),
    );

    // Origin flags and end dots belong to a single revealed trail; the
    // overview would otherwise add two DOM markers per household on top of
    // the pins already crowding the map. Its arrows carry the direction.
    if (!allPaths.active) {
      const positioned = positionedGroups[0];
      const origin = positioned[0];
      const end = positioned[positioned.length - 1];

      const originEl = document.createElement("div");
      originEl.className = "cvo-flight-origin";
      originEl.setAttribute("aria-hidden", "true");
      originEl.innerHTML = ORIGIN_FLAG_SVG;
      const originMarker = new Marker({ element: originEl, anchor: "bottom" })
        .setLngLat(toLngLat(origin))
        .setPopup(
          new Popup({ offset: 12 }).setHTML(
            pathPointHtml({
              title: origin.title,
              subtitle: origin.subtitle,
              label: formatPointDate(origin.occurred_on),
            }),
          ),
        )
        .addTo(map);

      const endEl = document.createElement("div");
      endEl.className = "cvo-flight-end";
      endEl.setAttribute("aria-hidden", "true");
      const endMarker = new Marker({ element: endEl })
        .setLngLat(toLngLat(end))
        .setPopup(
          new Popup({ offset: 12 }).setHTML(
            pathPointHtml({
              title: end.title,
              subtitle: end.subtitle,
              label: formatPointDate(end.occurred_on),
            }),
          ),
        )
        .addTo(map);

      pathMarkersRef.current = [originMarker, endMarker];

      // A handover at the SAME spot produces a zero-length segment, which draws
      // nothing. A badge keeps that real event visible instead of silently
      // shortening the trail.
      for (const { point } of sameLocationPoints(positioned)) {
        const badgeEl = document.createElement("div");
        badgeEl.className = "cvo-flight-same-location";
        badgeEl.setAttribute("aria-hidden", "true");
        badgeEl.textContent = "same location";

        pathMarkersRef.current.push(
          new Marker({ element: badgeEl, offset: [0, 14] })
            .setLngLat(toLngLat(point))
            .setPopup(
              new Popup({ offset: 12 }).setHTML(
                pathPointHtml({
                  title: point.title,
                  subtitle: point.subtitle,
                  label: formatPointDate(point.occurred_on),
                }),
              ),
            )
            .addTo(map),
        );
      }
    }

    // The overview appears in one frame: animating hundreds of trails at once
    // would stall the map for no extra clarity.
    if (allPaths.active) {
      segmentsSource.setData(segments);
      map.getSource(PATH_SOURCES.arrows)?.setData(arrows);
      map.getSource(PATH_SOURCES.points)?.setData(markers);
      return undefined;
    }

    const total = segments.features.length;
    const paint = (progress) => {
      const shown = Math.max(1, Math.ceil(progress * total));
      segmentsSource.setData({
        type: "FeatureCollection",
        features: segments.features.slice(0, shown),
      });
      map.getSource(PATH_SOURCES.arrows)?.setData({
        type: "FeatureCollection",
        features: arrows.features.filter((feature) => feature.properties.index < shown),
      });
      map.getSource(PATH_SOURCES.points)?.setData({
        type: "FeatureCollection",
        features: markers.features.filter((feature) => feature.properties.index < shown),
      });
    };

    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion || total <= 2) {
      paint(1);
      return undefined;
    }

    // A single draw-in, origin → current: it makes the direction unmistakable
    // the first time a trail appears, and then stops for good.
    const DURATION_MS = 700;
    const startedAt = performance.now();
    let frame;
    const step = (now) => {
      const t = Math.min(1, (now - startedAt) / DURATION_MS);
      paint(t);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `visible` only feeds the pin-alignment lookup; re-running on it would re-animate during unrelated refetches
  }, [mapReady, onPick, pathPoints, pathKey, allPaths.active, allPaths.paths]);

  // A pin's popup offers its own trail; the label follows whichever trail is
  // currently on the map. Identity is stable (it reads both refs), so marker
  // reconciles never churn on every render.
  const popupFor = useCallback(
    (beneficiary) =>
      popupHtml(beneficiary, {
        showFlightPath: !onPickRef.current,
        offerRedisperse: !onPickRef.current && Boolean(onRedisperseRef.current),
        flightActive: String(flightRef.current.id) === String(beneficiary.id),
      }),
    [],
  );

  // Reconcile markers with the visible rows — add, move, remove. The date
  // view draws on the CLUSTERED source instead (below), so DOM markers are
  // legacy-view only.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || onPick || hasPins) return;

    // Households sharing a barangay centre would otherwise stack into one dot;
    // see spreadPositions for why the ring is presentational only.
    const positions = spreadPositions(visible);
    const byId = new Map(visible.map((beneficiary) => [String(beneficiary.id), beneficiary]));
    const seen = new Set();

    for (const entry of markersRef.current) {
      const beneficiary = byId.get(entry.key);
      if (!beneficiary) continue;

      seen.add(entry.key);
      const position = positions.get(entry.key);
      const color = colorFor(beneficiary);

      if (entry.color !== color || entry.position !== `${position[0]},${position[1]}`) {
        entry.marker.remove();
        entry.marker = makeMarker(map, position, color, popupFor(beneficiary));
        entry.color = color;
        entry.position = `${position[0]},${position[1]}`;
      }
      entry.beneficiary = beneficiary;
    }

    for (const [key, beneficiary] of byId) {
      if (seen.has(key)) continue;
      const position = positions.get(key);
      const color = colorFor(beneficiary);
      markersRef.current.push({
        key,
        marker: makeMarker(map, position, color, popupFor(beneficiary)),
        beneficiary,
        color,
        position: `${position[0]},${position[1]}`,
      });
    }

    markersRef.current = markersRef.current.filter((entry) => {
      if (byId.has(entry.key)) return true;
      entry.marker.remove();
      return false;
    });
  }, [mapReady, visible, onPick, popupFor, hasPins]);

  // The date view's clustered pins: features keyed by animal_id so MapLibre
  // diffs the source in place — a date change moves/adds/removes only what
  // changed, with no blank flash and no remount. A pin can never appear
  // twice (one feature per animal; the server guarantees one row per animal).
  const drawnPins = useMemo(() => pinFeatures(pins ?? []), [pins]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || onPick || !hasPins) return;

    ensurePinLayers(map);

    // Spiderfy state dies when the ANIMAL SET changes (a date or filter
    // switch collapses any open cluster back to the source of truth) — but
    // a quiet refresh of the SAME date keeps it: the ring still points at
    // the same animals, and a poll must not snap it shut mid-reading.
    const pinKey = (pins ?? []).map((pin) => pin.animal_id).sort().join(",");
    if (pinKeyRef.current !== null && pinKeyRef.current !== pinKey) {
      spiderfiedRef.current = null;
      map.getSource(SPIDER_SOURCE)?.setData({ type: "FeatureCollection", features: [] });
    }
    pinKeyRef.current = pinKey;

    map.getSource(PIN_SOURCE)?.setData({
      type: "FeatureCollection",
      features: drawnPins.features,
    });

    const selected = selectedAnimalIdRef.current;
    map.setFilter(PIN_LAYERS.selected, ["==", ["get", "animal_id"], selected ?? -1]);
  }, [mapReady, onPick, hasPins, drawnPins, pins]);

  // Keep the selection ring in sync without rebuilding the source.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || onPick || !hasPins) return;
    map.setFilter(PIN_LAYERS.selected, ["==", ["get", "animal_id"], selectedAnimalId ?? -1]);
  }, [mapReady, onPick, hasPins, selectedAnimalId]);

  // Cluster / pin interactions: a cluster expands (zooms in; at the zoom
  // ceiling it SPIDERFIES onto a ring so every animal stays clickable), a
  // pin opens its card, a click elsewhere clears both.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || onPick || !hasPins) return undefined;

    ensurePinLayers(map);
    let popupOpen = false;

    const popup = new Popup({ offset: 12 }).addTo(map);

    const openPinPopup = (feature, lngLat) => {
      const row = visible.find((candidate) => String(candidate.id) === String(feature.properties?.animal_id));
      if (!row) return;
      popup
        .setLngLat(lngLat)
        .setHTML(
          pinPopupHtml(row, {
            showFlightPath: true,
            offerRedisperse: Boolean(onRedisperseRef.current),
            flightActive: String(flightRef.current.id) === String(row.id),
          }),
        )
        .addTo(map);
      popupOpen = true;
    };

    const spiderfy = (leaves, center) => {
      const positions = spiderPositions(center, leaves.length);
      spiderfiedRef.current = { center };
      // Rebuild the features from their PLAIN parts only: query-rendered
      // leaves carry style-layer objects (with paint functions) that the
      // source's worker transfer cannot serialize.
      map.getSource(SPIDER_SOURCE)?.setData({
        type: "FeatureCollection",
        features: leaves.map((leaf, index) => ({
          type: "Feature",
          id: leaf.id,
          properties: { ...(leaf.properties ?? {}), spider: true },
          geometry: { type: "Point", coordinates: positions[index] },
        })),
      });
    };

    const onClusterClick = async (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const clusterId = feature.properties?.cluster_id;
      const source = map.getSource(PIN_SOURCE);
      if (!source) return;

      // MapLibre v6: BOTH cluster queries resolve PROMISES (the callback
      // shape is gone — passing one would try to serialize a function into
      // the worker and reject).
      const expansionZoom = Math.min(
        (await source.getClusterExpansionZoom(clusterId)) ?? map.getMaxZoom(),
        16,
      );
      const currentZoom = map.getZoom();

      try {
        const leaves = await source.getClusterLeaves(clusterId, 200);
        if (!leaves?.length) return;

        // How far apart the cluster's animals actually are decides the
        // expansion: pins sharing ONE spot (several animals at a household,
        // barangay-centroid fallbacks) can never separate by zooming, no
        // matter how deep the camera goes — they spiderfy right away.
        const lons = leaves.map((leaf) => leaf.geometry.coordinates[0]);
        const lats = leaves.map((leaf) => leaf.geometry.coordinates[1]);
        const spread = Math.max(
          Math.max(...lons) - Math.min(...lons),
          Math.max(...lats) - Math.min(...lats),
        );

        if (spread < 0.001 || expansionZoom <= currentZoom + 0.4) {
          spiderfy(leaves, feature.geometry.coordinates);
          return;
        }

        // There is room to resolve the cluster by zooming — the map reads
        // that as "these pins separate as you approach", which is what the
        // user expects from a map.
        map.easeTo({
          center: feature.geometry.coordinates,
          zoom: Math.min(expansionZoom, 16),
        });
      } catch {
        // The cluster (or its source) was torn down mid-click.
      }
    };

    const onSpiderClick = (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      openPinPopup({ properties: feature.properties }, event.lngLat);
    };

    const onPinClick = (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      openPinPopup(feature, event.lngLat);
    };

    const onMapClick = () => {
      if (!popupOpen && !spiderfiedRef.current) return;
      spiderfiedRef.current = null;
      map.getSource(SPIDER_SOURCE)?.setData({ type: "FeatureCollection", features: [] });
    };

    const onEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", PIN_LAYERS.clusters, onClusterClick);
    map.on("click", PIN_LAYERS.spider, onSpiderClick);
    map.on("click", PIN_LAYERS.points, onPinClick);
    map.on("click", onMapClick);
    map.on("mouseenter", PIN_LAYERS.clusters, onEnter);
    map.on("mouseleave", PIN_LAYERS.clusters, onLeave);
    map.on("mouseenter", PIN_LAYERS.points, onEnter);
    map.on("mouseleave", PIN_LAYERS.points, onLeave);
    map.on("mouseenter", PIN_LAYERS.spider, onEnter);
    map.on("mouseleave", PIN_LAYERS.spider, onLeave);

    return () => {
      try {
        map.off("click", PIN_LAYERS.clusters, onClusterClick);
        map.off("click", PIN_LAYERS.spider, onSpiderClick);
        map.off("click", PIN_LAYERS.points, onPinClick);
        map.off("click", onMapClick);
        map.off("mouseenter", PIN_LAYERS.clusters, onEnter);
        map.off("mouseleave", PIN_LAYERS.clusters, onLeave);
        map.off("mouseenter", PIN_LAYERS.points, onEnter);
        map.off("mouseleave", PIN_LAYERS.points, onLeave);
        map.off("mouseenter", PIN_LAYERS.spider, onEnter);
        map.off("mouseleave", PIN_LAYERS.spider, onLeave);
      } catch {
        // Map already removed — nothing left to unbind.
      }
      popup.remove();
    };
    // `visible` feeds the popup lookup; rebound with the flight state so the
    // show/hide label follows the active trail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, onPick, hasPins, visible]);

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

  // Open framed on the pins themselves. The fixed default view sits on the
  // city centre at zoom 12 while the covered barangays span roughly 35 km, so
  // most of them start off-screen — which reads as "most farmers have no pin"
  // even though they are all drawn. Re-fits when the visible set changes
  // (e.g. an animal-type filter); picker mode passes center/selected and is
  // left alone.
  const pinKey = visible.map((beneficiary) => beneficiary.id).join(",");
  useEffect(() => {
    const map = mapRef.current;
    // The shared choropleth owns the camera (it frames the whole city); a
    // pin-fit here would yank it right back.
    if (!map || !mapReady || onPick || center || selected || sharedMap || hasPins) return;

    const positions = [...spreadPositions(visible).values()];
    if (positions.length === 0) return;

    const lngs = positions.map(([lng]) => lng);
    const lats = positions.map(([, lat]) => lat);
    const southWest = [Math.min(...lngs), Math.min(...lats)];
    const northEast = [Math.max(...lngs), Math.max(...lats)];

    // A single distinct spot has no extent to fit — MapLibre would collapse
    // the zoom; step in deliberately instead.
    if (southWest[0] === northEast[0] && southWest[1] === northEast[1]) {
      map.jumpTo({ center: southWest, zoom: 13 });
      return;
    }

    map.fitBounds([southWest, northEast], { padding: 48, maxZoom: 13, duration: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pinKey stands in for `visible`'s identity so a refetch of the same rows never yanks the camera
  }, [mapReady, pinKey, onPick, center, selected]);

  if (error) {
    return <InlineAlert message={error} />;
  }

  // The date view never blank-plates: an empty day still shows the city and
  // its polygons — the page renders its own empty state beside the map.
  if (!isDateView && !loading && pinnable.length === 0 && !onPick) {
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
          <span className="inline-flex items-center gap-1.5" title="Shown when a pin asks for its animal's history">
            <span
              aria-hidden="true"
              className="h-1 w-7 rounded-full"
              style={{
                background: `linear-gradient(90deg, ${PATH_OLD_COLOR}, ${PATH_NEW_COLOR})`,
              }}
            />
            Flight path
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={allPaths.active ? resetAllPaths : showAllFlightPaths}
              aria-pressed={allPaths.active}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-300 transition hover:bg-slate-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
            >
              <Icon
                name={allPaths.active ? "eye-off" : "eye"}
                className="h-3.5 w-3.5"
              />
              {allPaths.active ? "Hide all flight paths" : "Show all flight paths"}
            </button>
            <label className="flex items-center gap-2">
              <span className="sr-only">Filter by animal type</span>
              <select
                className="field !w-auto !py-1.5 text-xs"
                value={animalFilter}
                onChange={(event) => {
                  setAnimalFilter(event.target.value);
                  // The overview was fetched for the old visible set; leaving
                  // its trails up would point at pins the filter just hid.
                  resetAllPaths();
                }}
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
        </div>
      )}

      {/* Which trail is up, and the one control that takes it down again. */}
      {!onPick && flightPath.id !== null && (
        <div className="space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span
              role="status"
              className={`cvo-flight-chip inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-medium ${
                flightPath.error
                  ? "bg-amber-50 text-amber-800"
                  : "bg-brand-100 text-brand-800"
              }`}
            >
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-700" />
              {flightPath.loading && `Loading flight path — ${flightPath.name}…`}
              {flightPath.error
                ? `Couldn't load the path — ${flightPath.name}`
                : flightPath.loading
                  ? null
                  : flightPath.empty
                    ? `No route to draw yet — ${flightPath.name}`
                    : `Flight path — ${flightPath.name}`}
            </span>
            {flightPath.error && flightPath.beneficiary && (
              <button
                type="button"
                className="rounded-full px-3 py-1.5 font-semibold text-brand-800 underline hover:bg-brand-100"
                onClick={() => showFlightPath(flightPath.beneficiary)}
              >
                Retry
              </button>
            )}
            <button
              type="button"
              className="rounded-full px-3 py-1.5 font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
              onClick={hideFlightPath}
            >
              Hide path
            </button>
          </div>

          {/* Why there is no line — in plain language, never just a blank map. */}
          {!flightPath.loading && noPathReason(flightPath) && (
            <p role="status" className="text-slate-600">
              {noPathReason(flightPath)}
            </p>
          )}

          {/* Stops the chain could not place are listed, never silently dropped.
              When NOTHING could be drawn the reason above already names the
              first missing owner, so the list would only repeat it. */}
          {!flightPath.loading && !flightPath.error && !flightPath.empty && flightPath.unlocated.length > 0 && (
            <ul className="space-y-1 text-slate-600">
              {flightPath.unlocated.map((node) => (
                <li key={`${node.index}-${node.label}`}>
                  {node.kind === "origin" || !node.label
                    ? "The animal's origin has no location yet."
                    : `Owner ${node.label} has no location yet. Add a geotag to draw this stop.`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* The all-trails overview: progress while it assembles, then what it
          found. Always dismissable, including mid-load. */}
      {!onPick && allPaths.active && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            role="status"
            className={`cvo-flight-chip inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-medium ${
              !allPaths.loading && allPaths.failed > 0 && allPaths.paths.length === 0
                ? "bg-amber-50 text-amber-800"
                : "bg-brand-100 text-brand-800"
            }`}
          >
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-700" />
            {allPaths.loading &&
              `Loading flight paths — ${allPaths.loaded}/${allPaths.total}…`}
            {!allPaths.loading &&
              (allPaths.paths.length === 0
                ? allPaths.failed > 0
                  ? `Flight paths unavailable — ${allPaths.failed} of ${allPaths.total} households`
                  : `No recorded movement yet — ${allPaths.total} household${allPaths.total === 1 ? "" : "s"}`
                : `${allPaths.paths.length} flight path${allPaths.paths.length === 1 ? "" : "s"} shown${allPaths.failed > 0 ? ` · ${allPaths.failed} unavailable` : ""}`)}
          </span>
          <button
            type="button"
            className="rounded-full px-3 py-1.5 font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
            onClick={resetAllPaths}
          >
            Hide paths
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        <div
          ref={shellRef}
          className={
            isFullscreen
              ? // Emulated fullscreen (no Fullscreen API). Native fullscreen
                // uses the same classes once the change event lands.
                //
                // `isolate` keeps every z-index inside this box (the
                // fullscreen button, the loading veil) from painting over
                // page chrome such as the sticky dashboard header when the
                // card scrolls beneath it.
                "cvo-map-shell fixed inset-0 z-[70] isolate bg-white"
              : renderChoropleth
                ? // The choropleth slot brings its own height (and legend).
                  "cvo-map-shell relative isolate w-full"
                : "cvo-map-shell relative isolate h-[26rem] w-full"
          }
        >
          <button
            type="button"
            onClick={toggleFullscreen}
            className={`absolute z-[600] grid h-9 w-9 place-items-center rounded-md bg-white text-slate-600 shadow-md ring-1 ring-slate-900/10 transition hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 ${
              // The shared choropleth puts the +/− controls top-left; the
              // fullscreen toggle takes the other corner so they never stack.
              renderChoropleth ? "right-3 top-3" : "left-3 top-3"
            }`}
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? "Exit map full screen" : "View map full screen"}
            title={isFullscreen ? "Exit full screen (Esc)" : "View map full screen"}
          >
            <Icon
              name={isFullscreen ? "compress" : "expand"}
              className="h-5 w-5"
            />
          </button>
          {loading && (
            <div className="absolute inset-0 z-[500] grid place-items-center bg-white/70">
              <span className="text-sm text-slate-500">Loading map…</span>
            </div>
          )}
          {renderChoropleth ? (
            renderChoroplethRef.current(handleChoroplethMapReady)
          ) : (
            <div
              ref={containerRef}
              aria-hidden="true"
              className="h-full w-full [&_.maplibregl-canvas:focus]:outline-none"
            />
          )}
        </div>
      </div>

      {/* Accessible alternative: same data, screen-reader friendly. The date
          view renders its own side list beside the map instead. */}
      {showTable && (
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            {isDateView
              ? `Animals on this view (${visible.length})`
              : `Geo-tagged beneficiaries (${visible.length})`}
          </h3>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Icon name="info" className="h-3.5 w-3.5" />
            Table view of the map above
          </span>
        </div>
        {unpinned > 0 && (
          <p className="border-b border-slate-100 bg-amber-50/60 px-4 py-2 text-xs text-amber-800">
            {isDateView
              ? `${unpinned} of ${pinRows.length} animals have no location recorded for this view, so they have no pin. They are listed here rather than invented on the map.`
              : `${unpinned} of ${hasPins ? pinRows.length : beneficiaries.length} households have no coordinates yet, so they have no pin. A covered barangay address places them on the map.`}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <colgroup>
              <col className="w-[40%]" />
              <col className="w-[30%]" />
              {isDateView && <col className="w-[12%]" />}
              <col />
            </colgroup>
            <caption className="sr-only">
              {isDateView
                ? "Animals on this view, sorted by owner name"
                : "Beneficiaries with coordinates, sorted by farmer name"}
            </caption>
            <thead>
              <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  {isDateView ? "Owner" : "Farmer"}
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Barangay</th>
                {isDateView && (
                  <th scope="col" className="px-4 py-2.5 font-semibold">Ear tag</th>
                )}
                <th scope="col" className="px-4 py-2.5 font-semibold">Animal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...visible]
                .sort((a, b) => a.name_of_farmer.localeCompare(b.name_of_farmer))
                .map((row) => (
                  <tr
                    key={row.id}
                    className={`transition hover:bg-brand-50/40 ${
                      selectedAnimalId !== null && String(row.id) === String(selectedAnimalId)
                        ? "bg-brand-50"
                        : ""
                    }`}
                    onMouseEnter={() => onRowHoverRef.current?.(row.id)}
                    onMouseLeave={() => onRowHoverRef.current?.(null)}
                  >
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap text-slate-900">
                      {row.name_of_farmer}
                      {row.approximate && (
                        <span className="ml-2 rounded-pill bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                          approximate
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{row.address}</td>
                    {isDateView && (
                      <td className="px-4 py-2.5 text-slate-600">{row.ear_tag_number ?? "—"}</td>
                    )}
                    <td className="px-4 py-2.5 text-slate-600">{row.animal_type}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}

/**
 * The trail's sources and layers, added once per map instance.
 *
 * Everything about the trail is data-driven (the `age` property each
 * segment carries), so styling never has to be rebuilt when a different
 * household is revealed — only the source data changes.
 */
function ensurePathLayers(map) {
  if (map.getLayer(PATH_LAYERS.line)) return;

  const empty = { type: "FeatureCollection", features: [] };
  map.addSource(PATH_SOURCES.segments, { type: "geojson", data: empty });
  map.addSource(PATH_SOURCES.arrows, { type: "geojson", data: empty });
  map.addSource(PATH_SOURCES.points, { type: "geojson", data: empty });

  // A white casing under the trail: it separates the route from the raster
  // basemap AND from the coloured pins it crosses, so the line never has to
  // compete for the same green.
  map.addLayer({
    id: PATH_LAYERS.casing,
    type: "line",
    source: PATH_SOURCES.segments,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-opacity": 0.85, "line-width": 6 },
  });

  // A stop placed only from its barangay centre is approximate, and its span
  // is drawn DASHED: the line is an estimate, not a recorded location. The
  // solid and dashed spans are the same source split by a filter, so both
  // follow the reveal animation without a second data set.
  map.addLayer({
    id: PATH_LAYERS.line,
    type: "line",
    source: PATH_SOURCES.segments,
    filter: ["!=", ["get", "approximate"], true],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-width": 3,
      // Faded at the origin, saturated at the most recent segment: direction
      // and recency read from colour alone, before an arrowhead is noticed.
      "line-color": [
        "interpolate",
        ["linear"],
        ["get", "age"],
        0,
        PATH_OLD_COLOR,
        1,
        PATH_NEW_COLOR,
      ],
      "line-opacity": ["interpolate", ["linear"], ["get", "age"], 0, 0.55, 1, 0.95],
    },
  });

  map.addLayer({
    id: PATH_LAYERS.approximate,
    type: "line",
    source: PATH_SOURCES.segments,
    filter: ["==", ["get", "approximate"], true],
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: {
      "line-width": 3,
      "line-dasharray": [2, 1.6],
      "line-color": [
        "interpolate",
        ["linear"],
        ["get", "age"],
        0,
        PATH_OLD_COLOR,
        1,
        PATH_NEW_COLOR,
      ],
      "line-opacity": ["interpolate", ["linear"], ["get", "age"], 0, 0.55, 1, 0.95],
    },
  });

  map.addLayer({
    id: PATH_LAYERS.arrows,
    type: "symbol",
    source: PATH_SOURCES.arrows,
    layout: {
      "icon-image": PATH_ARROW_IMAGE,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 15, 0.95],
      // The arrow glyph points north; rotating it by the segment's own
      // bearing is what makes it read as "this way, forward in time".
      "icon-rotate": ["get", "bearing"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
    },
    paint: { "icon-opacity": ["interpolate", ["linear"], ["get", "age"], 0, 0.6, 1, 1] },
  });

  map.addLayer({
    id: PATH_LAYERS.points,
    type: "circle",
    source: PATH_SOURCES.points,
    paint: {
      "circle-radius": 5,
      "circle-color": [
        "match",
        ["get", "kind"],
        "origin",
        PATH_NEW_COLOR,
        "current",
        PATH_NEW_COLOR,
        "#3f6b22",
      ],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-opacity": 0.95,
    },
  });
}

/** Decode the arrowhead SVG and register it — MapLibre needs a raster image. */
function ensurePathArrowIcon(map) {
  if (map.hasImage(PATH_ARROW_IMAGE)) return;

  const image = new Image();
  image.onload = () => {
    if (map.hasImage(PATH_ARROW_IMAGE)) return;
    try {
      // NO isStyleLoaded() gate here on purpose: in MapLibre that check stays
      // false for a while after `load` on a style still pulling raster tiles,
      // and gating on it silently skips registration — leaving the arrow
      // layer requesting an image that never arrives.
      map.addImage(PATH_ARROW_IMAGE, image, { pixelRatio: 2 });
    } catch {
      // Map already removed — nothing left to register the image on.
    }
  };
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PATH_ARROW_SVG)}`;
}

function makeMarker(map, position, color, html) {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");

  // Shape and the pulsing glow ring live in index.css (.cvo-map-pin); only
  // the animal-type colour is per-marker, and the ::after ring inherits it.
  el.className = "cvo-map-pin";
  el.style.background = color;

  const marker = new Marker({ element: el })
    .setLngLat(position)
    .setPopup(new Popup({ offset: 12 }).setHTML(html))
    .addTo(map);
  return marker;
}
