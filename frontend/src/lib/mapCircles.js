/**
 * Circle markers for every CVO map.
 *
 * One place decides how a barangay's value becomes a circle: the radius scale,
 * the palette, the stable feature ids and the layer ids the map binds hover,
 * click and selected-state handlers to. Pages supply a choropleth (the same
 * `{max, collection}` buildChoropleth returns), so a circle can never disagree
 * with the polygon fill it sits on — both read one row from one snapshot.
 *
 * Colours are the map chrome palette (deep teal), deliberately NOT the data
 * fills: the polygon already carries the metric as a green ramp, so the circle
 * re-states magnitude as AREA (sqrt scale) and uses the brand teal for
 * identity. A barangay with no value keeps its circle — tiny and grey — so the
 * map shows "covered but nothing recorded", never a hole.
 *
 * The public map can opt into an intensity ramp (green → amber → orange → red)
 * and two display modes: "circles" (flat proportional markers) and "glow"
 * (layered radial light with a continuous, staggered pulse). The pulse itself
 * is driven by the map component through a `pulse` feature-state; this module
 * only declares how that value paints, so the animation stays off the React
 * render path.
 *
 * Pure: no GL context, so the rules are unit-testable and the map component
 * stays a renderer.
 */

import { barangayLabelPoint } from "./barangayBoundaries";

/** GeoJSON source and layers the map creates for the circles. */
export const CIRCLE_SOURCE = "cvo-map-circles";
export const CIRCLE_GLOW_LAYER = "cvo-map-circles-glow";
export const CIRCLE_HALO_LAYER = "cvo-map-circles-halo";
export const CIRCLE_MAIN_LAYER = "cvo-map-circles-main";
export const CIRCLE_CORE_LAYER = "cvo-map-circles-core";
export const CIRCLE_CLUSTER_GLOW_LAYER = "cvo-map-circles-cluster-glow";
export const CIRCLE_CLUSTER_LAYER = "cvo-map-circles-cluster";

/** Per-barangay markers, low → high (glow behind halo behind marker). */
export const CIRCLE_POINT_LAYER_IDS = [
  CIRCLE_GLOW_LAYER,
  CIRCLE_HALO_LAYER,
  CIRCLE_MAIN_LAYER,
  CIRCLE_CORE_LAYER,
];

/** The aggregated bubble shown when several barangays overlap on screen. */
export const CIRCLE_CLUSTER_LAYER_IDS = [CIRCLE_CLUSTER_GLOW_LAYER, CIRCLE_CLUSTER_LAYER];

/** Every circle surface that owns a click (polygons stand down over these). */
export const CIRCLE_LAYER_IDS = [...CIRCLE_POINT_LAYER_IDS, ...CIRCLE_CLUSTER_LAYER_IDS];

/**
 * Clustering defaults. The radius is in screen pixels: at the city-wide fit
 * Bayawan's eight small poblacion barangays stack on top of each other, so
 * they merge into one bubble; from zoom 12 upward they separate again. The
 * number inside a cluster is the barangay COUNT (drawn as the bubble's size
 * and read out on hover — the basemap has no glyph endpoint, so the label is
 * HTML, not GL text).
 */
export const CIRCLE_CLUSTER = { radius: 46, maxZoom: 12, minPoints: 2 };

/** Circle chrome. Kept beside the layers so every page looks the same. */
export const CIRCLE_PALETTE = {
  fill: "#285F6B",
  hover: "#367D8A",
  glow: "#367D8A",
  stroke: "#FFFFFF",
  core: "#FFFFFF",
  // Slightly darker than slate-400 so a zero-value circle still reads on the
  // pale sequential fill it sits on.
  muted: "#7C8FA3",
};

/**
 * Relative-load ramp for the public map's hotspot mode. Four steps, not a
 * continuous gradient: a reader can tell buckets apart, and the colours are
 * dark enough to carry a white core and survive the pale green fill beneath.
 * Zero stays muted — "covered, nothing recorded" is not "low".
 */
