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

import { parseFeatureRow } from "./mapText";

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

/**
 * The choropleth's dark hover label: the barangay name and its pin count.
 * Shared by every pins-on-polygons page, so the label cannot drift between
 * the Dispersal Map and the Overview.
 */
export function choroplethTooltipHtml(properties) {
  const parsed = parseFeatureRow(properties?.row);

  const name = parsed?.name ?? properties?.name ?? "";
  const count = parsed?.pins ?? 0;
  const escaped = String(name).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);

  return (
    `<div style="min-width:140px">` +
    `<p style="margin:0;font-weight:600;color:#f8fafc">${escaped}</p>` +
    `<p style="margin:2px 0 0;font-size:12px;color:#cbd5e1">Pins: <strong>${count}</strong></p>` +
    `</div>`
  );
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
 * Each feature also gets a STABLE numeric id (its index in the static asset).
 * The map's feature-state highlight keys on it, so a selection survives a
 * fresh snapshot — ids from the asset's order never reshuffle — and a
 * barangay picked in the "Find a barangay" control can be highlighted
 * without querying rendered features.
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

  const features = collection.features.map((feature, index) => {
    const name = feature.properties?.name ?? "";
    const row = rowByName.get(normalizeBarangayName(name)) ?? null;
    const value = row ? metricValue(row, metric, per1000) : null;
    const color = row ? bubbleColor(value, max, metric) : NO_ROW_COLOR;

    return {
      ...feature,
      id: index,
      properties: {
        name: row?.name ?? name,
        psgc: feature.properties?.psgc ?? null,
        color,
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

/**
 * The barangay whose polygon contains a point, by its asset name — for
 * placing a landmark (the CVO office pin) inside the city's boundaries.
 * Point-in-ring tests on the static asset, so it is exact to the asset's
 * simplification, and never needs the rendered map.
 *
 * @param {object|null} collection the boundary FeatureCollection
 * @param {number} lng longitude
 * @param {number} lat latitude
 * @returns {string|null} the containing barangay's name, or null outside
 */
export function barangayAtPoint(collection, lng, lat) {
  if (!collection || !Array.isArray(collection.features)) return null;
  for (const feature of collection.features) {
    const geometry = feature.geometry;
    const polygons =
      geometry?.type === "Polygon"
        ? [geometry.coordinates]
        : geometry?.type === "MultiPolygon"
          ? geometry.coordinates
          : [];
    if (polygons.some((polygon) => polygonContains(polygon, lng, lat))) {
      return feature.properties?.name ?? null;
    }
  }
  return null;
}

/* ---------------------------------------------------------------------- */
/*  Interior label points                                                 */
/* ---------------------------------------------------------------------- */
/**
 * The point inside a polygon furthest from every edge — the "visual centre"
 * a map label belongs on. A plain centroid of a concave coastal barangay can
 * fall OUTSIDE the polygon (into the sea or a neighbour); this search never
 * does: it walks a quad of square cells from the bounding box inward,
 * keeping the cell whose centre is inside the polygon and furthest from all
 * rings (the classic pole-of-inaccessibility). Deterministic, ~a few
 * thousand point-in-ring tests per barangay, computed once and cached.
 */

/** Squared distance from point p to segment ab. */
function segmentDistanceSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
}

/** Squared distance from p to the CLOSEST point on a ring (its edges). */
function ringDistanceSq(ring, px, py) {
  let best = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    // `i + 1` wraps: rings may or may not repeat the first vertex, and the
    // closing edge is a real edge either way — dropping it let the search
    // drift toward that side of an unclosed ring.
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % n];
    const d = segmentDistanceSq(px, py, ax, ay, bx, by);
    if (d < best) best = d;
  }
  return best;
}

/** Even-odd ray cast: is p inside the ring? */
function ringContains(ring, px, py) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Inside the OUTER ring and outside every hole. */
function polygonContains(polygon, px, py) {
  if (!polygon.length || !ringContains(polygon[0], px, py)) return false;
  for (let h = 1; h < polygon.length; h += 1) {
    if (ringContains(polygon[h], px, py)) return false;
  }
  return true;
}

/** Distance from p to the polygon's nearest edge, in coordinate units². */
function polygonDistanceSq(polygon, px, py) {
  let best = Infinity;
  for (const ring of polygon) {
    const d = ringDistanceSq(ring, px, py);
    if (d < best) best = d;
  }
  return best;
}

/**
 * The pole of inaccessibility of one polygon (outer ring + holes), as
 * [lng, lat]. Falls back to a bbox grid point for degenerate slivers whose
 * search never finds an interior cell.
 */
function polygonLabelPoint(polygon, precision) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of polygon[0]) {
    if (lng < west) west = lng;
    if (lat < south) south = lat;
    if (lng > east) east = lng;
    if (lat > north) north = lat;
  }

  const centerX = (west + east) / 2;
  const centerY = (south + north) / 2;
  const centerInside = polygonContains(polygon, centerX, centerY);
  let bestPoint = [centerX, centerY];
  let bestDistSq = centerInside ? polygonDistanceSq(polygon, centerX, centerY) : -1;

  // Breadth-first cell refinement, most promising cell first. Cells outside
  // the polygon (d = -1) still expand: a child of an outside cell can be
  // inside, which is how concave shapes get found.
  const queue = [
    {
      x: centerX,
      y: centerY,
      h: Math.max(east - west, north - south) / 2,
      d: bestDistSq,
    },
  ];

  while (queue.length > 0) {
    // Plain breadth-first: order does not change the converged result, only
    // the early-exit would — and the precision guard below bounds the work.
    const cell = queue.shift();
    if (cell.d > bestDistSq) {
      bestDistSq = cell.d;
      bestPoint = [cell.x, cell.y];
    }
    // Stop splitting once children would be refined beyond the precision —
    // deeper cells move the label by less than we care about on a map.
    if (cell.h / 2 < precision) continue;

    const h = cell.h / 2;
    for (const [ox, oy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const childX = cell.x + ox * h;
      const childY = cell.y + oy * h;
      if (childX < west || childX > east || childY < south || childY > north) continue;
      const inside = polygonContains(polygon, childX, childY);
      queue.push({
        x: childX,
        y: childY,
        h,
        d: inside ? polygonDistanceSq(polygon, childX, childY) : -1,
      });
    }
  }

  // Degenerate sliver: the refinement never found an interior cell. Scan a
  // coarse grid so the label still lands inside the polygon.
  if (bestDistSq < 0) {
    for (let gx = 1; gx < 10; gx += 1) {
      for (let gy = 1; gy < 10; gy += 1) {
        const px = west + ((east - west) * gx) / 10;
        const py = south + ((north - south) * gy) / 10;
        if (polygonContains(polygon, px, py)) return [px, py];
      }
    }
  }

  return bestPoint;
}

