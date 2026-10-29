/**
 * Geometry and labels behind the dispersal map's per-beneficiary "flight
 * path": the chronological trail from origin → field visits → current pin.
 *
 * Deliberately pure functions over plain point objects — the map itself
 * consumes GeoJSON, and the parts that decide direction, recency and wording
 * are worth testing without a WebGL context (jsdom cannot create one), so
 * they live here rather than inside DispersalMap.
 *
 * A point is `{ latitude, longitude, occurred_on, kind, title, subtitle }`
 * exactly as the API returns it, oldest first.
 */

/** IUGG mean Earth radius — adequate for spacing arrowheads on a city map. */
const EARTH_RADIUS_M = 6371008.8;

/** Cap on arrowheads per trail so a dense path cannot flood the map. */
export const MAX_ARROWS = 48;

/** Roughly this far apart, in metres, when a trail is long enough to space. */
export const ARROW_SPACING_M = 220;

/** GeoJSON wants [lng, lat]; the API and this app use lat/lng. */
export function toLngLat(point) {
  return [Number(point.longitude), Number(point.latitude)];
}

/**
 * A coordinate pair the map can actually draw, or null.
 *
 * The API is trusted to send numbers, but a null, an empty string or a
 * latitude/longitude that arrived as text must never become `[0, 0]` (the
 * middle of the Atlantic): `Number(null)` is 0, so each side is checked for
 * presence BEFORE coercion, and the result is range-checked afterwards.
 */
export function validCoordinate(latitude, longitude) {
  if (
    latitude === null ||
    latitude === undefined ||
    latitude === "" ||
    longitude === null ||
    longitude === undefined ||
    longitude === ""
  ) {
    return null;
  }

  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;

  return { latitude: lat, longitude: lng };
}

/**
 * Coerce and validate a trail's points before they reach MapLibre.
 *
 * Invalid points are DROPPED, never repaired or moved: the brief is explicit
 * that a position is not invented. Each drop is reported to `warn` (console by
 * default) so a malformed payload is diagnosable instead of silently short.
 *
 * @param {Array<object>} points
 * @param {(message: string) => void} [warn]
 * @returns {Array<object>} the drawable points, order preserved
 */
export function sanitizePoints(points, warn = (message) => console.warn(message)) {
  const valid = [];

  for (const point of Array.isArray(points) ? points : []) {
    const coordinate = validCoordinate(point?.latitude, point?.longitude);

    if (!coordinate) {
      warn(
        `Flight path: dropped a point with an invalid coordinate (latitude=${String(
          point?.latitude,
        )}, longitude=${String(point?.longitude)}).`,
      );
      continue;
    }

    valid.push({ ...point, ...coordinate });
  }

  return valid;
}

/**
 * Consecutive points that share one spot, so a re-dispersal within the SAME
 * location still has something to see. `buildSegments` skips zero-length pairs
 * (they would draw nothing anyway); the map uses these positions to place a
 * "same location" badge instead.
 *
 * @returns {Array<{ index: number, point: object }>} one entry per zero-length segment
 */
export function sameLocationPoints(points) {
  const repeats = [];

  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];

    if (
      Number(previous.longitude) === Number(current.longitude) &&
      Number(previous.latitude) === Number(current.latitude)
    ) {
      repeats.push({ index, point: current });
    }
  }

  return repeats;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two API points, in metres. */
