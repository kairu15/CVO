/**
 * Barangay boundary polygons for the choropleth flow map.
 *
 * The polygons ship as a public asset (public/geojson/bayawan-city-barangays.geojson),
 * built from the UN OCHA Philippines COD-AB dataset — PSA administrative
 * geometry, CC BY-IGO — simplified to ~916 vertices so the whole city fits in
 * ~22 KB. The app's basemap is already OpenStreetMap; boundaries join to the
 * analytics rows by NORMALIZED NAME, never by coordinates, so a re-geocode of
 * a barangay centre cannot desync the fill from the table.
 *
 * Everything here is pure: the map component stays a thin renderer, and the
 * join rules are unit-testable without a GL context.
 */

/** Where the boundary asset is served from (public/, so honour the base URL). */
export const BOUNDARY_URL = `${import.meta.env.BASE_URL}geojson/bayawan-city-barangays.geojson`;

/** Fill for a covered barangay the period's filters gave no row for. */
export const NO_ROW_COLOR = "#dbe3ec";

/** Single-hue sequential scale (the brand green), light → dark. */
export const SEQUENTIAL_STOPS = ["#eaf3dd", "#c7e2a6", "#8bc34a", "#558b2f", "#33691e"];

/** Diverging scale for net flow, centered on zero: blue out, amber in. */
export const DIVERGING_STOPS = ["#075985", "#7dd3fc", "#cbd5e1", "#fdba74", "#b45309"];

/** Greyed colour for values that cannot be ranked (no data / n < minimum). */
export const NO_DATA_COLOR = "#94a3b8";

const DIACRITICS = /[\u0300-\u036f]/g;

/**
 * The boundary dataset writes "Suba (Pob.)"; the program writes "Suba
 * (Poblacion)" — and rows come from the database while polygons come from a
 * static asset, so the join must not depend on the abbreviation.
 */
export function normalizeBarangayName(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\(pob\.\)/g, "(poblacion)")
    .trim();
}

/** Blend a hex colour toward white — the choropleth's hover lift. */
export function lightenColor(hex, amount = 0.45) {
  const raw = String(hex ?? "").replace("#", "");
  const value = raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw;
  const channels = [0, 2, 4].map((at) => Number.parseInt(value.slice(at, at + 2), 16) || 0);
  const [r, g, b] = channels.map((channel) => Math.round(channel + (255 - channel) * amount));
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** The metric value a barangay shows, honouring the per-1,000 switch. */
export function metricValue(row, metric, per1000) {
  if (per1000 && metric !== "redispersal_rate") {
    return row[`${metric}_per_1000`] ?? null;
  }
  return row[metric] ?? null;
}

/** A step on the 5-stop scale for a value against its maximum. */
function scaleStep(value, max) {
  if (max <= 0) return 0;
  return Math.min(4, Math.floor((value / max) * 5));
}

/** The fill colour for one barangay. Null values render greyed ("no data"). */
export function bubbleColor(value, max, metric) {
  if (value === null || value === undefined) return NO_DATA_COLOR;

  if (metric === "net_flow") {
    if (value === 0) return DIVERGING_STOPS[2];
    const peak = Math.max(Math.abs(max), 1);
    const intensity = Math.min(2, Math.floor((Math.abs(value) / peak) * 3));
    return value < 0
      ? ["#7dd3fc", "#38bdf8", "#075985"][intensity]
      : ["#fdba74", "#fb923c", "#b45309"][intensity];
  }

  return SEQUENTIAL_STOPS[scaleStep(value, max)];
}

/** sqrt-area radius factor: area ∝ value, radius ∝ sqrt(value). */
export function bubbleRadius(value, max) {
  if (value === null || value === undefined || max <= 0) return 0.4;
  return 0.4 + 4 * Math.sqrt(Math.max(0, value) / max);
}

/** The number a tooltip reads out, spelled the way the table spells it. */
export function formatMetricReadout(row, metric, per1000, minRateAnimals) {
  const value = metricValue(row, metric, per1000);
  if (metric === "redispersal_rate") {
    if (row.redispersal_rate === null) return `Not ranked (n < ${minRateAnimals})`;
    return `${(row.redispersal_rate * 100).toFixed(1)}%`;
  }
  if (value === null || value === undefined) return "No population recorded";
  return String(value);
}

/**
 * Join boundary polygons to analytics rows and compute per-feature colours.
 *
 * Rows without a polygon (the pseudo-"CVO" source row) simply get none — its
 * flows still draw from the centre point. Polygons without a row render
 * greyed: covered barangays with no dispersals recorded in the period. The
 * max spans ALL rows so the two renderings (polygons, bubble fallback) share
 * one colour scale.
 *
 * @param {object|null} collection the boundary FeatureCollection
 * @param {Array<object>} rows analytics rows (name + metric fields)
 * @param {{metric: string, per1000?: boolean}} options
 * @returns {{max: number, collection: object}|null} paint-ready FeatureCollection
 */
export function buildChoropleth(collection, rows, { metric, per1000 = false }) {
  if (!collection || !Array.isArray(collection.features) || collection.features.length === 0) {
    return null;
  }

  const values = rows.map((row) => metricValue(row, metric, per1000));
  const max = Math.max(0, ...values.filter((value) => value !== null && !Number.isNaN(value)));

  const rowByName = new Map(rows.map((row) => [normalizeBarangayName(row.name), row]));

  const features = collection.features.map((feature) => {
    const name = feature.properties?.name ?? "";
    const row = rowByName.get(normalizeBarangayName(name)) ?? null;
    const value = row ? metricValue(row, metric, per1000) : null;
    const color = row ? bubbleColor(value, max, metric) : NO_ROW_COLOR;

    return {
      ...feature,
      properties: {
        name: row?.name ?? name,
        psgc: feature.properties?.psgc ?? null,
        color,
        hoverColor: lightenColor(color),
        value: value ?? 0,
        row,
      },
    };
  });

  return { max, collection: { type: "FeatureCollection", features } };
}

/**
 * The whole-city bounds of the boundary asset, for framing the camera once.
 * @returns {[number, number, number, number]|null} [west, south, east, north]
 */
export function boundaryBounds(collection) {
  if (!collection || !Array.isArray(collection.features) || collection.features.length === 0) {
    return null;
  }

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const feature of collection.features) {
    const rings =
      feature.geometry?.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry?.type === "MultiPolygon"
          ? feature.geometry.coordinates
          : [];

    for (const polygon of rings) {
      for (const ring of polygon) {
        for (const [lng, lat] of ring) {
          if (lng < west) west = lng;
          if (lat < south) south = lat;
          if (lng > east) east = lng;
          if (lat > north) north = lat;
        }
      }
    }
  }

  return [west, south, east, north];
}
