import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
// Named imports, exactly like DispersalMap — the maplibre-gl build this app
// ships does not expose a default export.
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { OSM_STYLE } from "../config/mapStyle";
import { Icon } from "./Icons";
import { BarangaySearch } from "./BarangaySearch";
import {
  barangayLabelPoint,
  barangayLabelSpanMeters,
  boundaryBounds,
  normalizeBarangayName,
} from "../lib/barangayBoundaries";
import {
  buildFlowFeatures,
  buildFlowLabelFeatures,
  FLOW_LABEL_SOURCE,
  FLOW_LAYER_IDS,
  FLOW_SOURCE,
} from "../lib/mapFlows";
import {
  CIRCLE_CLUSTER_LAYER,
  CIRCLE_CORE_LAYER,
  CIRCLE_LAYER_IDS,
  CIRCLE_MAIN_LAYER,
  CIRCLE_SOURCE,
  circleClusterLayerSpecs,
  circleLayerSpecs,
  circlePaintForMode,
  circleSourceOptions,
} from "../lib/mapCircles";

/**
 * A label shows only when its barangay spans at least this many on-screen
 * pixels at the current zoom — the poblacion cluster's small shapes otherwise
 * stack into an unreadable pile at the city-wide view. Zooming in reveals
 * them one by one, the way every proper map declutters.
 */
const LABEL_MIN_PIXELS = 18;

/** Fallback label box before the browser has measured a marker. */
const LABEL_FALLBACK_WIDTH = 70;
const LABEL_FALLBACK_HEIGHT = 22;
const LABEL_COLLISION_GAP = 3;

/**
 * Vertical shift for a name label when circle markers are on. The circle sits
 * AT the barangay's interior point; without the shift the bold name (with its
 * white halo) is painted straight over the marker and hides every small
 * circle. Moving the label down leaves the dot as the anchor — the marker +
 * name pattern the reference map uses.
 */
const LABEL_OFFSET_WITH_MARKERS = 14;

