import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  barangayLabelPoint,
  barangayLabelSpanMeters,
  boundaryBounds,
  normalizeBarangayName,
} from "../lib/barangayBoundaries";

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

/** Metres per screen pixel at a given zoom, for a given latitude. */
function metresPerPixel(zoom, latitude) {
  return (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Keep the camera near Bayawan: pad the city bounds by ~a third of their
 * size, so neighbouring municipalities peek in at the edge but a user cannot
 * lose the city. MapLibre takes [[west, south], [east, north]].
 */
function clampBounds(bounds) {
  // boundaryBounds() returns [west, south, east, north].
  const [west, south, east, north] = bounds;
  const padX = (east - west) * 0.35;
  const padY = (north - south) * 0.35;
  return [
    [west - padX, south - padY],
    [east + padX, north + padY],
  ];
}

/**
 * The shared barangay choropleth: one MapLibre map wearing the 28 Bayawan
 * City barangay polygons — green fills, white borders, a YELLOW hover
 * highlight, and the +/− controls at the top-left, in the style of the LGU's
 * own barangay-profile maps. The yellow hover is the same on every page that
 * wears this choropleth. Pages pass `showLabels` to pin a permanent name
 * (and, with `labelShowCounts`, the barangay's dispersal count) inside each
 * polygon; pages that pass `tooltipHtml` also get their dark cursor-side
 * metric label back on hover.
 *
 * This component OWNS the map instance and the polygon layers; the pages
 * that use it (BarangayFlowMap, the Dispersal Map) add their own data on top
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
 * @param {boolean} [props.labelShowCounts] under each name, the barangay's
 *   dispersal count from the joined row (`row.pins` — the animals currently
 *   dispersed there). Pages without a joined row simply show names.
 * @param {boolean} [props.cooperativeGestures] scroll-guard for maps embedded
 *   in a scrolling PAGE: a plain wheel scroll no longer zooms the map — it
 *   shows the "Use Ctrl + scroll to zoom the map" hint instead and lets the
 *   page keep scrolling; touch needs two fingers. Opt-in: the dashboard maps
 *   own their viewport, so they keep the direct scroll-zoom (default false =
 *   today's behaviour everywhere else).
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
 */
export function BarangayChoropleth({
  boundaries,
  choropleth = null,
  onMapReady = null,
  onPick = null,
  selectedName = null,
  selectedFeatureId = null,
  onBarangayClick = null,
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
  cooperativeGestures = false,
  interactive = true,
  markerLayerIds = [],
  markerLabel = "Markers",
}) {
  const containerRef = useRef(null);
  const shellRef = useRef(null);
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
  const [ready, setReady] = useState(false);
  const [labelsOn, setLabelsOn] = useState(Boolean(showLabels));
  const [boundariesOn, setBoundariesOn] = useState(true);
  const [markersOn, setMarkersOn] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cssFullscreen, setCssFullscreen] = useState(false);
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

  const withBoundaries = boundaries?.status === "ready";

  const barangayNames = useMemo(() => {
    const features = boundaries?.collection?.features ?? [];
    return [...new Set(features.map((feature) => feature.properties?.name).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b),
    );
  }, [boundaries]);

  // The toolbar can switch labels, but pages still decide the default; reset
  // it when a page changes that default (e.g. a pinned display map).
  useEffect(() => {
    setLabelsOn(Boolean(showLabels));
  }, [showLabels]);

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
    if (!withBoundaries) return;
    const bounds = boundaryBounds(boundaries.collection);
    if (bounds) {
      mapRef.current?.fitBounds(bounds, { padding: 24, maxZoom: 12, duration: 300 });
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

      // Feature ids are generated when the source is added, so resolve the
      // rendered id (rather than the GeoJSON array index) once the camera has
      // settled. The highlight is in addition to any parent selection.
      const highlight = () => {
        try {
          const rendered = map.querySourceFeatures?.(BOUNDARY_SOURCE) ?? [];
          const match = rendered.find(
            (candidate) =>
              normalizeBarangayName(candidate.properties?.name) === normalizeBarangayName(name),
          );
          if (match?.id !== undefined && match?.id !== null) {
            map.setFeatureState(
              { source: BOUNDARY_SOURCE, id: match.id },
              { selected: true },
            );
            internalSelectedRef.current = match.id;
          }
        } catch {
          // Source not queryable yet; the camera move still helps.
        }
      };
      if (typeof map.once === "function") map.once("idle", highlight);
      else highlight();
    },
    [choropleth, clearInternalSelection],
  );

  const toggleFullscreen = useCallback(async () => {
    const node = shellRef.current ?? containerRef.current;
    if (!node) return;
    if (document.fullscreenElement === node) {
      await document.exitFullscreen?.();
      return;
    }
    if (cssFullscreen) {
      setCssFullscreen(false);
      return;
    }
    try {
      if (!node.requestFullscreen) {
        setCssFullscreen(true);
        return;
      }
      await node.requestFullscreen();
      // Some headless/embedded browsers resolve the promise without actually
      // entering fullscreen; use the fallback when that happens.
      if (document.fullscreenElement !== node) setCssFullscreen(true);
    } catch {
      // Headless browsers, iframes and some phone browsers refuse the native
      // API. Fall back to a fixed full-viewport card so the control still
      // does what it says.
      setCssFullscreen(true);
    }
  }, [cssFullscreen]);

  // Escape closes the CSS fallback (native fullscreen handles its own Esc).
  useEffect(() => {
    if (!cssFullscreen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setCssFullscreen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cssFullscreen]);

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
    });
    mapRef.current = map;
    // Debug/support handle, same convention as DispersalMap's: lets a
    // support session inspect what the WebGL canvas is drawing.
    containerRef.current.__cvoMap = map;

    // The +/− controls sit top-left, matching the barangay-profile maps the
    // LGU already publishes — except on a pinned (non-interactive) map,
    // where there is nothing for them to do.
    if (interactive) {
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

  // Native fullscreen changes the container box without a window resize; the
  // observer above usually catches it, this is the belt-and-braces path for
  // browsers that paint fullscreen before layout settles.
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === shellRef.current);
      if (!document.fullscreenElement) setCssFullscreen(false);
      window.setTimeout(() => {
        try {
          mapRef.current?.resize();
        } catch {
          // Map already torn down.
        }
      }, 60);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Keep the camera around Bayawan. The city bounds are static, so this runs
  // once per successful boundary load; maxBounds is padded so the surrounding
  // municipalities remain visible at the edge.
  useEffect(() => {
    if (!ready || !withBoundaries) return;
    const map = mapRef.current;
    const bounds = boundaryBounds(boundaries.collection);
    if (!map || !bounds) return;
    try {
      map.setMaxBounds?.(clampBounds(bounds));
      map.setMinZoom?.(9);
    } catch {
      // A mid-teardown map can refuse camera options.
    }
  }, [ready, withBoundaries, boundaries]);

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
    const polygonBlocked = (event) => {
      const layers = clickThroughRef.current;
      if (!layers || layers.length === 0) return false;
      const top = map.queryRenderedFeatures(event.point);
      return top.some((feature) => layers.includes(feature.layer?.id));
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
      if (polygonBlocked(event)) {
        clearHover();
        popupRef.current?.remove();
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
      if (polygonBlocked(event)) return;
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
      map.addSource(BOUNDARY_SOURCE, {
        type: "geojson",
        data: choropleth.collection,
        generateId: true,
      });
      const insertBefore = beforeLayerId && map.getLayer(beforeLayerId) ? beforeLayerId : undefined;
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
            "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.4, 13, 2.4],
            "line-opacity": 0.92,
          },
        },
        insertBefore,
      );
    } else {
      map.getSource(BOUNDARY_SOURCE).setData(choropleth.collection);
    }
  }, [ready, withBoundaries, choropleth, beforeLayerId]);

  // Layer toggles: boundaries and labels are ours; marker layers belong to
  // the parent but are hidden by id. Declared AFTER the layer effect so the
  // first paint already carries the current toggle state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = boundariesOn ? "visible" : "none";
    for (const id of [FILL_LAYER, OUTLINE_CASING_LAYER, OUTLINE_LAYER]) {
      if (map.getLayer?.(id)) map.setLayoutProperty?.(id, "visibility", visibility);
    }
  }, [ready, boundariesOn, choropleth]);

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
    if (!map || !ready || !withBoundaries || !labelsOn || !choropleth) return;

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
        try {
          const marker = new Marker({ element, anchor: "center" })
            .setLngLat(point)
            .addTo(map);
          created.push({
            marker,
            element,
            countLine,
            name: normalizeBarangayName(name),
            spanMeters: barangayLabelSpanMeters(feature),
            point,
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
            projected = map.project(entry.point);
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
          entry.countLine.textContent = `Total Dispersed: ${count}`;
          entry.countLine.hidden = false;
        } else {
          entry.countLine.textContent = "";
          entry.countLine.hidden = true;
        }
      }
    }
  }, [ready, withBoundaries, labelsOn, labelShowCounts, choropleth]);

  // Labels switched off (or the component unmounting): take the markers down
  // and unbind their visibility handler.
  useEffect(() => {
    if (labelsOn) return;
    const map = mapRef.current;
    if (map && labelVisibilityRef.current) map.off("move", labelVisibilityRef.current);
    labelVisibilityRef.current = null;
    for (const entry of labelMarkersRef.current) entry.marker.remove();
    labelMarkersRef.current = [];
  }, [labelsOn]);

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
        mapRef.current?.fitBounds(bounds, { padding: 24, maxZoom: 12, duration: 0 });
      }
    }
    // boundaryBounds depends only on the static asset, not the metric.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitToBoundaries, withBoundaries, selectedName]);

  const controlClass =
    "inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700";
  const pressedClass =
    "border-brand-600 bg-brand-50 text-brand-800";
  const fullscreenActive = isFullscreen || cssFullscreen;
  // Native fullscreen and the CSS fallback share the same explicit frame: a
  // full-viewport flex column, so the canvas takes the space left by the
  // toolbar and legend instead of collapsing to its pre-fullscreen height.
  const frameClass = fullscreenActive
    ? "cvo-map-frame fixed inset-0 z-[70] flex h-screen w-screen flex-col gap-3 overflow-auto bg-slate-50 p-3"
    : "cvo-map-frame";
  const mapBoxClass = fullscreenActive
    ? "cvo-map-shell min-h-0 w-full flex-1 rounded-none border-0"
    : `cvo-map-shell ${height} rounded-xl border border-slate-200 dark:border-slate-700`;

  return (
    <div ref={shellRef} className={frameClass}>
      {interactive && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {barangayNames.length > 0 && (
            <label className="relative">
              <span className="sr-only">Find and zoom to a barangay</span>
              <select
                aria-label="Find and zoom to a barangay"
                value={focusName}
                onChange={(event) => {
                  const name = event.target.value;
                  if (name) focusBarangay(name);
                  else resetView();
                }}
                className="field h-11 min-w-[11rem] !py-0 text-xs"
              >
                <option value="">Find a barangay…</option>
                {barangayNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            onClick={resetView}
            className={controlClass}
            aria-label="Reset map to the whole city"
          >
            Reset view
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            className={controlClass}
            aria-pressed={fullscreenActive}
            aria-label={fullscreenActive ? "Exit map full screen" : "View map full screen"}
          >
            {fullscreenActive ? "Exit full screen" : "Full screen"}
          </button>

          <div
            role="group"
            aria-label="Map layers"
            className="flex flex-wrap items-center gap-2"
          >
            <button
              type="button"
              onClick={() => setBoundariesOn((value) => !value)}
              className={`${controlClass} ${boundariesOn ? pressedClass : ""}`}
              aria-pressed={boundariesOn}
            >
              Boundaries
            </button>
            {showLabels && (
              <button
                type="button"
                onClick={() => setLabelsOn((value) => !value)}
                className={`${controlClass} ${labelsOn ? pressedClass : ""}`}
                aria-pressed={labelsOn}
              >
                Labels
              </button>
            )}
            {markerLayerIds.length > 0 && (
              <button
                type="button"
                onClick={() => setMarkersOn((value) => !value)}
                className={`${controlClass} ${markersOn ? pressedClass : ""}`}
                aria-pressed={markersOn}
              >
                {markerLabel}
              </button>
            )}
          </div>
        </div>
      )}

      <div
        className={`relative ${fullscreenActive ? "flex min-h-0 flex-1 flex-col" : ""}`}
      >
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
      </div>

      {(legend || showCredit || legendNotes) && (
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

export default BarangayChoropleth;
