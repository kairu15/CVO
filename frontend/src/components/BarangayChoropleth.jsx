import { useEffect, useRef, useState } from "react";
// Named imports, exactly like DispersalMap — the maplibre-gl build this app
// ships does not expose a default export.
import { AttributionControl, Map as MapLibreMap, NavigationControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { OSM_STYLE } from "../config/mapStyle";
import { boundaryBounds, normalizeBarangayName } from "../lib/barangayBoundaries";

/**
 * The shared barangay choropleth: one MapLibre map wearing the 28 Bayawan
 * City barangay polygons — green fills, white borders, a hover lift with a
 * dark cursor-side label, and the +/− controls at the top-left, in the style
 * of the LGU's own barangay-profile maps.
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
 * @param {(name: string|null) => void} [props.onBarangayClick]
 *   polygon click; the parent owns selection state (click again = clear)
 * @param {string[]} [props.clickThroughLayers] parent layer ids that SWALLOW
 *   a click/hover — MapLibre layer events are not occlusion-aware, so
 *   without this gate a click on a pin or flow line would ALSO select the
 *   barangay polygon underneath it. When the topmost feature at the pointer
 *   belongs to one of these layers, the polygons ignore the event.
 * @param {(properties: object) => string} [props.tooltipHtml]
 *   the dark hover label's HTML, from the feature properties buildChoropleth
 *   attached (name, color, hoverColor, value, row)
 * @param {{stops: string[], minLabel: string, maxLabel: string}|null} [props.legend]
 * @param {import("react").ReactNode} [props.legendNotes] appended legend text
 * @param {boolean} [props.showCredit] the boundaries/OSM credit line
 * @param {string} [props.height] tailwind height class for the map box
 * @param {string} [props.ariaLabel]
 * @param {string|null} [props.beforeLayerId] first PARENT layer id — the
 *   boundary layers insert before it so parent data paints above the fills
 * @param {boolean} [props.fitToBoundaries] frame the city once polygons load
 */
export function BarangayChoropleth({
  boundaries,
  choropleth = null,
  onMapReady = null,
  onPick = null,
  selectedName = null,
  onBarangayClick = null,
  clickThroughLayers = null,
  tooltipHtml = null,
  legend = null,
  legendNotes = null,
  showCredit = true,
  height = "h-96",
  ariaLabel = "Map of Bayawan City's barangays",
  beforeLayerId = null,
  fitToBoundaries = true,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const hoveredRef = useRef(null);
  const onMapReadyRef = useRef(onMapReady);
  const onPickRef = useRef(onPick);
  const tooltipRef = useRef(tooltipHtml);
  const clickRef = useRef(onBarangayClick);
  const clickThroughRef = useRef(clickThroughLayers);
  const [ready, setReady] = useState(false);

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

  // Map created once; the container owns it for its whole life.
  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [122.85, 9.65],
      zoom: 10,
      attributionControl: false,
    });
    mapRef.current = map;
    // Debug/support handle, same convention as DispersalMap's: lets a
    // support session inspect what the WebGL canvas is drawing.
    containerRef.current.__cvoMap = map;

    // The +/− controls sit top-left, matching the barangay-profile maps the
    // LGU already publishes.
    map.addControl(new NavigationControl({ showCompass: false }), "top-left");
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

      const html = tooltipRef.current
        ? tooltipRef.current(feature.properties ?? {})
        : `<p style="margin:0;font-weight:600;color:#f8fafc">${String(feature.properties?.name ?? "")}</p>`;
      popupRef.current?.setLngLat(event.lngLat).setHTML(html).addTo(map);
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
            // Hover lifts the fill toward white — the case reads the
            // feature-state the pointer handlers set and clear.
            "fill-color": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              ["get", "hoverColor"],
              ["get", "color"],
            ],
            "fill-opacity": 0.92,
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
            "line-color": "#ffffff",
            "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.2, 13, 2.2],
            "line-opacity": 0.95,
          },
        },
        insertBefore,
      );
    } else {
      map.getSource(BOUNDARY_SOURCE).setData(choropleth.collection);
    }
  }, [ready, withBoundaries, choropleth, beforeLayerId]);

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

  return (
    <div>
      <div
        ref={containerRef}
        className={`cvo-map-shell ${height} rounded-xl border border-slate-200 dark:border-slate-700`}
        role="application"
        aria-label={ariaLabel}
      />

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