/** Metres per screen pixel at a given zoom, for a given latitude. */
function metresPerPixel(zoom, latitude) {
  return (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * The camera's panning box, sized for the map box's own aspect ratio.
 *
 * A tight box around the city cannot contain a short, wide viewport: fitting
 * the city's north–south extent needs a much wider longitude span than the
 * city itself, so MapLibre would honour maxBounds by zooming IN and cropping
 * the outer barangays (the exact opposite of a city-wide view). Expanding the
 * box to the viewport's aspect, plus a small margin, keeps the whole-city fit
 * possible while still confining the camera to Bayawan.
 *
 * boundaryBounds() returns [west, south, east, north]; MapLibre takes
 * [[west, south], [east, north]].
 */
function cameraBounds(bounds, container, margin = 1.08) {
  const [west, south, east, north] = bounds;
  const lngSpan = east - west;
  const latSpan = north - south;
  if (!(lngSpan > 0) || !(latSpan > 0)) return null;

  const aspect =
    container && container.clientHeight > 0
      ? container.clientWidth / container.clientHeight
      : lngSpan / latSpan;
  const boxLng = Math.max(lngSpan, latSpan * aspect) * margin;
  const boxLat = Math.max(latSpan, boxLng / aspect);
  const centerLng = (west + east) / 2;
  const centerLat = (south + north) / 2;

  return [
    [centerLng - boxLng / 2, centerLat - boxLat / 2],
    [centerLng + boxLng / 2, centerLat + boxLat / 2],
  ];
}

/**
 * The shared barangay map: one MapLibre map wearing the 28 Bayawan City
 * barangay polygons — green fills, white borders, a YELLOW hover
 * highlight, and the +/− controls at the top-left, in the style of the LGU's
 * own barangay-profile maps. The yellow hover is the same on every page that
 * wears this map. Pages pass `showLabels` to pin a permanent name
 * (and, with `labelShowCounts`, the barangay's dispersal count) inside each
 * polygon; pages that pass `tooltipHtml` also get their dark cursor-side
 * metric label back on hover.
 *
 * This is the ONE map every map feature renders through (the Dispersal Map,
 * the dashboards' overview, the barangay flow report, the landing hero, the
 * contact office map and both coordinate pickers), so camera rules, the
 * basemap, attribution, controls and the label typography can never drift
 * between pages.
 *
 * This component OWNS the map instance and the polygon layers; the pages
 * that use it add their own data on top
 * through `onMapReady(map)` and never re-create the map. Layer ORDER is
 * deliberate: the boundary fill and outline always sit UNDER the parent's
 * layers (they insert before `beforeLayerId` when it exists, and a later
 * parent addLayer lands on top otherwise), so the flow lines, pins and
 * flight trails are never covered by their own basemap shapes.
 *
 * The BOUNDARY DATA is fetched by the caller through `useBarangayBoundaries`
 * and joined to its rows (the caller owns the join, so each page answers
 * from its own data); this component only paints it. When the asset cannot
 * be fetched (offline demo, blocked static file) the status flips to
 * "unavailable" and the parent decides its own fallback — the map itself
 * stays up, never blank.
 */

const BOUNDARY_SOURCE = "cvo-barangay-boundaries";
const FILL_LAYER = "barangay-boundaries-fill";
const OUTLINE_CASING_LAYER = "barangay-boundaries-casing";
const OUTLINE_LAYER = "barangay-boundaries-outline";

/** The polygon fill layer — exported so a parent can tell a polygon click
 *  apart from a click on the background (the selection card closes on the
 *  latter). */
export const BARANGAY_FILL_LAYER = FILL_LAYER;

/**
 * @param {object} props
 * @param {{status: string, collection: object|null}} props.boundaries
 *   from useBarangayBoundaries(): "loading" | "ready" | "unavailable"
 * @param {{max: number, collection: object}|null} [props.choropleth]
 *   paint-ready features from buildChoropleth(); null while rows are loading
 * @param {(map: import("maplibre-gl").Map) => void} [props.onMapReady]
 *   called once when the map has loaded: the parent stores it and adds its
 *   layers. Called with the same instance for this container's whole life.
 * @param {(event: {lngLat: {lat: number, lng: number}}) => void} [props.onPick]
 *   picker mode: report map clicks instead of polygon selection
 * @param {string|null} [props.selectedName] the selected barangay (highlight)
 * @param {number|string|null} [props.selectedFeatureId] the clicked polygon's
 *   feature id — painted yellow through feature-state `selected`, above hover
 * @param {(name: string|null) => void} [props.onBarangayClick]
 *   polygon click; the parent owns selection state (click again = clear)
 * @param {() => void} [props.onReset] fired when the search focus is cleared
 *   (the toolbar's Reset view button was removed) — pages that mirror
 *   selection state in the URL clear it here, so a cleared search returns
 *   the whole feature (camera AND selection) to the city-wide view.
 * @param {string[]} [props.clickThroughLayers] parent layer ids that SWALLOW
 *   a click/hover — MapLibre layer events are not occlusion-aware, so
 *   without this gate a click on a pin or flow line would ALSO select the
 *   barangay polygon underneath it. When the topmost feature at the pointer
 *   belongs to one of these layers, the polygons ignore the event.
 * @param {(properties: object) => string} [props.tooltipHtml]
 *   the dark hover label's HTML, from the feature properties buildChoropleth
 *   attached (name, color, value, row)
 * @param {{stops: string[], minLabel: string, maxLabel: string}|null} [props.legend]
 * @param {import("react").ReactNode} [props.legendNotes] appended legend text
 * @param {boolean} [props.showCredit] the boundaries/OSM credit line
 * @param {string} [props.height] tailwind height class for the map box
 * @param {string} [props.ariaLabel]
 * @param {string|null} [props.beforeLayerId] first PARENT layer id — the
 *   boundary layers insert before it so parent data paints above the fills
 * @param {boolean} [props.fitToBoundaries] frame the city once polygons load
 * @param {boolean} [props.showLabels] pin each barangay's name to a point
 *   INSIDE its polygon (the pole of inaccessibility), so every boundary is
 *   named at a glance — no hover needed. Labels follow the map through zoom
 *   and resize because they are anchored to geography, not pixels.
 * @param {boolean} [props.labelShowCounts] under each name, the metric count
 *   from the joined row (`row.pins`). Pages without a joined row simply show
 *   names.
 * @param {string} [props.labelCountLabel] wording before that count (default
 *   "Total Dispersed"; Animal Health passes "Animals monitored").
 * @param {boolean} [props.cooperativeGestures] scroll-guard for maps embedded
 *   in a scrolling PAGE: a plain wheel scroll no longer zooms the map — it
 *   shows the "Use Ctrl + scroll to zoom the map" hint instead and lets the
 *   page keep scrolling; touch needs two fingers. Opt-in: the dashboard maps
 *   own their viewport, so they keep the direct scroll-zoom (default false =
 *   today's behaviour everywhere else).
 * @param {boolean} [props.zoomControls] show the +/- zoom buttons even on a
 *   pinned (non-interactive) display map; the buttons zoom programmatically
 *   without capturing page scroll or drag.
 * @param {boolean} [props.interactive] pan/zoom/handlers at all. When false
 *   the camera is PINNED — the map renders exactly the fitted boundaries
 *   (fitToBoundaries) and ignores every zoom/pan gesture, so an embedded
 *   card always shows the same clean city-wide frame; layer hover still
 *   works (those are layer events, not navigation handlers). Opt-in for
 *   display maps; default true = unchanged everywhere else.
 * @param {string[]} [props.markerLayerIds] parent overlay layers (pins,
 *   flight trails) that the optional "Markers" layer toggle shows/hides.
 * @param {string} [props.markerLabel] wording for that toggle (default
 *   "Markers").
 * @param {Array<object>} [props.flows] aggregate origin→destination movement
 *   pairs (from/to coordinates + total) drawn above the polygons.
 * @param {boolean} [props.preserveDrawingBuffer] keep the WebGL canvas
 *   readable after a frame for the Admin Map's PNG export. Opt-in: the cost
 *   is only paid by the one map that offers that action.
 * @param {object|null} [props.circles] paint-ready circle features from
 *   buildCircleFeatures(): one marker per barangay at its interior label
 *   point, sized by its value. Painted as four layers (glow, halo, marker,
 *   centre) UNDER the parent's own overlay, so pins stay on top.
 * @param {string|null} [props.selectedCircle] the selected circle's barangay
 *   name — hover/selection ride feature-state, so no source rebuilds.
 * @param {(name: string, feature: object, event: object) => void} [props.onCircleClick]
 *   a circle was clicked; falls back to onBarangayClick when absent.
 * @param {import("react").ReactNode} [props.sizeLegend] the circle-size
 *   legend item ("circle size = …"), shown beside the colour ramp.
 * @param {boolean} [props.showToolbar] render the app toolbar. Compact
 *   embedded maps (the landing snapshot) hide it but keep map gestures.
 * @param {import("react").ReactNode} [props.overlay] content rendered inside
 *   the map box's own stacking context (the shared detail panel), so it is
 *   positioned against the canvas rather than the page.
 * @param {boolean} [props.clusterCircles] group overlapping circles into one
 *   bubble until zoom 12 (default true). The bubble's size is the number of
 *   barangays it groups, its hover label reports the summed value, and a
 *   click zooms to split it. Set false for a map where every barangay must
 *   be separately visible at every zoom.
 * @param {string} [props.circleMetricLabel] what the circle/cluster values
 *   count, for the cluster hover label ("beneficiaries", "animals"…).
 * @param {"whole"|"circles"|"glow"} [props.circleMode] display mode for the
 *   markers. "whole" is the app default; "circles" removes the glow and keeps
 *   sizes exactly proportional; "glow" enlarges the radial light and the
 *   growth so the pulse reads as an illuminated hotspot.
 * @param {boolean} [props.pulseCircles] breathe every marker continuously
 *   (public hotspot map) instead of only the selected one. Always off for
 *   reduced-motion users and in "circles" mode.
 * @param {string} [props.shellClassName] extra class on the map box itself,
 *   for page-specific chrome (the landing map tags it to keep its mode switch
 *   clear of the attribution on phones).
 */
function BarangayMapImpl({
  boundaries,
  choropleth = null,
  onMapReady = null,
  onPick = null,
  selectedName = null,
  selectedFeatureId = null,
  onBarangayClick = null,
  onReset = null,
  clickThroughLayers = null,
  tooltipHtml = null,
  legend = null,
  legendNotes = null,
  showCredit = true,
  height = "h-[70vh] min-h-[480px]",
  ariaLabel = "Map of Bayawan City's barangays",
  beforeLayerId = null,
  fitToBoundaries = true,
  showLabels = false,
  labelShowCounts = false,
  labelCountLabel = "Total Dispersed",
  cooperativeGestures = false,
  interactive = true,
  zoomControls = false,
  markerLayerIds = [],
  markerLabel = "Markers",
  flows = [],
  preserveDrawingBuffer = false,
  circles = null,
  selectedCircle = null,
  onCircleClick = null,
  sizeLegend = null,
  showToolbar = true,
  overlay = null,
  clusterCircles = true,
  circleMetricLabel = "records",
  circleMode = "whole",
  pulseCircles = false,
  shellClassName = "",
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const labelMarkersRef = useRef([]);
  const labelVisibilityRef = useRef(null);
  const hoveredRef = useRef(null);
  const selectedRef = useRef(null);
  const onMapReadyRef = useRef(onMapReady);
  const onPickRef = useRef(onPick);
  const tooltipRef = useRef(tooltipHtml);
  const clickRef = useRef(onBarangayClick);
  const clickThroughRef = useRef(clickThroughLayers);
  const internalSelectedRef = useRef(null);
  const onResetRef = useRef(onReset);
  const onCircleClickRef = useRef(onCircleClick);
  const selectedCircleIdRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [markersOn, setMarkersOn] = useState(true);
  const [focusName, setFocusName] = useState("");

  useEffect(() => {
    onMapReadyRef.current = onMapReady;
  }, [onMapReady]);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);
  useEffect(() => {
    tooltipRef.current = tooltipHtml;
  }, [tooltipHtml]);
  useEffect(() => {
    clickRef.current = onBarangayClick;
  }, [onBarangayClick]);
  useEffect(() => {
    clickThroughRef.current = clickThroughLayers;
  }, [clickThroughLayers]);
  useEffect(() => {
    onResetRef.current = onReset;
  }, [onReset]);
  useEffect(() => {
    onCircleClickRef.current = onCircleClick;
  }, [onCircleClick]);

  const withBoundaries = boundaries?.status === "ready";

  const barangayNames = useMemo(() => {
    const features = boundaries?.collection?.features ?? [];
    return [...new Set(features.map((feature) => feature.properties?.name).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b),
    );
  }, [boundaries]);

  const clearInternalSelection = useCallback(() => {
    const map = mapRef.current;
    if (map && internalSelectedRef.current !== null) {
      try {
        map.setFeatureState(
          { source: BOUNDARY_SOURCE, id: internalSelectedRef.current },
          { selected: false },
        );
      } catch {
        // Source already torn down with the map.
      }
    }
    internalSelectedRef.current = null;
  }, []);

  /** Return to the whole-city frame and drop a search-selected barangay. */
  const resetView = useCallback(() => {
    setFocusName("");
    clearInternalSelection();
    onResetRef.current?.();
    if (!withBoundaries) return;
    const bounds = boundaryBounds(boundaries.collection);
    if (bounds) {
      mapRef.current?.fitBounds(bounds, { padding: 24, maxZoom: 13, duration: 300 });
    }
  }, [withBoundaries, boundaries, clearInternalSelection]);

  /** Zoom to one barangay and paint it selected (search / select control). */
  const focusBarangay = useCallback(
    (name) => {
      setFocusName(name);
      const map = mapRef.current;
      const feature = choropleth?.collection?.features?.find(
        (candidate) =>
          normalizeBarangayName(candidate.properties?.name) === normalizeBarangayName(name),
      );
      if (!map || !feature) return;

      clearInternalSelection();
      map.fitBounds(boundaryBounds({ features: [feature] }), {
        padding: 56,
        maxZoom: 13,
        duration: 400,
      });

      // The highlight rides the feature's STABLE id (its index in the static
      // asset — buildChoropleth assigns it), so it needs no query of rendered
      // features and survives fresh snapshots. In addition to any parent
      // selection; a later parent selection clears it.
      if (feature.id !== undefined && feature.id !== null) {
        try {
          map.setFeatureState(
            { source: BOUNDARY_SOURCE, id: feature.id },
            { selected: true },
          );
          internalSelectedRef.current = feature.id;
        } catch {
          // Source not ready yet; the camera move still helps.
        }
      }
    },
    [choropleth, clearInternalSelection],
  );

  // Map created once; the container owns it for its whole life.
  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [122.85, 9.65],
      zoom: 10,
      attributionControl: false,
      interactive,
      cooperativeGestures,
      preserveDrawingBuffer,
    });
    mapRef.current = map;
    // Debug/support handle, same convention as DispersalMap's: lets a
    // support session inspect what the WebGL canvas is drawing.
    containerRef.current.__cvoMap = map;

    // The +/− controls sit top-left, matching the barangay-profile maps the
    // LGU already publishes. Pinned display maps opt in through zoomControls:
    // the buttons still zoom, but no drag/scroll gesture is captured.
    if (interactive || zoomControls) {
      map.addControl(new NavigationControl({ showCompass: false }), "top-left");
    }
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    popupRef.current = new Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 8,
      className: "cvo-barangay-popup",
    });

    map.on("load", () => {
      // The parent binds its own layers/handlers to this instance; every
      // later addLayer from the parent lands above the boundary fill.
      onMapReadyRef.current?.(map);
      setReady(true);
    });

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      if (containerRef.current) delete containerRef.current.__cvoMap;
      hoveredRef.current = null;
      setReady(false);
    };
    // Created once per mount: the data effects below own every update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // MapLibre sizes its canvas from the container at creation time. A sidebar
  // collapsing, a tab switching or the card growing must call resize() or the
  // canvas keeps its old dimensions (stretched or letterboxed).
  useEffect(() => {
    const map = mapRef.current;
    const node = containerRef.current;
    if (!ready || !map || !node) return undefined;

    const resize = () => {
      try {
        map.resize();
      } catch {
        // Map already torn down.
      }
    };
    resize();
    window.addEventListener("resize", resize);

    let observer = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(resize);
      observer.observe(node);
    }

    return () => {
      window.removeEventListener("resize", resize);
      observer?.disconnect();
    };
  }, [ready]);

  // Keep the camera around Bayawan. The city bounds are static, so this runs
  // once per successful boundary load; maxBounds is padded so the surrounding
  // municipalities remain visible at the edge.
  useEffect(() => {
    if (!ready || !withBoundaries) return;
    // Pinned display maps (the landing snapshot) never pan, and a max-bounds
    // box narrower than their wide viewport at the city-fit zoom would force
    // MapLibre to zoom IN and crop the outer barangays. Only clamp maps the
    // user can actually navigate.
    if (!interactive) return;
    const map = mapRef.current;
    const bounds = boundaryBounds(boundaries.collection);
    if (!map || !bounds) return;
    const box = cameraBounds(bounds, containerRef.current);
    if (!box) return;
    try {
      map.setMaxBounds?.(box);
      map.setMinZoom?.(9);
    } catch {
      // A mid-teardown map can refuse camera options.
    }
  }, [ready, withBoundaries, boundaries, interactive]);

  // Click / hover behaviour for the polygons, bound once the map is up.
  // Re-bound on picker flips: picker mode takes the raw click instead.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;

    let fillHandlersBound = false;

    // MapLibre layer events are NOT occlusion-aware: a click on a pin also
    // reports the polygon underneath. When the topmost feature at the
    // pointer belongs to a parent layer (pins, flow lines), the polygons
    // stand down so the parent's own handler owns the interaction.
    // Returns what is on top of the polygon: "circle", "parent", or null.
    // The KIND matters for hover — a circle owns its own cursor tooltip, a
    // parent pin/trail does not.
    const polygonBlocker = (event) => {
      // Circles are ours and sit above the polygons: their own handler owns
      // the click. Parent layers (pins, trails) are passed in by the page.
      // Querying is restricted to those layers — and skipped entirely when a
      // page has neither — so a plain polygon map keeps its old cheap hover.
      const circleLayers = map.getSource(CIRCLE_SOURCE)
        ? CIRCLE_LAYER_IDS.filter((id) => map.getLayer(id))
        : [];
      if (
        circleLayers.length > 0 &&
        map.queryRenderedFeatures(event.point, { layers: circleLayers }).length > 0
      ) {
        return "circle";
      }

      const parentLayers = Array.isArray(clickThroughRef.current)
        ? clickThroughRef.current.filter((id) => map.getLayer(id))
        : [];
      if (
        parentLayers.length > 0 &&
        map.queryRenderedFeatures(event.point, { layers: parentLayers }).length > 0
      ) {
        return "parent";
      }

      return null;
    };

    const clearHover = () => {
      if (hoveredRef.current !== null) {
        try {
          map.setFeatureState(
            { source: BOUNDARY_SOURCE, id: hoveredRef.current },
            { hover: false },
          );
        } catch {
          // Source already torn down with the map.
        }
      }
      hoveredRef.current = null;
    };

    const onMove = (event) => {
      const blocker = polygonBlocker(event);
      if (blocker) {
        clearHover();
        // MapLibre fires this fill handler for the same pointer that is over
        // a circle, after the circle's own handler has shown its tooltip.
        // Removing the popup here would wipe it out immediately; only a
        // parent pin/trail makes the polygon stand down completely.
        if (blocker === "parent") popupRef.current?.remove();
        return;
      }
      const feature = event.features?.[0];
      if (!feature) return;

      if (hoveredRef.current !== null && hoveredRef.current !== feature.id) {
        try {
          map.setFeatureState(
            { source: BOUNDARY_SOURCE, id: hoveredRef.current },
            { hover: false },
          );
        } catch {
          // Source already torn down with the map.
        }
      }
      hoveredRef.current = feature.id ?? null;
      if (feature.id !== undefined && feature.id !== null) {
        map.setFeatureState({ source: BOUNDARY_SOURCE, id: feature.id }, { hover: true });
      }

      // The dark cursor-side label only exists where a page passes its own
      // tooltip (the flow map's metric readout). Pages with the permanent
      // name labels skip it: a second, cursor-side label would just cover
      // the map and its controls — the overlap the floating-window redesign
      // was asked to remove.
      if (!tooltipRef.current) return;
      popupRef.current
        ?.setLngLat(event.lngLat)
        .setHTML(tooltipRef.current(feature.properties ?? {}))
        .addTo(map);
    };

    const onLeave = () => {
      clearHover();
      popupRef.current?.remove();
    };

    const mapClick = (event) => {
      onPickRef.current?.([event.lngLat.lat, event.lngLat.lng]);
    };

    if (onPick) {
      map.getCanvas().style.cursor = "crosshair";
      map.on("click", mapClick);
      return () => {
        map.getCanvas().style.cursor = "";
        map.off("click", mapClick);
        onLeave();
      };
    }

    const polygonClick = (event) => {
      if (polygonBlocker(event)) return;
      const name = event.features?.[0]?.properties?.name ?? null;
      // The event rides along: a parent that opens an anchored card needs the
      // clicked lngLat and the polygon geometry, not just the name.
      clickRef.current?.(name, event);
    };

    // A click anywhere on the map clears the dark hover label: it is
    // cursor-side hover UI, and on TOUCH there is no hover phase — without
    // this, a tap on a pin would be swallowed by the label sitting under it.
    const onMapClickCloseTooltip = () => {
      clearHover();
      popupRef.current?.remove();
    };
    map.on("click", onMapClickCloseTooltip);

    // Bound lazily: the fill layer may not exist yet (asset still loading).
    const bindFill = () => {
      if (fillHandlersBound || !map.getLayer(FILL_LAYER)) return;
      map.on("mousemove", FILL_LAYER, onMove);
      map.on("mouseleave", FILL_LAYER, onLeave);
      map.on("click", FILL_LAYER, polygonClick);
      fillHandlersBound = true;
    };
    bindFill();
    map.on("sourcedata", bindFill);

    return () => {
      try {
        map.off("click", onMapClickCloseTooltip);
        map.off("sourcedata", bindFill);
        if (fillHandlersBound) {
          map.off("mousemove", FILL_LAYER, onMove);
          map.off("mouseleave", FILL_LAYER, onLeave);
          map.off("click", FILL_LAYER, polygonClick);
        }
      } catch {
        // Map already removed — nothing left to unbind.
      }
      onLeave();
    };
  }, [ready, onPick]);

  // The polygon layers: added when the map AND the joined features exist,
  // then only their DATA updates (the layers themselves never rebuild).
  useEffect(() => {
    if (!ready || !withBoundaries || !choropleth) return;
    const map = mapRef.current;
    if (!map) return;

    if (!map.getSource(BOUNDARY_SOURCE)) {
      // Feature ids come from buildChoropleth (stable per-asset indices), so
      // a selection survives a fresh snapshot and a search pick can resolve
      // its id without querying rendered features.
      map.addSource(BOUNDARY_SOURCE, {
        type: "geojson",
        data: choropleth.collection,
      });
      // The choropleth goes directly above the raster basemap, i.e. at the
      // BOTTOM of the app's own stack. Appending at the top (what an undefined
      // insertBefore does) would land the fill above overlays that were added
      // while the boundaries were still fetching — circles, movement lines —
      // and its 0.92 opacity would bury them. Inserting before the lowest
      // app layer keeps the fill under every overlay however late it arrives,
      // while `beforeLayerId` remains the hint for pages that want pins above.
      const layers = map.getStyle?.()?.layers ?? [];
      const basemapIndex = layers.findIndex((layer) => layer.id === "osm");
      const insertBefore =
        basemapIndex >= 0 ? layers[basemapIndex + 1]?.id : layers[0]?.id;
      map.addLayer(
        {
          id: FILL_LAYER,
          type: "fill",
          source: BOUNDARY_SOURCE,
          paint: {
            // Hover and selection both paint the SAME yellow on every page
            // that wears this choropleth (Dispersal Map, Overview dashboard,
            // Barangay Dispersal) — one hover behaviour, learned once. The
            // clicked barangay keeps its yellow while its card is open.
            "fill-color": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              "#fde047",
              ["boolean", ["feature-state", "hover"], false],
              "#fde047",
              ["get", "color"],
            ],
            "fill-opacity": 0.92,
            // Mode switches dim the fill with a cross-fade instead of a jump.
            "fill-opacity-transition": { duration: 320, delay: 0 },
          },
        },
        insertBefore,
      );
      // A white casing under a brand-green line: the green reads as the
      // barangay outline (weight ~2), while the casing keeps it legible over
      // both the pale zero-count fill and the darkest green.
      map.addLayer(
        {
          id: OUTLINE_CASING_LAYER,
          type: "line",
          source: BOUNDARY_SOURCE,
          layout: { "line-join": "round" },
          paint: {
            "line-color": "#ffffff",
            "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.6, 13, 4],
            "line-opacity": 0.9,
          },
        },
        insertBefore,
      );
      map.addLayer(
        {
          id: OUTLINE_LAYER,
          type: "line",
          source: BOUNDARY_SOURCE,
          layout: { "line-join": "round" },
          paint: {
            "line-color": "#2d4d19",
            // ONE zoom interpolate (MapLibre allows only one per expression);
            // the selected barangay's stop values widen the line — a
            // non-colour "which one is picked" cue alongside the yellow fill.
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              ["case", ["boolean", ["feature-state", "selected"], false], 3, 1.4],
              13,
              ["case", ["boolean", ["feature-state", "selected"], false], 5, 2.4],
            ],
            "line-opacity": 0.92,
          },
        },
        insertBefore,
      );
    } else {
      map.getSource(BOUNDARY_SOURCE).setData(choropleth.collection);
    }
  }, [ready, withBoundaries, choropleth, beforeLayerId]);

  // Aggregate movement flows: one dashed line per barangay pair, with the
  // from → to label at its midpoint. The layers are created once and then
  // only their data changes, so toggling movements never rebuilds the map.
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;

    const lineData = { type: "FeatureCollection", features: buildFlowFeatures(flows) };
    const labelData = { type: "FeatureCollection", features: buildFlowLabelFeatures(flows) };
    const insertBefore = beforeLayerId && map.getLayer(beforeLayerId) ? beforeLayerId : undefined;

    if (!map.getSource(FLOW_SOURCE)) {
      map.addSource(FLOW_SOURCE, { type: "geojson", data: lineData });
      map.addSource(FLOW_LABEL_SOURCE, { type: "geojson", data: labelData });
      map.addLayer(
        {
          id: FLOW_LAYER_IDS[0],
          type: "line",
          source: FLOW_SOURCE,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#b45309",
            "line-width": ["interpolate", ["linear"], ["get", "total"], 1, 1.4, 10, 5],
            "line-opacity": 0.82,
            "line-dasharray": [2, 1.2],
          },
        },
        insertBefore,
      );
      map.addLayer(
        {
          id: FLOW_LAYER_IDS[1],
          type: "symbol",
          source: FLOW_LABEL_SOURCE,
          layout: {
            "text-field": ["get", "label"],
            "text-size": 10,
            "text-offset": [0, -0.9],
            "text-allow-overlap": false,
            "text-padding": 3,
          },
          paint: {
            "text-color": "#92400e",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.5,
          },
        },
        insertBefore,
      );
    } else {
      map.getSource(FLOW_SOURCE)?.setData(lineData);
      map.getSource(FLOW_LABEL_SOURCE)?.setData(labelData);
    }
  }, [ready, flows, beforeLayerId]);

  // Circle markers: one data-driven source and four layers (glow, halo,
  // marker, centre dot), added UNDER the parent's overlay so pins and trails
  // keep their own clicks. Feature ids come from the choropleth's stable
  // indices, so hover/selection state survives a fresh snapshot.
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;

    const data = circles ?? { type: "FeatureCollection", features: [] };
    const insertBefore = beforeLayerId && map.getLayer(beforeLayerId) ? beforeLayerId : undefined;

    if (!map.getSource(CIRCLE_SOURCE)) {
      map.addSource(CIRCLE_SOURCE, {
        type: "geojson",
        data,
        ...circleSourceOptions(clusterCircles),
      });
      // Cluster bubbles first so the individual markers paint above them.
      if (clusterCircles) {
        for (const layer of circleClusterLayerSpecs()) map.addLayer({ ...layer }, insertBefore);
      }
      for (const layer of circleLayerSpecs(circleMode)) map.addLayer({ ...layer }, insertBefore);
    } else {
      map.getSource(CIRCLE_SOURCE).setData(data);
    }

    // Seed the state keys the paint expressions read. Without this a
    // feature-state read on a feature that has never been hovered can be
    // null inside arithmetic; zero keeps the resting paint exact.
    for (const feature of data.features ?? []) {
      if (feature.id === undefined || feature.id === null) continue;
      try {
        map.setFeatureState(
          { source: CIRCLE_SOURCE, id: feature.id },
          { hover: false, selected: false, pulse: 0 },
        );
      } catch {
        // Source torn down with the map.
      }
    }
    // A clustering change after the source exists cannot be applied to a
    // live GeoJSON source; pages set it once (as they do their overlays).
  }, [ready, circles, beforeLayerId, clusterCircles, circleMode]);

  // Display modes: recolour the four marker layers and let the polygon fill
  // step back so the glow reads. Only paint properties change — never the
  // layers or the source — so a mode switch cannot move a marker or a click.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer(CIRCLE_MAIN_LAYER)) return;
    // Cordless test doubles expose getLayer but not the paint API.
    if (typeof map.setPaintProperty !== "function") return;

    const paint = circlePaintForMode(circleMode);
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    try {
      for (const [layerId, properties] of Object.entries(paint)) {
        for (const [key, value] of Object.entries(properties)) {
          map.setPaintProperty(layerId, key, value);
        }
        // A mode switch is a cross-fade; reduced motion gets the final frame.
        if (reduced) {
          for (const key of [
            "circle-radius-transition",
            "circle-opacity-transition",
            "circle-color-transition",
            "circle-stroke-width-transition",
            "circle-stroke-opacity-transition",
          ]) {
            map.setPaintProperty(layerId, key, { duration: 0, delay: 0 });
          }
        }
      }

      // The choropleth steps back so the hotspot layer carries the emphasis,
      // but it never disappears: the fills still encode the same metric.
      if (withBoundaries && map.getLayer(FILL_LAYER)) {
        map.setPaintProperty(
          FILL_LAYER,
          "fill-opacity",
          circleMode === "glow" ? 0.2 : circleMode === "circles" ? 0.42 : 0.92,
        );
        if (reduced) {
          map.setPaintProperty(FILL_LAYER, "fill-opacity-transition", { duration: 0, delay: 0 });
        }
      }
    } catch {
      // Layers torn down with the map.
    }
  }, [ready, circleMode, circles, withBoundaries]);

  // Circle hover highlight, cursor feedback and click. Bound lazily: the
  // source is created by the effect above, which may land after map load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !circles) return undefined;

    let bound = false;
    let hovered = null;

    const clearHover = () => {
      if (hovered !== null) {
        try {
          map.setFeatureState({ source: CIRCLE_SOURCE, id: hovered }, { hover: false });
        } catch {
          // Source already torn down with the map.
        }
      }
      hovered = null;
      map.getCanvas().style.cursor = "";
    };

    const onMove = (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      if (hovered !== null && hovered !== feature.id) {
        try {
          map.setFeatureState({ source: CIRCLE_SOURCE, id: hovered }, { hover: false });
        } catch {
          // Source already torn down with the map.
        }
      }
      hovered = feature.id ?? null;
      if (feature.id !== undefined && feature.id !== null) {
        try {
          map.setFeatureState({ source: CIRCLE_SOURCE, id: feature.id }, { hover: true });
        } catch {
          // Source already torn down with the map.
        }
      }
      map.getCanvas().style.cursor = "pointer";
      if (tooltipRef.current) {
        popupRef.current
          ?.setLngLat(event.lngLat)
          .setHTML(tooltipRef.current(feature.properties ?? {}))
          .addTo(map);
      }
    };

    const onClick = (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const name = feature.properties?.name ?? null;
      if (!name) return;
      // Hand the page an event-shaped object with the circle's id and lngLat:
      // the same handlers that serve polygon clicks then work unchanged (the
      // circle and its polygon share the choropleth's stable id), so the
      // detail card anchors to the circle and the polygon highlight follows.
      const eventLike = {
        lngLat: event.lngLat,
        point: event.point,
        features: [feature],
      };
      if (onCircleClickRef.current) {
        onCircleClickRef.current(name, eventLike, event);
      } else {
        clickRef.current?.(name, eventLike);
      }
    };

    const leave = () => {
      clearHover();
      popupRef.current?.remove();
    };

    const bind = () => {
      if (bound || !map.getLayer(CIRCLE_CORE_LAYER)) return;
      // The marker layer is the hit target: the glow and halo are larger
      // than the value-scaled circle and would swallow neighbouring clicks.
      const hitLayer = map.getLayer(CIRCLE_MAIN_LAYER) ? CIRCLE_MAIN_LAYER : CIRCLE_CORE_LAYER;
      map.on("mousemove", hitLayer, onMove);
      map.on("mouseleave", hitLayer, leave);
      map.on("click", hitLayer, onClick);
      bound = true;
    };

    let clusterBound = false;

    const clusterTooltip = (properties) => {
      const count = Number(properties?.point_count) || 0;
      const total = Number(properties?.total) || 0;
      return (
        `<div style="min-width:160px">` +
        `<p style="margin:0;font-weight:600;color:#f8fafc">${count} barangay${count === 1 ? "" : "s"} grouped</p>` +
        `<p style="margin:2px 0 0;font-size:12px;color:#cbd5e1">${total.toLocaleString()} ${circleMetricLabel} in total</p>` +
        `<p style="margin:3px 0 0;font-size:11px;color:#94a3b8">Click to zoom in and separate them</p>` +
        `</div>`
      );
    };

    const onClusterMove = (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      map.getCanvas().style.cursor = "pointer";
      popupRef.current
        ?.setLngLat(event.lngLat)
        .setHTML(clusterTooltip(feature.properties ?? {}))
        .addTo(map);
    };

    const onClusterLeave = () => {
      map.getCanvas().style.cursor = "";
      popupRef.current?.remove();
    };

    const onClusterClick = (event) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      const source = map.getSource(CIRCLE_SOURCE);
      if (clusterId === undefined || !source?.getClusterExpansionZoom) return;

      const center = feature.geometry.coordinates.slice();
      const reduced =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // Zoom to the level where this cluster splits; the same gesture the
      // reference map uses, with a short eased camera move.
      Promise.resolve(source.getClusterExpansionZoom(clusterId))
        .then((zoom) => {
          map.easeTo({
            center,
            zoom: Math.max(Number(zoom) || map.getZoom() + 1, map.getZoom()),
            duration: reduced ? 0 : 450,
          });
        })
        .catch(() => {
          map.easeTo({
            center,
            zoom: Math.min(15, map.getZoom() + 2),
            duration: reduced ? 0 : 450,
          });
        });
    };

    const bindClusters = () => {
      if (clusterBound || !map.getLayer(CIRCLE_CLUSTER_LAYER)) return;
      map.on("mousemove", CIRCLE_CLUSTER_LAYER, onClusterMove);
      map.on("mouseleave", CIRCLE_CLUSTER_LAYER, onClusterLeave);
      map.on("click", CIRCLE_CLUSTER_LAYER, onClusterClick);
      clusterBound = true;
    };

    bind();
    bindClusters();
    map.on("sourcedata", bind);
    map.on("sourcedata", bindClusters);

    return () => {
      try {
        map.off("sourcedata", bind);
        map.off("sourcedata", bindClusters);
        if (bound) {
          map.off("mousemove", CIRCLE_MAIN_LAYER, onMove);
          map.off("mouseleave", CIRCLE_MAIN_LAYER, leave);
          map.off("click", CIRCLE_MAIN_LAYER, onClick);
        }
        if (clusterBound) {
          map.off("mousemove", CIRCLE_CLUSTER_LAYER, onClusterMove);
          map.off("mouseleave", CIRCLE_CLUSTER_LAYER, onClusterLeave);
          map.off("click", CIRCLE_CLUSTER_LAYER, onClusterClick);
        }
      } catch {
        // Map already removed — nothing left to unbind.
      }
      clearHover();
      popupRef.current?.remove();
    };
  }, [ready, circles]);

  // The selected circle: a heavier halo, a larger marker and a brighter
  // glow, all through feature-state — the source is never rebuilt.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !circles) return;

    const target = selectedCircle
      ? (circles.features ?? []).find(
          (feature) =>
            normalizeBarangayName(feature.properties?.name) ===
            normalizeBarangayName(selectedCircle),
        )
      : null;
    const nextId = target?.id ?? null;

    try {
      if (selectedCircleIdRef.current !== null && selectedCircleIdRef.current !== nextId) {
        map.setFeatureState(
          { source: CIRCLE_SOURCE, id: selectedCircleIdRef.current },
          { selected: false, pulse: 0 },
        );
      }
      if (nextId !== null) {
        map.setFeatureState({ source: CIRCLE_SOURCE, id: nextId }, { selected: true });
      }
    } catch {
      // Source already torn down with the map.
    }

    selectedCircleIdRef.current = nextId;
  }, [ready, circles, selectedCircle]);

  // Hotspot pulse. The selected circle always breathes; when a page asks for
  // it (the public map), EVERY circle breathes, each on its own phase so the
  // city shimmers rather than blinking in unison. ~24fps, feature-state only
  // (no React renders), paused while the tab is hidden, and replaced by a
  // static state under prefers-reduced-motion.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;

    const features = (circles?.features ?? []).filter(
      (feature) => feature.id !== undefined && feature.id !== null,
    );
    if (features.length === 0) return undefined;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const selectedId = selectedCircleIdRef.current;
    const pulseAll = Boolean(pulseCircles) && circleMode !== "circles" && !reduced;
    const pulseSelected = selectedId !== null && !reduced;

    const reset = () => {
      for (const feature of features) {
        try {
          map.setFeatureState({ source: CIRCLE_SOURCE, id: feature.id }, { pulse: 0 });
        } catch {
          return;
        }
      }
    };

    if (!pulseAll && !pulseSelected) {
      reset();
      return undefined;
    }

    let frame = 0;
    let last = 0;
    const start = performance.now();
    const period = 2800;

    // Only write feature-state while the map is on screen: the landing page is
    // long, and this animation must not cost anything once scrolled past.
    let visible = true;
    let observer = null;
    if (typeof IntersectionObserver === "function" && containerRef.current) {
      observer = new IntersectionObserver(
        ([entry]) => {
          visible = entry.isIntersecting;
        },
        { rootMargin: "120px" },
      );
      observer.observe(containerRef.current);
    }

    const tick = (now) => {
      if (now - last >= 42) {
        last = now;
        if (!document.hidden && visible) {
          for (let index = 0; index < features.length; index += 1) {
            const feature = features[index];
            const isSelected = feature.id === selectedId;
            if (!pulseAll && !isSelected) continue;
            // A fixed offset per marker keeps neighbours out of phase without
            // random values that would jump on every refetch.
            const delay = ((index * 0.37) % 1) * period;
            const wave =
              0.5 + 0.5 * Math.sin((((now - start) + delay) / period) * Math.PI * 2);
            try {
              map.setFeatureState(
                { source: CIRCLE_SOURCE, id: feature.id },
                { pulse: isSelected ? Math.max(wave, 0.4) : wave },
              );
            } catch {
              return;
            }
          }
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      reset();
    };
  }, [ready, circles, selectedCircle, pulseCircles, circleMode]);

  // Layer toggle: the parent's marker overlay is hidden by id. Boundaries
  // and labels are always on — the requested toolbar no longer offers them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || markerLayerIds.length === 0) return;
    const visibility = markersOn ? "visible" : "none";
    for (const id of markerLayerIds) {
      if (map.getLayer?.(id)) map.setLayoutProperty?.(id, "visibility", visibility);
    }
  }, [ready, markersOn, markerLayerIds, choropleth]);

  // The selected polygon stays yellow while the card is open — and the flag
  // is re-applied whenever the choropleth's data is replaced, because a
  // setData() can drop the state a previous click set.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !withBoundaries) return;

    try {
      // A parent-owned selection wins over a search highlight.
      if (
        selectedFeatureId !== null &&
        selectedFeatureId !== undefined &&
        internalSelectedRef.current !== null
      ) {
        map.setFeatureState(
          { source: BOUNDARY_SOURCE, id: internalSelectedRef.current },
          { selected: false },
        );
        internalSelectedRef.current = null;
        setFocusName("");
      }
      if (selectedRef.current !== null) {
        map.setFeatureState(
          { source: BOUNDARY_SOURCE, id: selectedRef.current },
          { selected: false },
        );
      }
      if (selectedFeatureId !== null && selectedFeatureId !== undefined) {
        map.setFeatureState(
          { source: BOUNDARY_SOURCE, id: selectedFeatureId },
          { selected: true },
        );
      }
    } catch {
      // Source already torn down with the map.
    }

    selectedRef.current = selectedFeatureId ?? null;
  }, [ready, withBoundaries, choropleth, selectedFeatureId]);

  // The barangay name labels: one DOM marker per polygon, anchored to a
  // point INSIDE the polygon (see barangayLabelPoint), so the name rides the
  // map through zoom and resize and always sits on its own barangay. The
  // markers are pointer-transparent — they never block a click or hover.
  // Created once from the first paint-ready collection; later collections
  // (a fresh snapshot) only refresh the count line, in place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !withBoundaries || !showLabels || !choropleth) return;

    const collection = choropleth.collection;
    const features = Array.isArray(collection?.features) ? collection.features : [];

    if (labelMarkersRef.current.length === 0) {
      const created = [];
      for (const feature of features) {
        const point = barangayLabelPoint(feature);
        if (!point) continue;
        const name = String(feature.properties?.name ?? "");
        const element = document.createElement("div");
        element.className = "cvo-barangay-label";
        const nameLine = document.createElement("p");
        nameLine.className = "cvo-barangay-label-name";
        nameLine.textContent = name;
        element.appendChild(nameLine);
        const countLine = document.createElement("p");
        countLine.className = "cvo-barangay-label-count";
        element.appendChild(countLine);
        // Always shifted: a page's circle data can arrive a render after the
        // labels, and re-creating markers later would flash the names. The
        // shift is small enough to read as a caption on maps without circles.
        const offsetY = LABEL_OFFSET_WITH_MARKERS;
        try {
          const marker = new Marker({ element, anchor: "center", offset: [0, offsetY] })
            .setLngLat(point)
            .addTo(map);
          created.push({
            marker,
            element,
            countLine,
            name: normalizeBarangayName(name),
            spanMeters: barangayLabelSpanMeters(feature),
            point,
            offsetY,
          });
        } catch {
          // A map mid-teardown can refuse a marker — skip it rather than
          // break the page.
        }
      }
      labelMarkersRef.current = created;

      // Declutter in two passes: hide any barangay too small on screen, then
      // hide a label that would collide with a larger one already shown. The
      // largest shapes claim the space first, so names stay legible instead
      // of stacking as the city fills more of the card.
      const applyVisibility = () => {
        const zoom = map.getZoom();
        const latitude = map.getCenter().lat;
        const metres = metresPerPixel(zoom, latitude);
        const candidates = [];

        for (const entry of labelMarkersRef.current) {
          const size = entry.spanMeters / metres;
          if (size < LABEL_MIN_PIXELS) {
            entry.element.style.visibility = "hidden";
            continue;
          }
          let projected = null;
          try {
            const anchor = map.project(entry.point);
            // The marker's DOM box is centred on the anchor PLUS its pixel
            // offset, so the collision test must use the shifted point.
            projected = { x: anchor.x, y: anchor.y + (entry.offsetY ?? 0) };
          } catch {
            // Projection is unavailable before the first paint; fall through
            // and let the size test alone decide.
          }
          candidates.push({
            entry,
            size,
            point: projected,
            width: entry.element.offsetWidth || LABEL_FALLBACK_WIDTH,
            height: entry.element.offsetHeight || LABEL_FALLBACK_HEIGHT,
          });
        }

        candidates.sort((a, b) => b.size - a.size);
        const shown = [];
        for (const candidate of candidates) {
          const box = candidate.point
            ? {
                left: candidate.point.x - candidate.width / 2 - LABEL_COLLISION_GAP,
                right: candidate.point.x + candidate.width / 2 + LABEL_COLLISION_GAP,
                top: candidate.point.y - candidate.height / 2 - LABEL_COLLISION_GAP,
                bottom: candidate.point.y + candidate.height / 2 + LABEL_COLLISION_GAP,
              }
            : null;
          const collides =
            box &&
            shown.some(
              (other) =>
                box.left < other.right &&
                box.right > other.left &&
                box.top < other.bottom &&
                box.bottom > other.top,
            );
          candidate.entry.element.style.visibility = collides ? "hidden" : "visible";
          if (!collides && box) shown.push(box);
        }
      };
      labelVisibilityRef.current = applyVisibility;
      map.on("move", applyVisibility);
      applyVisibility();
    }

    // Refresh the counts from the CURRENT collection (the markers' geometry
    // never changes, but a new snapshot changes the numbers).
    if (labelShowCounts) {
      const countByName = new Map(
        features.map((feature) => [
          normalizeBarangayName(feature.properties?.name),
          feature.properties?.row?.pins,
        ]),
      );
      for (const entry of labelMarkersRef.current) {
        const count = countByName.get(entry.name);
        if (typeof count === "number" && Number.isFinite(count)) {
          entry.countLine.textContent = `${labelCountLabel}: ${count}`;
          entry.countLine.hidden = false;
        } else {
          entry.countLine.textContent = "";
          entry.countLine.hidden = true;
        }
      }
    }
  }, [ready, withBoundaries, showLabels, labelShowCounts, labelCountLabel, choropleth, circles]);

  // A page that asked for no labels: take the markers down and unbind their
  // visibility handler.
  useEffect(() => {
    if (showLabels) return;
    const map = mapRef.current;
    if (map && labelVisibilityRef.current) map.off("move", labelVisibilityRef.current);
    labelVisibilityRef.current = null;
    for (const entry of labelMarkersRef.current) entry.marker.remove();
    labelMarkersRef.current = [];
  }, [showLabels]);

  // The selected barangay's label gets a non-colour cue to match the heavier
  // polygon outline: bolder, darker type (see .cvo-barangay-label--active in
  // index.css), so "which one is picked" survives greyscale and
  // colour-blindness. A parent-owned selection wins over the search focus.
  useEffect(() => {
    const active = normalizeBarangayName(selectedName || focusName || "");
    for (const entry of labelMarkersRef.current) {
      entry.element.classList.toggle(
        "cvo-barangay-label--active",
        Boolean(active) && entry.name === active,
      );
    }
  }, [selectedName, focusName, showLabels, ready, withBoundaries]);

  useEffect(
    () => () => {
      const map = mapRef.current;
      if (map && labelVisibilityRef.current) map.off("move", labelVisibilityRef.current);
      labelVisibilityRef.current = null;
      for (const entry of labelMarkersRef.current) entry.marker.remove();
      labelMarkersRef.current = [];
    },
    [],
  );

  // Camera: frame the whole city when the polygons arrive (they span more
  // than the centre points do), and zoom to a barangay when it is selected.
  useEffect(() => {
    if (!ready || !fitToBoundaries) return;

    if (selectedName) {
      const feature = choropleth?.collection?.features?.find(
        (candidate) => normalizeBarangayName(candidate.properties?.name) === normalizeBarangayName(selectedName),
      );
      if (feature) {
        mapRef.current?.fitBounds(boundaryBounds({ features: [feature] }), {
          padding: 48,
          maxZoom: 13,
          duration: 300,
        });
        return;
      }
    }

    if (!selectedName && withBoundaries) {
      const bounds = boundaryBounds(boundaries.collection);
      if (bounds) {
        mapRef.current?.fitBounds(bounds, { padding: 24, maxZoom: 13, duration: 0 });
      }
    }
    // boundaryBounds depends only on the static asset, not the metric.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitToBoundaries, withBoundaries, selectedName]);

  // Re-frame the city when the map BOX changes size. fitBounds runs against
  // the container it was measured in, so a shorter or narrower container (the
  // landing snapshot on a phone, a sidebar opening) would otherwise crop the
  // outer barangays. Skipped while a barangay is selected, so a deliberate
  // zoom is never snapped back.
  useEffect(() => {
    if (!ready || !fitToBoundaries || !withBoundaries || selectedName) {
      return undefined;
    }

    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return undefined;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      // One frame later: the canvas has taken the new box size by then.
      frame = window.requestAnimationFrame(() => {
        const bounds = boundaryBounds(boundaries.collection);
        if (bounds) {
          // The box depends on the map box's aspect, so a breakpoint change
          // needs a fresh camera box before the city is re-framed.
          const box = cameraBounds(bounds, container);
          if (box) mapRef.current?.setMaxBounds?.(box);
          mapRef.current?.fitBounds(bounds, {
            padding: 24,
            maxZoom: 13,
            duration: 0,
          });
        }
      });
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [ready, fitToBoundaries, withBoundaries, selectedName, boundaries]);

  const controlClass =
    "inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700";
  const pressedClass =
    "border-brand-600 bg-brand-50 text-brand-800";
  const mapBoxClass =
    `cvo-map-shell ${height} ${shellClassName} rounded-xl border border-slate-200 dark:border-slate-700`.trim();

  return (
    <div className="cvo-map-frame">
      {interactive && showToolbar && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {barangayNames.length > 0 && (
            <BarangaySearch
              names={barangayNames}
              value={focusName}
              onSelect={focusBarangay}
              onClear={resetView}
            />
          )}

          <div
            role="group"
            aria-label="Map layers"
            className="flex flex-wrap items-center gap-2"
          >
            {markerLayerIds.length > 0 && (
              <button
                type="button"
                onClick={() => setMarkersOn((value) => !value)}
                className={`${controlClass} ${markersOn ? pressedClass : ""}`}
                aria-pressed={markersOn}
                title={`Show or hide the ${markerLabel.toLowerCase()} overlay`}
              >
                <Icon name="map-pin" className="h-3.5 w-3.5" />
                {markerLabel}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="relative">
        <div
          ref={containerRef}
          className={mapBoxClass}
          role="application"
          aria-label={ariaLabel}
        />

        {boundaries?.status === "loading" && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl bg-slate-50/70">
            <span
              role="status"
              className="inline-flex items-center gap-2 rounded-pill bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200"
            >
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand-600" aria-hidden="true" />
              Loading barangay boundaries…
            </span>
          </div>
        )}

        {boundaries?.status === "unavailable" && (
          <div className="absolute inset-0 z-10 grid place-items-center rounded-xl bg-slate-50/85 p-4 text-center">
            <div
              role="alert"
              className="pointer-events-auto max-w-xs rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
            >
              <p className="text-sm font-semibold text-slate-900">
                Barangay boundaries unavailable
              </p>
              <p className="mt-1 text-xs text-slate-600">
                The basemap is still usable, but the barangay names and fills could not be loaded.
              </p>
              {boundaries.reload && (
                <button
                  type="button"
                  onClick={() => boundaries.reload()}
                  className="mt-3 inline-flex h-11 items-center rounded-lg bg-brand-700 px-4 text-xs font-semibold text-white hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                >
                  Try again
                </button>
              )}
            </div>
          </div>
        )}

        {overlay}
      </div>

      {(legend || showCredit || legendNotes || sizeLegend) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600">
          {legend && (
            <div className="flex items-center gap-2">
              <span>{legend.minLabel}</span>
              <span
                className="h-2.5 w-24 rounded-pill"
                style={{
                  background: `linear-gradient(to right, ${legend.stops.join(", ")})`,
                }}
                aria-hidden="true"
              />
              <span>{legend.maxLabel}</span>
            </div>
          )}
          {legendNotes}
          {circles && clusterCircles && (
            <span className="text-slate-500">
              Clusters group overlapping barangays — zoom in to separate them
            </span>
          )}
          {sizeLegend}
          {showCredit && (
            <span className="text-slate-400">
              Boundaries: UN OCHA COD-AB (PSA) · © OpenStreetMap contributors
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Memoised: a parent's re-render (a poll, a hover anchor) must not walk the
 * whole map subtree. Consumers that pass fresh closures every render defeat
 * this — keep callbacks and tooltips in useMemo/useCallback there.
 */
export const BarangayMap = memo(BarangayMapImpl);

export default BarangayMap;