export const INTENSITY_STOPS = [
  { id: "high", label: "High", color: "#B42318" },
  { id: "medium-high", label: "Medium-high", color: "#C2410C" },
  { id: "medium", label: "Medium", color: "#B7791F" },
  { id: "low", label: "Low", color: "#2F6B4F" },
];

/** Screen-pixel radius range. Small enough to read, large enough to tap. */
export const CIRCLE_RADIUS = { min: 7, max: 21, selected: 4 };

/**
 * The public map's display modes. "whole" is the app default everywhere;
 * "circles" flattens the markers (exact proportional sizes, no glow) and
 * "glow" leans into layered radial light with a continuous pulse.
 */
export const CIRCLE_MODES = [
  { id: "whole", label: "Whole", hint: "Fills, markers and labels" },
  { id: "circles", label: "Circles", hint: "Proportional markers, no glow" },
  { id: "glow", label: "Glow", hint: "Radial hotspot pulse" },
];

export const DEFAULT_CIRCLE_MODE = "whole";

/** Guard a persisted/preference value before it reaches the map. */
export function isCircleMode(mode) {
  return CIRCLE_MODES.some((entry) => entry.id === mode);
}

/**
 * Colour for a value as a share of the dataset peak: the top quartile is
 * red, then orange, amber, and green. Zero or missing stays grey.
 *
 * @param {number} value
 * @param {number} max
 * @returns {string}
 */
export function intensityColor(value, max) {
  const numeric = Number(value);
  const peak = Number(max);
  if (!Number.isFinite(numeric) || numeric <= 0) return CIRCLE_PALETTE.muted;
  if (!Number.isFinite(peak) || peak <= 0) return CIRCLE_PALETTE.muted;
  const ratio = Math.min(1, numeric / peak);
  if (ratio >= 0.75) return INTENSITY_STOPS[0].color;
  if (ratio >= 0.5) return INTENSITY_STOPS[1].color;
  if (ratio >= 0.25) return INTENSITY_STOPS[2].color;
  return INTENSITY_STOPS[3].color;
}

/**
 * Radius for a value against the dataset maximum.
 *
 * Area — not radius — is proportional to the value (radius ∝ √value), which
 * is what makes a circle chart honest: twice the radius would read as four
 * times the area. Zero and missing values still get the minimum, so every
 * covered barangay has a visible, clickable dot.
 *
 * @param {number} value
 * @param {number} max
 * @param {{min?: number, max?: number}} [range]
 * @returns {number} radius in screen pixels
 */
export function circleRadius(value, max, { min = CIRCLE_RADIUS.min, max: maxRadius = CIRCLE_RADIUS.max } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return min;
  const peak = Number(max);
  if (!Number.isFinite(peak) || peak <= 0) return min;
  const ratio = Math.min(1, numeric / peak);
  return Math.round((min + (maxRadius - min) * Math.sqrt(ratio)) * 100) / 100;
}

/**
 * Paint-ready circle features from a choropleth.
 *
 * Each circle sits at the barangay's interior label point (the same pole of
 * inaccessibility the name labels use) — never at a raw centroid, which on a
 * concave coastal barangay can fall in the sea or in a neighbour. Features
 * reuse the choropleth's stable numeric ids, so hover/selection feature-state
 * survives a fresh snapshot and a page can select by name without querying
 * rendered features.
 *
 * @param {{max: number, collection: object}|null} choropleth
 * @param {{includeZero?: boolean, color?: string, mutedColor?: string, intensity?: boolean}} [options]
 *   `intensity` swaps the flat teal for the relative-load ramp (red → green),
 *   for the public hotspot map; every other page keeps the brand teal.
 * @returns {{type: "FeatureCollection", features: Array<object>}|null}
 */
