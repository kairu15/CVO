import { useEffect, useMemo, useRef, useState } from "react";
// Named imports, exactly like DispersalMap — the maplibre-gl build this app
// ships does not expose a default export.
import { Map as MapLibreMap, NavigationControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { OSM_STYLE } from "../config/mapStyle";
import { flowArcFeatures } from "../lib/flowArcs";
import {
  BOUNDARY_URL,
  DIVERGING_STOPS,
  SEQUENTIAL_STOPS,
  boundaryBounds,
  bubbleColor,
  bubbleRadius,
  buildChoropleth,
  formatMetricReadout,
  metricValue,
} from "../lib/barangayBoundaries";

/**
 * The barangay flow map: a choropleth of Bayawan City's 28 barangays, plus
 * the curved re-dispersal flow lines between them.
 *
 * Barangay POLYGONS carry the selected metric — the same single-hue green
 * scale the bubbles used, and a diverging blue↔amber scale centered on zero
 * for the net flow — never red-vs-green, and every colour meaning is
 * restated in the legend and the tooltip. Hovering a barangay lifts its fill
 * toward white and shows a dark label with its name and numbers, cursor-side.
 * The flow lines ride ON TOP of the fills, from centre to centre.
 *
 * Boundaries come from the UN OCHA Philippines COD-AB dataset (PSA geometry,
 * CC BY-IGO), bundled at public/geojson/bayawan-city-barangays.geojson and
 * joined to the rows by barangay name. When the asset cannot be fetched
 * (offline demo, blocked static file) the map falls back to the bubble
 * rendering — one bubble per barangay at its centroid, bubble AREA carrying
 * the dispersed volume — so the numbers stay on screen either way.
 *
 * The tooltip is a convenience — the exact numbers live in the barangay table
 * and the flow matrix beside this card, which are the keyboard-reachable
 * equivalents of everything drawn here.
 */

const BOUNDARY_SOURCE = "cvo-barangay-boundaries";
const BOUNDARY_FILL_LAYER = "barangay-boundaries-fill";
const BOUNDARY_OUTLINE_LAYER = "barangay-boundaries-outline";
const BUBBLE_SOURCE = "cvo-barangay-bubbles";
const FLOW_SOURCE = "cvo-barangay-flows";
const ARROW_SOURCE = "cvo-barangay-flow-arrows";
const FLOW_ARROW_IMAGE = "cvo-flow-arrow";

const FLOW_ARROW_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12">' +
  '<path d="M6 0 L11.5 11 L6 8.4 L0.5 11 Z" fill="#2d4d19" stroke="#ffffff" stroke-width="0.8"/></svg>';

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

function bubblePopupHtml(row, { metric, per1000, metricLabel, minRateAnimals }) {
  const rateText = formatMetricReadout(row, metric, per1000, minRateAnimals);

  return (
    `<div style="min-width:200px">` +
    `<p style="margin:0;font-weight:600;color:#0f172a">${escapeHtml(row.name)}</p>` +
    `<p style="margin:2px 0 6px;font-size:12px;color:#64748b">${escapeHtml(metricLabel)}: <strong>${escapeHtml(rateText)}</strong></p>` +
    `<p style="margin:0;font-size:12px;color:#64748b">Dispersed: ${row.dispersed} &middot; Out: ${row.redispersed_out} &middot; In: ${row.redispersed_in}</p>` +
    `<p style="margin:0;font-size:12px;color:#64748b">Within barangay: ${row.within_barangay} &middot; Net: ${row.net_flow >= 0 ? "+" : ""}${row.net_flow}</p>` +
    `<p style="margin:2px 0 0;font-size:11px;color:#94a3b8">Rate denominator: ${row.rate_denominator} animals${row.rate_eligible ? "" : ` (n < ${minRateAnimals})`}</p>` +
    `</div>`
  );
}

/** The choropleth's dark cursor-side label — same numbers, dark card. */
function barangayTooltipHtml(row, name, { metric, per1000, metricLabel, minRateAnimals }) {
  if (!row) {
    return (
      `<div style="min-width:140px">` +
      `<p style="margin:0;font-weight:600;color:#f8fafc">${escapeHtml(name)}</p>` +
      `<p style="margin:2px 0 0;font-size:11px;color:#94a3b8">No dispersals recorded in this period</p>` +
      `</div>`
    );
  }

  const rateText = formatMetricReadout(row, metric, per1000, minRateAnimals);

  return (
    `<div style="min-width:170px">` +
    `<p style="margin:0;font-weight:600;color:#f8fafc">${escapeHtml(name)}</p>` +
    `<p style="margin:2px 0 4px;font-size:12px;color:#cbd5e1">${escapeHtml(metricLabel)}: <strong>${escapeHtml(rateText)}</strong></p>` +
    `<p style="margin:0;font-size:11px;color:#94a3b8">Out: ${row.redispersed_out} &middot; In: ${row.redispersed_in} &middot; Net: ${row.net_flow >= 0 ? "+" : ""}${row.net_flow}</p>` +
    `</div>`
  );
}

function flowPopupHtml(flow) {
  return (
    `<div style="min-width:180px">` +
    `<p style="margin:0;font-weight:600;color:#0f172a">${escapeHtml(flow.properties.origin_name)} → ${escapeHtml(flow.properties.destination_name)}</p>` +
    `<p style="margin:2px 0 0;font-size:12px;color:#64748b">${flow.properties.count} animal${flow.properties.count === 1 ? "" : "s"} re-dispersed</p>` +
    `</div>`
  );
}

export function BarangayFlowMap({
  rows = [],
  flows = [],
  metric = "dispersed",
  metricLabel = "dispersals",
  per1000 = false,
  minRateAnimals = 5,
  topFlows = 10,
  includeCvo = false,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const darkPopupRef = useRef(null);
  const hoveredFeatureRef = useRef(null);
  const [ready, setReady] = useState(false);

  // The boundary asset: fetched once, joined to the rows for every metric.
  // "unavailable" keeps the bubble rendering alive for offline demos.
  const [boundaries, setBoundaries] = useState({ status: "loading", collection: null });

  useEffect(() => {
    let active = true;

    fetch(BOUNDARY_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((collection) => {
        if (active && Array.isArray(collection?.features) && collection.features.length > 0) {
          setBoundaries({ status: "ready", collection });
        } else if (active) {
          setBoundaries({ status: "unavailable", collection: null });
        }
      })
      .catch(() => {
        if (active) setBoundaries({ status: "unavailable", collection: null });
      });

    return () => {
      active = false;
    };
  }, []);

  const withBoundaries = boundaries.status === "ready";

  // The choropleth data: fill colour, hover colour and row text are computed
  // here, per feature, so the map layers stay dumb (a single "get" each).
  const choropleth = useMemo(() => {
    if (boundaries.status !== "ready") return null;
    return buildChoropleth(boundaries.collection, rows, { metric, per1000 });
  }, [boundaries, rows, metric, per1000]);

  // Bubble fallback data — only painted when the boundary asset is missing.
  const bubbleData = useMemo(() => {
    const key = metric;
    const values = rows.map((row) => metricValue(row, key, per1000));
    const max = Math.max(0, ...values.filter((v) => v !== null && !Number.isNaN(v)));

    return {
      max,
      collection: {
        type: "FeatureCollection",
        features: rows
          .filter((row) => row.latitude !== null && row.longitude !== null)
          .map((row) => {
            const value = metricValue(row, key, per1000);

            return {
              type: "Feature",
              properties: {
                row,
                value: value ?? 0,
                color: bubbleColor(value, max, key),
                r: bubbleRadius(value, max),
              },
              geometry: { type: "Point", coordinates: [row.longitude, row.latitude] },
            };
          }),
      },
    };
  }, [rows, metric, per1000]);

  const pointsById = useMemo(
    () =>
      new Map(
        rows
          .filter((row) => row.latitude !== null && row.longitude !== null)
          .map((row) => [row.barangay_id, { latitude: row.latitude, longitude: row.longitude }]),
      ),
    [rows],
  );

  const flowData = useMemo(
    () => flowArcFeatures(flows, pointsById, topFlows),
    [flows, pointsById, topFlows],
  );

  // Map created once; the container owns it for its whole life.
  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [122.85, 9.65],
      zoom: 10,
      attributionControl: false,
    });

    // The +/− control sits top-left, matching the barangay-profile maps the
    // LGU already publishes.
    map.addControl(new NavigationControl({ showCompass: false }), "top-left");
    popupRef.current = new Popup({ closeButton: false, offset: 10 });
    darkPopupRef.current = new Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 8,
      className: "cvo-barangay-popup",
    });

    map.on("load", () => {
      map.addSource(FLOW_SOURCE, { type: "geojson", data: flowData.arcs });
      map.addLayer({
        id: "barangay-flow-casing",
        type: "line",
        source: FLOW_SOURCE,
        layout: { "line-cap": "round" },
        paint: {
          "line-width": ["+", 2, ["*", 2.2, ["get", "width"]]],
          "line-color": "#ffffff",
          "line-opacity": 0.7,
        },
      });
      map.addLayer({
        id: "barangay-flow-lines",
        type: "line",
        source: FLOW_SOURCE,
        layout: { "line-cap": "round" },
        paint: {
          "line-width": ["+", 1, ["*", 1.8, ["get", "width"]]],
          "line-color": "#558b2f",
          "line-opacity": 0.8,
        },
      });

      map.addSource(ARROW_SOURCE, { type: "geojson", data: flowData.arrows });
      map.addLayer({
        id: "barangay-flow-arrows",
        type: "symbol",
        source: ARROW_SOURCE,
        layout: {
          "icon-image": FLOW_ARROW_IMAGE,
          "icon-rotate": ["get", "bearing"],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-size": 0.8,
        },
      });

      setReady(true);
    });

    mapRef.current = map;

    return () => {
      popupRef.current?.remove();
      darkPopupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      hoveredFeatureRef.current = null;
      setReady(false);
    };
    // Created once per mount: the data effects below own every update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register the arrow sprite once the style can take an image.
  useEffect(() => {
    if (!ready) return;

    const map = mapRef.current;
    if (!map || map.hasImage(FLOW_ARROW_IMAGE)) return;

    const image = new Image();
    image.onload = () => {
      if (map.hasImage(FLOW_ARROW_IMAGE)) return;
      try {
        map.addImage(FLOW_ARROW_IMAGE, image, { pixelRatio: 2 });
      } catch {
        // Map already removed — nothing left to register the image on.
      }
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(FLOW_ARROW_SVG)}`;
  }, [ready]);

  // One paint surface for the barangay shapes: polygons when the boundary
  // asset is here, bubbles when it is not. Layers insert BELOW the flow
  // lines, so flows and arrows always ride on top of the fills.
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;

    const below = "barangay-flow-casing";

    if (withBoundaries && choropleth) {
      if (!map.getSource(BOUNDARY_SOURCE)) {
        map.addSource(BOUNDARY_SOURCE, {
          type: "geojson",
          data: choropleth.collection,
          generateId: true,
        });
        map.addLayer(
          {
            id: BOUNDARY_FILL_LAYER,
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
          below,
        );
        map.addLayer(
          {
            id: BOUNDARY_OUTLINE_LAYER,
            type: "line",
            source: BOUNDARY_SOURCE,
            layout: { "line-join": "round" },
            paint: {
              "line-color": "#ffffff",
              "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.2, 13, 2.2],
              "line-opacity": 0.95,
            },
          },
          below,
        );
      } else {
        map.getSource(BOUNDARY_SOURCE).setData(choropleth.collection);
      }
    }

    if (!withBoundaries) {
      if (!map.getSource(BUBBLE_SOURCE)) {
        map.addSource(BUBBLE_SOURCE, { type: "geojson", data: bubbleData.collection });
        map.addLayer(
          {
            id: "barangay-bubbles",
            type: "circle",
            source: BUBBLE_SOURCE,
            paint: {
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                8,
                ["*", 2.2, ["get", "r"]],
                13,
                ["*", 7, ["get", "r"]],
              ],
              "circle-color": ["get", "color"],
              "circle-opacity": 0.85,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 1.2,
            },
          },
          below,
        );
      } else {
        map.getSource(BUBBLE_SOURCE).setData(bubbleData.collection);
      }
    }
  }, [ready, withBoundaries, choropleth, bubbleData]);

  // Flow lines follow the flows + the top-N control.
  useEffect(() => {
    if (!ready) return;
    mapRef.current?.getSource(FLOW_SOURCE)?.setData(flowData.arcs);
    mapRef.current?.getSource(ARROW_SOURCE)?.setData(flowData.arrows);
  }, [ready, flowData]);

  // Frame the city: the polygons' own extent when they are here (they span
  // more than the centre points do), the rows' extent otherwise.
  useEffect(() => {
    if (!ready) return;

    if (withBoundaries) {
      const bounds = boundaryBounds(boundaries.collection);
      if (bounds) {
        mapRef.current?.fitBounds(bounds, { padding: 24, maxZoom: 12, duration: 0 });
      }
      return;
    }

    if (rows.length === 0) return;
    const lats = rows.map((row) => row.latitude);
    const lngs = rows.map((row) => row.longitude);

    mapRef.current?.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 48, maxZoom: 12, duration: 0 },
    );
    // boundaryBounds depends only on the static asset, not the metric.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, withBoundaries]);

  // Hover behaviour. The choropleth lifts the hovered polygon and shows the
  // dark label cursor-side; the bubble fallback keeps its own tooltip; the
  // flow lines keep theirs in both modes.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;

    const lightPopup = popupRef.current;
    const darkPopup = darkPopupRef.current;

    const closeAll = () => {
      lightPopup.remove();
      darkPopup.remove();
    };

    const clearHover = () => {
      if (hoveredFeatureRef.current !== null) {
        try {
          map.setFeatureState(
            { source: BOUNDARY_SOURCE, id: hoveredFeatureRef.current },
            { hover: false },
          );
        } catch {
          // Source already torn down with the map.
        }
      }
      hoveredFeatureRef.current = null;
    };

    const tooltipOptions = { metric, per1000, metricLabel, minRateAnimals };

    const boundaryEnter = (event) => {
      const feature = event.features?.[0];
      if (!feature) return;

      if (hoveredFeatureRef.current !== null && hoveredFeatureRef.current !== feature.id) {
        try {
          map.setFeatureState(
            { source: BOUNDARY_SOURCE, id: hoveredFeatureRef.current },
            { hover: false },
          );
        } catch {
          // Source already torn down with the map.
        }
      }
      hoveredFeatureRef.current = feature.id ?? null;
      if (feature.id !== undefined && feature.id !== null) {
        map.setFeatureState({ source: BOUNDARY_SOURCE, id: feature.id }, { hover: true });
      }

      const row = feature.properties?.row;
      const parsed = typeof row === "string" ? JSON.parse(row) : row;
      darkPopup.setLngLat(event.lngLat).setHTML(
        barangayTooltipHtml(parsed, feature.properties?.name, tooltipOptions),
      ).addTo(map);
    };

    const bubbleEnter = (event) => {
      map.getCanvas().style.cursor = "pointer";
      const row = event.features?.[0]?.properties?.row;
      if (!row) return;
      closeAll();
      lightPopup
        .setLngLat(event.features[0].geometry.coordinates)
        .setHTML(
          bubblePopupHtml(typeof row === "string" ? JSON.parse(row) : row, tooltipOptions),
        )
        .addTo(map);
    };

    const flowEnter = (event) => {
      map.getCanvas().style.cursor = "pointer";
      const flow = event.features?.[0];
      if (!flow) return;
      closeAll();
      lightPopup.setLngLat(event.lngLat).setHTML(flowPopupHtml(flow)).addTo(map);
    };

    const leave = () => {
      map.getCanvas().style.cursor = "";
      clearHover();
      closeAll();
    };

    if (withBoundaries) {
      map.on("mousemove", BOUNDARY_FILL_LAYER, boundaryEnter);
      map.on("mouseleave", BOUNDARY_FILL_LAYER, leave);
    } else {
      map.on("mousemove", "barangay-bubbles", bubbleEnter);
      map.on("mouseleave", "barangay-bubbles", leave);
    }

    map.on("mousemove", "barangay-flow-lines", flowEnter);
    map.on("mouseleave", "barangay-flow-lines", leave);

    return () => {
      if (withBoundaries) {
        map.off("mousemove", BOUNDARY_FILL_LAYER, boundaryEnter);
        map.off("mouseleave", BOUNDARY_FILL_LAYER, leave);
      } else {
        map.off("mousemove", "barangay-bubbles", bubbleEnter);
        map.off("mouseleave", "barangay-bubbles", leave);
      }
      map.off("mousemove", "barangay-flow-lines", flowEnter);
      map.off("mouseleave", "barangay-flow-lines", leave);
      clearHover();
      closeAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tooltipOptions is rebuilt with its deps
  }, [ready, withBoundaries, metric, per1000, metricLabel, minRateAnimals]);

  const legend = useMemo(() => {
    const max = withBoundaries ? (choropleth?.max ?? 0) : bubbleData.max;
    const diverging = metric === "net_flow";
    const stops = diverging ? DIVERGING_STOPS : SEQUENTIAL_STOPS;

    const sizeSamples = [max, max / 2, max / 4]
      .filter((v) => v > 0)
      .slice(0, 3)
      .map((v) => ({
        value: per1000 ? Math.round(v) : Math.round(v * 10) / 10,
        size: 8 + bubbleRadius(v, max) * 3.4,
      }));

    return {
      diverging,
      stops,
      sizeSamples,
      minLabel: diverging ? "net outflow" : per1000 ? "per 1,000 residents" : "fewer",
      maxLabel: diverging ? "net inflow" : "more",
    };
  }, [withBoundaries, choropleth, bubbleData, metric, per1000]);

  return (
    <div>
      <div
        ref={containerRef}
        className="cvo-map-shell h-96 rounded-xl border border-slate-200 dark:border-slate-700"
        role="application"
        aria-label={`Map of Bayawan City's barangays coloured by ${metricLabel}. The barangay table below carries the same numbers.`}
      />

      {/* Legend: polygons (or bubbles) colour by the selected metric; in the
          bubble fallback, size is the dispersed volume. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600">
        {!withBoundaries && (
          <div className="flex items-center gap-2">
            <span className="font-semibold">Bubble size</span>
            <span>dispersed volume (area)</span>
            <span className="flex items-end gap-1" aria-hidden="true">
              {legend.sizeSamples.map((sample) => (
                <span
                  key={sample.value}
                  className="inline-block rounded-full bg-brand-700/80"
                  style={{ width: sample.size, height: sample.size }}
                  title={`${sample.value}`}
                />
              ))}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="font-semibold">{metricLabel}</span>
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

        {metric === "redispersal_rate" && (
          <span className="text-slate-500">Greyed: not ranked (n &lt; {minRateAnimals})</span>
        )}
        {withBoundaries && metric !== "redispersal_rate" && choropleth?.max === 0 && (
          <span className="text-slate-500">Greyed: no dispersals recorded in this period</span>
        )}
        {!withBoundaries && metric !== "redispersal_rate" && bubbleData.max === 0 && (
          <span className="text-slate-500">Greyed: no population recorded</span>
        )}

        {includeCvo && (
          <span className="text-slate-500">CVO → barangay lines included via the source toggle</span>
        )}

        {withBoundaries && (
          <span className="text-slate-400">
            Boundaries: UN OCHA COD-AB (PSA) · © OpenStreetMap contributors
          </span>
        )}
      </div>
    </div>
  );
}

export default BarangayFlowMap;