const labelPointCache = new Map();

/**
 * A label position guaranteed inside the barangay: [lng, lat].
 *
 * @param {object} feature a boundary GeoJSON feature (Polygon|MultiPolygon)
 * @param {number} [precision] stop refining below this cell size (degrees)
 * @returns {[number, number]|null}
 */
export function barangayLabelPoint(feature, precision = 0.005) {
  const geometry = feature?.geometry;
  if (!geometry) return null;

  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];

  if (polygons.length === 0) return null;

  // Cache key: the geometry itself. Two fixtures can share a corner vertex
  // and a ring count; only the full shape guarantees no collision. The
  // asset is static, so the handful of kilobytes per key is fine.
  let key = null;
  try {
    key = JSON.stringify(geometry);
  } catch {
    key = null; // unserializable geometry: compute uncached
  }
  if (key && labelPointCache.has(key)) return labelPointCache.get(key);

  let best = null;
  let bestDistSq = -1;
  for (const polygon of polygons) {
    const point = polygonLabelPoint(polygon, precision);
    if (!point) continue;
    const d = polygonDistanceSq(polygon, ...point);
    if (d > bestDistSq) {
      bestDistSq = d;
      best = point;
    }
  }

  if (best && key) labelPointCache.set(key, best);
  return best;
}

/**
 * The barangay's widest span, in whole metres — the metric that decides when
 * its label fits on screen. Bayawan packs eight small poblacion barangays
 * into a couple of kilometres; labelling all of them at the city-wide zoom
 * stacks them into an unreadable pile. A map shows each label only when its
 * polygon is big enough at the current zoom (progressive disclosure), and
 * this span is the per-barangay measure of "big enough".
 *
 * @param {object} feature a boundary GeoJSON feature
 * @returns {number} the bounding box's larger side, in metres
 */
export function barangayLabelSpanMeters(feature) {
  const geometry = feature?.geometry;
  const polygons =
    geometry?.type === "Polygon"
      ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon"
        ? geometry.coordinates
        : [];

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const polygon of polygons) {
    for (const [lng, lat] of polygon[0] ?? []) {
      if (lng < west) west = lng;
      if (lat < south) south = lat;
      if (lng > east) east = lng;
      if (lat > north) north = lat;
    }
  }
  if (!Number.isFinite(west)) return 0;

  // Local metres-per-degree at the polygon's middle latitude.
  const middle = ((south + north) / 2) * (Math.PI / 180);
  const widthM = (east - west) * 111320 * Math.max(0.2, Math.cos(middle));
  const heightM = (north - south) * 110574;
  return Math.round(Math.max(widthM, heightM));
}