export function haversineMeters(from, to) {
  const [lng1, lat1] = toLngLat(from);
  const [lng2, lat2] = toLngLat(to);
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Initial compass bearing from `from` to `to`, in degrees clockwise from
 * north — exactly what MapLibre's `icon-rotate` expects for an arrow icon
 * drawn pointing up the page.
 */
export function bearingDegrees(from, to) {
  const [lng1, lat1] = toLngLat(from);
  const [lng2, lat2] = toLngLat(to);
  const dLng = toRadians(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRadians(lat2));
  const x =
    Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
    Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * Recency of a segment: 0 is the oldest, 1 the most recent. Drives the
 * faded → saturated ramp so direction reads from colour alone, before any
 * arrowhead is even noticed.
 */
function ageOf(index, total) {
  return total <= 1 ? 1 : index / (total - 1);
}

/**
 * Consecutive point pairs as GeoJSON features — one feature per segment so
 * hovering any span can name the dates it covers (a single merged line could
 * only ever report the whole trail).
 *
 * Zero-length pairs are skipped: a duplicate coordinate would render as an
 * arrowhead frozen in place.
 */
export function buildSegments(points) {
  const features = [];

  for (let index = 0; index + 1 < points.length; index++) {
    const from = points[index];
    const to = points[index + 1];
    const coordinates = [toLngLat(from), toLngLat(to)];

    if (coordinates[0][0] === coordinates[1][0] && coordinates[0][1] === coordinates[1][1]) {
      continue;
    }

    features.push({
      type: "Feature",
      properties: {
        index,
        age: ageOf(index, points.length - 1),
        from_date: from.occurred_on ?? "",
        to_date: to.occurred_on ?? "",
        // A stop placed from a barangay centre (not the event or the owner's
        // geotag) is APPROXIMATE: the map draws that span dashed.
        approximate: Boolean(from.approximate || to.approximate),
      },
      geometry: { type: "LineString", coordinates },
    });
  }

  return { type: "FeatureCollection", features };
}

/**
 * Arrowheads spaced along the trail, each carrying the bearing of its own
 * segment so it points from origin toward the most recent point.
 *
 * Placed at the middle of evenly divided spans (never on a vertex, where two
 * arrows would collide) and capped so a pathological path stays cheap.
 */
export function buildArrows(points, spacingMeters = ARROW_SPACING_M) {
  const features = [];
  const segments = Math.max(0, points.length - 1);

  for (let index = 0; index < segments; index++) {
    const from = points[index];
    const to = points[index + 1];
    const distance = haversineMeters(from, to);
    if (distance === 0) continue;

    const spanCount = Math.max(1, Math.round(distance / spacingMeters));
    const bearing = bearingDegrees(from, to);
    const age = ageOf(index, segments);

    for (let step = 1; step <= spanCount; step++) {
      const t = (step - 0.5) / spanCount;
      features.push({
        type: "Feature",
        properties: { age, bearing, index },
        geometry: {
          type: "Point",
          coordinates: [
            Number(from.longitude) + (Number(to.longitude) - Number(from.longitude)) * t,
            Number(from.latitude) + (Number(to.latitude) - Number(from.latitude)) * t,
          ],
        },
      });

      if (features.length >= MAX_ARROWS) return { type: "FeatureCollection", features };
    }
  }

  return { type: "FeatureCollection", features };
}

/**
 * The trail's points as GeoJSON, for the clickable dots between the
 * endpoints. Properties are kept flat and scalar — GeoJSON property values
 * feed MapLibre expressions and popups directly.
 */
export function buildPointMarkers(points) {
  return {
    type: "FeatureCollection",
    features: points.map((point, index) => ({
      type: "Feature",
      properties: {
        index,
        kind: point.kind ?? "",
        title: point.title ?? "",
        subtitle: point.subtitle ?? "",
        occurred_on: point.occurred_on ?? "",
        label: formatPointDate(point.occurred_on),
      },
      geometry: { type: "Point", coordinates: toLngLat(point) },
    })),
  };
}

/**
 * `occurred_on` arrives as a date-only string ("2026-03-12"). Parsed as a
 * LOCAL date, not via `new Date(string)`: the spec treats date-only strings
 * as UTC midnight, so a machine west of UTC would render March 11.
 */
export function parseDateOnly(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Human date for a popup: "March 12, 2026", or "" when undated. */
export function formatPointDate(value) {
  const date = parseDateOnly(value);
  return date ? date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : "";
}

/** Short date for a tooltip: "Mar 12, 2026", or "" when undated. */
export function formatShortDate(value) {
  const date = parseDateOnly(value);
  return date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}

/**
 * What a hovered segment spans: "Mar 12, 2026 → Apr 2, 2026", collapsing to
 * a single date when both ends are the same day (two visits on one trip).
 */
export function dateRangeLabel(fromValue, toValue) {
  const from = formatShortDate(fromValue);
  const to = formatShortDate(toValue);

  if (!from) return to;
  if (!to || from === to) return from;
  return `${from} → ${to}`;
}
