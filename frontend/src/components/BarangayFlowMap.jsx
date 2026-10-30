import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Named imports, exactly like DispersalMap — the maplibre-gl build this app
// ships does not expose a default export.
import { Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { flowArcFeatures } from "../lib/flowArcs";
import {
  DIVERGING_STOPS,
  SEQUENTIAL_STOPS,
  bubbleColor,
  bubbleRadius,
  buildChoropleth,
  formatMetricReadout,
  metricValue,
  normalizeBarangayName,
} from "../lib/barangayBoundaries";
import { analyticsApi } from "../api/analyticsApi";
import { getErrorMessage } from "../api/client";
import { useBarangayBoundaries } from "../hooks/useBarangayBoundaries";
import { BARANGAY_FILL_LAYER, BarangayChoropleth } from "./BarangayChoropleth";

/**
 * The barangay flow map: the shared barangay choropleth (polygon fills
 * coloured by the selected metric, hover lift, dark cursor-side label) plus
 * the curved re-dispersal flow lines between barangays.
 *
 * The fill carries the same single-hue green scale the bubbles used, and a
 * diverging blue↔amber scale centered on zero for the net flow — never
 * red-vs-green, and every colour meaning is restated in the legend and the
 * tooltip. The flow lines ride ON TOP of the fills (the choropleth inserts
 * its layers before "barangay-flow-casing"), from centre to centre.
 *
 * When the boundary asset cannot be fetched (offline demo, blocked static
 * file) the map falls back to the BUBBLE rendering — one bubble per barangay
 * at its centroid, bubble AREA carrying the dispersed volume — so the
 * numbers stay on screen either way.
 *
 * The tooltip is a convenience — the exact numbers live in the barangay table
 * and the flow matrix beside this card, which are the keyboard-reachable
 * equivalents of everything drawn here.
 */

const BUBBLE_SOURCE = "cvo-barangay-bubbles";
const BUBBLE_LAYER = "barangay-bubbles";
const FLOW_SOURCE = "cvo-barangay-flows";
const ARROW_SOURCE = "cvo-barangay-flow-arrows";
const FLOW_ARROW_IMAGE = "cvo-flow-arrow";

/** The selected barangay's outline — drawn from the clicked polygon itself. */
const SELECTION_SOURCE = "cvo-barangay-selected";
const SELECTION_LAYER = "cvo-barangay-selected-outline";

const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };

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