export function buildCircleFeatures(
  choropleth,
  {
    includeZero = true,
    color = CIRCLE_PALETTE.fill,
    mutedColor = CIRCLE_PALETTE.muted,
    intensity = false,
  } = {},
) {
  const features = choropleth?.collection?.features;
  if (!Array.isArray(features) || features.length === 0) return null;

  const max = Number(choropleth?.max) || 0;
  const circles = [];

  for (const feature of features) {
    const value = Number(feature?.properties?.value ?? 0);
    const numericValue = Number.isFinite(value) ? value : 0;
    if (!includeZero && numericValue <= 0) continue;

    const point = barangayLabelPoint(feature);
    if (!point) continue;

    circles.push({
      type: "Feature",
      // Choropleth ids are stable indices into the static boundary asset.
      id: feature.id,
      properties: {
        name: feature.properties?.name ?? "",
        value: numericValue,
        r: circleRadius(numericValue, max),
        color:
          numericValue > 0 && intensity
            ? intensityColor(numericValue, max)
            : numericValue > 0
              ? color
              : mutedColor,
        row: feature.properties?.row ?? null,
      },
      geometry: { type: "Point", coordinates: point },
    });
  }

  return { type: "FeatureCollection", features: circles };
}

/**
 * Sample sizes for a legend: the largest value, half and a quarter, with the
 * radius each one would get. Empty when there is nothing to rank.
 *
 * @param {number} max
 * @returns {Array<{value: number, size: number}>}
 */
export function circleSizeSamples(max) {
  const peak = Number(max);
  if (!Number.isFinite(peak) || peak <= 0) return [];

  return [peak, peak / 2, peak / 4]
    .filter((value) => value > 0)
    .map((value) => ({
      value: Math.round(value * 10) / 10,
      size: circleRadius(value, peak),
    }));
}

/**
 * Source options for the circle GeoJSON. Clustering groups overlapping
 * barangays and sums their values into `total`, so a cluster still reports
 * the combined figure instead of hiding it.
 *
 * @param {boolean} cluster
 * @returns {object} options spread into map.addSource()
 */
export function circleSourceOptions(cluster = true) {
  if (!cluster) return {};
  return {
    cluster: true,
    clusterRadius: CIRCLE_CLUSTER.radius,
    clusterMaxZoom: CIRCLE_CLUSTER.maxZoom,
    clusterMinPoints: CIRCLE_CLUSTER.minPoints,
    clusterProperties: {
      // `+` accumulates each point's value across the cluster.
      total: ["+", ["get", "value"]],
    },
  };
}

/** Mode switches fade rather than pop; the map sets these at layer creation. */
const PAINT_TRANSITION = { duration: 320, delay: 0 };

function withTransitions(paint, duration = 320) {
  const transition = { ...PAINT_TRANSITION, duration };
  return {
    ...paint,
    "circle-radius-transition": transition,
    "circle-opacity-transition": transition,
    "circle-color-transition": transition,
    "circle-stroke-width-transition": transition,
    "circle-stroke-opacity-transition": transition,
  };
}

/**
 * Paint for the four marker layers in a display mode.
 *
 * "whole" is what every admin page wears: a quiet glow, a white core and a
 * pulse only on the selected circle. "circles" turns the glow off so the
 * proportional sizes read exactly, and "glow" enlarges and brightens the
 * radial light while letting the markers grow a full 1.0 → 1.3.
 *
 * The `pulse` feature-state is 0…1 and is written by the map's animation
 * loop; the amplitude lives here so switching modes cannot change the data
 * position, only the paint.
 *
 * @param {string} mode one of CIRCLE_MODES ids
 * @returns {Object<string, object>} layer id → paint properties
 */