/** AY-m-d date as the card shows it; the API sends date-only strings. */
function formatEventDate(iso) {
  if (!iso) return "";
  const parsed = new Date(`${iso}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

/**
 * The click-to-open barangay card (dark, anchored, with the popup's own
 * pointer). Built as HTML because a MapLibre popup is a DOM node; every value
 * is escaped and the SAME popup is re-filled as the detail arrives, so an open
 * card never flickers shut while it loads.
 */
function selectionPopupHtml({ name, row, recipients, loading, error }) {
  const head =
    `<div class="cvo-detail-head">` +
    `<p class="cvo-detail-eyebrow">Barangay</p>` +
    `<p class="cvo-detail-title">${escapeHtml(name)}</p>` +
    `</div>`;

  if (loading) {
    return `<div class="cvo-detail">${head}<p class="cvo-detail-status">Loading barangay details…</p></div>`;
  }

  if (error) {
    return `<div class="cvo-detail">${head}<p class="cvo-detail-status cvo-detail-error">${escapeHtml(error)}</p></div>`;
  }

  if (!row) {
    return `<div class="cvo-detail">${head}<p class="cvo-detail-status">No details recorded for this barangay.</p></div>`;
  }

  const net = Number(row.net_flow) || 0;
  const animals = recipients.reduce(
    (total, entry) => total + Number(entry.quantity ?? 0),
    0,
  );

  const list = recipients.length
    ? `<ul class="cvo-detail-list">` +
      recipients
        .map(
          (entry) =>
            `<li class="cvo-detail-recipient">` +
            `<span class="cvo-detail-qty">${Number(entry.quantity ?? 0)}×</span>` +
            `<span class="cvo-detail-who">` +
            `<span class="cvo-detail-animal">${escapeHtml(entry.animal_type)}</span>` +
            `<span class="cvo-detail-name">${escapeHtml(entry.recipient_name)}</span>` +
            `</span>` +
            `<span class="cvo-detail-date">${escapeHtml(formatEventDate(entry.event_date))}</span>` +
            `</li>`,
        )
        .join("") +
      `</ul>`
    : `<p class="cvo-detail-status">No recipients recorded for the active filters.</p>`;

  return (
    `<div class="cvo-detail">` +
    head +
    `<div class="cvo-detail-grid">` +
    `<div><p class="cvo-detail-label">Total dispersed</p><p class="cvo-detail-value">${Number(row.dispersed) || 0}</p></div>` +
    `<div><p class="cvo-detail-label">Outgoing (out)</p><p class="cvo-detail-value">${Number(row.redispersed_out) || 0}</p></div>` +
    `<div><p class="cvo-detail-label">Incoming (in)</p><p class="cvo-detail-value">${Number(row.redispersed_in) || 0}</p></div>` +
    `<div><p class="cvo-detail-label">Net</p><p class="cvo-detail-value ${net >= 0 ? "is-positive" : "is-negative"}">${net >= 0 ? "+" : ""}${net}</p></div>` +
    `</div>` +
    `<p class="cvo-detail-section">Recipients · ${animals} animal${animals === 1 ? "" : "s"}</p>` +
    list +
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
  query = {},
}) {
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const selectionPopupRef = useRef(null);
  const selectionAttachedRef = useRef(false);
  const [selected, setSelected] = useState(null); // { id, name, lngLat }
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const boundaries = useBarangayBoundaries();
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

  // The shared choropleth owns the map; this page adds the FLOW layers on
  // it exactly once, at load — they must exist before the boundary layers
  // insert themselves before "barangay-flow-casing".
  function handleMapReady(map) {
    mapRef.current = map;
    popupRef.current = new Popup({ closeButton: false, offset: 10 });
    // The click-to-open card: persistent until dismissed, with a close button
    // and the same anchor tip the hover label uses.
    selectionPopupRef.current = new Popup({
      closeButton: true,
      closeOnClick: false,
      offset: 14,
      maxWidth: "min(22rem, calc(100vw - 2rem))",
      className: "cvo-barangay-selection",
    });

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

    // The selected polygon's outline. Added after the flow layers so it sits
    // above them; the boundary fills insert below the flow casing later.
    map.addSource(SELECTION_SOURCE, { type: "geojson", data: EMPTY_COLLECTION });
    map.addLayer({
      id: SELECTION_LAYER,
      type: "line",
      source: SELECTION_SOURCE,
      layout: { "line-join": "round" },
      paint: {
        "line-color": "#0f172a",
        "line-width": 2.5,
        "line-opacity": 0.9,
      },
    });

    setMapReady(true);
  }

  /** Dismiss the card and clear its outline. */
  const clearSelection = useCallback(() => {
    setSelected(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    mapRef.current?.getSource(SELECTION_SOURCE)?.setData(EMPTY_COLLECTION);
  }, []);

  /**
   * A polygon click opens the card AT THE CLICK POINT (so the popup's pointer
   * marks the chosen barangay) and outlines the clicked shape. Clicking the
   * same barangay again closes it.
   */
  const handleBarangayClick = useCallback(
    (name, event) => {
      const feature = event?.features?.[0];
      if (!feature || !event?.lngLat) return;

      let row = feature.properties?.row;
      if (typeof row === "string") {
        try {
          row = JSON.parse(row);
        } catch {
          row = null;
        }
      }
      row ??= rows.find(
        (candidate) =>
          normalizeBarangayName(candidate.name) === normalizeBarangayName(name),
      );
      if (!row) return;

      if (selected?.id === row.barangay_id) {
        clearSelection();
        return;
      }

      setSelected({
        id: row.barangay_id,
        name: row.name,
        lngLat: [event.lngLat.lng, event.lngLat.lat],
      });
      mapRef.current?.getSource(SELECTION_SOURCE)?.setData({
        type: "Feature",
        properties: { name: row.name },
        geometry: feature.geometry,
      });
    },
    [rows, selected, clearSelection],
  );

  // Fetch the card from the SAME filtered endpoint as the table. A quick
  // second click aborts the first request; that abort is never an error.
  useEffect(() => {
    if (!selected) return undefined;

    const controller = new AbortController();
    let active = true;

    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);

    analyticsApi
      .barangayDetail(selected.id, { ...query, signal: controller.signal })
      .then((data) => {
        if (!active) return;
        setDetail(data);
        setDetailLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        if (error?.name === "AbortError" || error?.code === "ERR_CANCELED") return;
        setDetailError(getErrorMessage(error));
        setDetailLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [selected, query]);

  // Re-fill the OPEN popup as the detail arrives (setHTML instead of a new
  // popup, which would slam it shut on every update).
  useEffect(() => {
    const popup = selectionPopupRef.current;
    const map = mapRef.current;
    if (!popup || !map) return;

    if (!selected) {
      if (selectionAttachedRef.current) {
        selectionAttachedRef.current = false;
        popup.remove();
      }
      return;
    }

    const row =
      detail?.barangay && Number(detail.barangay.barangay_id) === Number(selected.id)
        ? detail.barangay
        : null;

    popup.setLngLat(selected.lngLat).setHTML(
      selectionPopupHtml({
        name: selected.name,
        row,
        recipients: row ? (detail.recipients ?? []) : [],
        loading: detailLoading || (!row && !detailError),
        error: detailError,
      }),
    );

    // Attach ONCE per open: MapLibre's addTo() removes and re-adds an open
    // popup, which emits "close" — re-attaching on every data update would
    // dismiss the card the moment its detail arrived.
    if (!selectionAttachedRef.current) {
      popup.addTo(map);
      selectionAttachedRef.current = true;
    }
  }, [selected, detail, detailLoading, detailError]);

  // The popup's × and a click on the map background dismiss the card; a click
  // on a polygon is the choropleth's selection and must NOT close it.
  useEffect(() => {
    const map = mapRef.current;
    const popup = selectionPopupRef.current;
    if (!mapReady || !map || !popup) return undefined;

    const onClose = () => {
      selectionAttachedRef.current = false;
      clearSelection();
    };
    const onMapClick = (event) => {
      if (!map.getLayer(BARANGAY_FILL_LAYER)) return;
      const hits = map.queryRenderedFeatures(event.point, {
        layers: [BARANGAY_FILL_LAYER],
      });
      if (hits.length === 0) clearSelection();
    };

    popup.on("close", onClose);
    map.on("click", onMapClick);

    return () => {
      // Off FIRST, then remove: removal emits "close", and a cleared listener
      // must never try to update an unmounted component.
      popup.off("close", onClose);
      map.off("click", onMapClick);
      selectionAttachedRef.current = false;
      popup.remove();
    };
  }, [mapReady, clearSelection]);

  // Register the arrow sprite once the style can take an image.
  useEffect(() => {
    if (!mapReady) return;

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
  }, [mapReady]);

  // The bubble fallback: added UNDER the flow lines when the boundary asset
  // is missing, with its own hover tooltip.
  useEffect(() => {
    if (!mapReady || withBoundaries) return;
    const map = mapRef.current;
    if (!map) return;

    if (!map.getSource(BUBBLE_SOURCE)) {
      const insertBefore = map.getLayer("barangay-flow-casing")
        ? "barangay-flow-casing"
        : undefined;
      map.addSource(BUBBLE_SOURCE, { type: "geojson", data: bubbleData.collection });
      map.addLayer(
        {
          id: BUBBLE_LAYER,
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
        insertBefore,
      );
    } else {
      map.getSource(BUBBLE_SOURCE).setData(bubbleData.collection);
    }
  }, [mapReady, withBoundaries, bubbleData]);

  // Flow lines follow the flows + the top-N control.
  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.getSource(FLOW_SOURCE)?.setData(flowData.arcs);
    mapRef.current?.getSource(ARROW_SOURCE)?.setData(flowData.arrows);
  }, [mapReady, flowData]);

  // Hover behaviour for the bubble fallback and the flow lines — the shared
  // choropleth owns the polygon hover itself.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return undefined;

    const popup = popupRef.current;
    let bubbleBound = false;
    let flowBound = false;

    const bubbleEnter = (event) => {
      map.getCanvas().style.cursor = "pointer";
      const row = event.features?.[0]?.properties?.row;
      if (!row) return;
      popup
        .setLngLat(event.features[0].geometry.coordinates)
        .setHTML(
          bubblePopupHtml(typeof row === "string" ? JSON.parse(row) : row, {
            metric,
            per1000,
            metricLabel,
            minRateAnimals,
          }),
        )
        .addTo(map);
    };

    const flowEnter = (event) => {
      map.getCanvas().style.cursor = "pointer";
      const flow = event.features?.[0];
      if (!flow) return;
      popup.setLngLat(event.lngLat).setHTML(flowPopupHtml(flow)).addTo(map);
    };

    const leave = () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    };

    // Lazy binds: the fallback layer appears only when the asset is missing,
    // and the flow layers only exist after the map load handler ran.
    const bindBubbles = () => {
      if (bubbleBound || !map.getLayer(BUBBLE_LAYER)) return;
      map.on("mousemove", BUBBLE_LAYER, bubbleEnter);
      map.on("mouseleave", BUBBLE_LAYER, leave);
      bubbleBound = true;
    };
    const bindFlows = () => {
      if (flowBound || !map.getLayer("barangay-flow-lines")) return;
      map.on("mousemove", "barangay-flow-lines", flowEnter);
      map.on("mouseleave", "barangay-flow-lines", leave);
      flowBound = true;
    };

    bindBubbles();
    bindFlows();
    map.on("sourcedata", bindBubbles);
    map.on("sourcedata", bindFlows);

    return () => {
      try {
        map.off("sourcedata", bindBubbles);
        map.off("sourcedata", bindFlows);
        if (bubbleBound) {
          map.off("mousemove", BUBBLE_LAYER, bubbleEnter);
          map.off("mouseleave", BUBBLE_LAYER, leave);
        }
        if (flowBound) {
          map.off("mousemove", "barangay-flow-lines", flowEnter);
          map.off("mouseleave", "barangay-flow-lines", leave);
        }
      } catch {
        // Map already removed — nothing left to unbind.
      }
      popup.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebinds with the tooltip wording
  }, [mapReady, withBoundaries, metric, per1000, metricLabel, minRateAnimals]);

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
    <BarangayChoropleth
      boundaries={boundaries}
      choropleth={choropleth}
      onMapReady={handleMapReady}
      onBarangayClick={handleBarangayClick}
      beforeLayerId="barangay-flow-casing"
      // A flow-line click belongs to the line's tooltip, not the barangay
      // polygon underneath (MapLibre layer events are not occlusion-aware).
      clickThroughLayers={["barangay-flow-lines"]}
      ariaLabel={`Map of Bayawan City's barangays coloured by ${metricLabel}. The barangay table below carries the same numbers.`}
      legend={{
        stops: legend.stops,
        minLabel: legend.minLabel,
        maxLabel: legend.maxLabel,
      }}
      legendNotes={
        <>
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
        </>
      }
      tooltipHtml={(properties) => {
        const row = properties?.row;
        const parsed = typeof row === "string" ? JSON.parse(row) : row;
        return barangayTooltipHtml(parsed, properties?.name, {
          metric,
          per1000,
          metricLabel,
          minRateAnimals,
        });
      }}
    />
  );
}

export default BarangayFlowMap;