export function circlePaintForMode(mode = DEFAULT_CIRCLE_MODE) {
  const plain = mode === "circles";
  const glow = mode === "glow";

  const wave = ["coalesce", ["feature-state", "pulse"], 0];
  const selected = ["boolean", ["feature-state", "selected"], false];
  const hovered = ["boolean", ["feature-state", "hover"], false];

  // Marker growth at the top of the wave: a full 30% in glow mode, a gentle
  // 10% in whole view, none in circles (size must stay proportional).
  const grow = plain ? 0 : glow ? 0.3 : 0.1;

  return {
    [CIRCLE_GLOW_LAYER]: withTransitions({
      "circle-radius": [
        "+",
        ["*", ["get", "r"], glow ? 2.6 : plain ? 1.3 : 1.8],
        ["*", wave, glow ? 12 : 4],
      ],
      // The halo takes the marker's own colour, so a high-load barangay
      // glows red while a zero-value one stays a quiet grey. Admin maps pass
      // the teal through, so this is the same look they already had.
      "circle-color": ["get", "color"],
      "circle-blur": 1,
      "circle-opacity": [
        "+",
        glow ? 0.26 : plain ? 0 : 0.14,
        ["*", wave, glow ? 0.2 : 0.08],
      ],
    }),
    [CIRCLE_HALO_LAYER]: withTransitions({
      "circle-radius": ["+", ["get", "r"], glow ? 7 : 5],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": CIRCLE_PALETTE.glow,
      "circle-stroke-width": ["case", selected, 3, hovered, 1.8, 0],
      "circle-stroke-opacity": 0.95,
    }),
    [CIRCLE_MAIN_LAYER]: withTransitions({
      "circle-radius": [
        "+",
        ["*", ["get", "r"], ["+", 1, ["*", wave, grow]]],
        ["case", selected, 4, hovered, 2, 0],
      ],
      "circle-color": [
        "case",
        selected,
        CIRCLE_PALETTE.hover,
        hovered,
        CIRCLE_PALETTE.hover,
        ["get", "color"],
      ],
      "circle-opacity": 0.94,
      "circle-stroke-color": CIRCLE_PALETTE.stroke,
      "circle-stroke-width": 2,
    }),
    [CIRCLE_CORE_LAYER]: withTransitions({
      "circle-radius": plain ? 2.8 : 2.2,
      "circle-color": CIRCLE_PALETTE.core,
      "circle-opacity": 0.95,
    }),
  };
}

/**
 * The cluster bubble layers: a soft glow and the bubble itself, sized by the
 * number of barangays it groups. No feature-state here — selection belongs to
 * the individual barangay marker, and a cluster is never "selected".
 */
export function circleClusterLayerSpecs() {
  const filter = ["has", "point_count"];

  return [
    {
      id: CIRCLE_CLUSTER_GLOW_LAYER,
      type: "circle",
      source: CIRCLE_SOURCE,
      filter,
      paint: {
        "circle-radius": ["step", ["get", "point_count"], 26, 6, 32, 12, 40],
        "circle-color": CIRCLE_PALETTE.glow,
        "circle-blur": 1,
        "circle-opacity": 0.22,
      },
    },
    {
      id: CIRCLE_CLUSTER_LAYER,
      type: "circle",
      source: CIRCLE_SOURCE,
      filter,
      paint: {
        // Bubble area grows with the grouped barangay count, capped so a big
        // cluster still fits between the city's edges.
        "circle-radius": ["step", ["get", "point_count"], 14, 5, 18, 10, 23],
        "circle-color": CIRCLE_PALETTE.fill,
        "circle-opacity": 0.95,
        "circle-stroke-color": CIRCLE_PALETTE.stroke,
        "circle-stroke-width": 2.5,
      },
    },
  ];
}

/** The circle layers, data-driven from the properties above. */
export function circleLayerSpecs(mode = DEFAULT_CIRCLE_MODE) {
  // Clustered sources emit cluster features (and leaves) from the same
  // source; the per-barangay layers must ignore the aggregates.
  const unclustered = ["!", ["has", "point_count"]];
  const paint = circlePaintForMode(mode);

  return [
    {
      id: CIRCLE_GLOW_LAYER,
      type: "circle",
      source: CIRCLE_SOURCE,
      filter: unclustered,
      paint: paint[CIRCLE_GLOW_LAYER],
    },
    {
      id: CIRCLE_HALO_LAYER,
      type: "circle",
      source: CIRCLE_SOURCE,
      filter: unclustered,
      paint: paint[CIRCLE_HALO_LAYER],
    },
    {
      id: CIRCLE_MAIN_LAYER,
      type: "circle",
      source: CIRCLE_SOURCE,
      filter: unclustered,
      paint: paint[CIRCLE_MAIN_LAYER],
    },
    {
      id: CIRCLE_CORE_LAYER,
      type: "circle",
      source: CIRCLE_SOURCE,
      filter: unclustered,
      paint: paint[CIRCLE_CORE_LAYER],
    },
  ];
}
