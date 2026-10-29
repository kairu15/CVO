import { bearingDegrees } from "./flightPath";

/**
 * Curved flow lines for the barangay flow map.
 *
 * A flow is a barangay → barangay handover count. Its geometry is a quadratic
 * bezier arc between the two barangay centroids — bowed perpendicular to the
 * straight line, so A→B and B→A stay legible as two separate curves instead of
 * one overlapping line. Pure geometry, unit-testable, no map library here:
 * the output is plain GeoJSON the map layers consume.
 */

/** How many points approximate one arc. */
export const ARC_SEGMENTS = 36;

/**
 * @param {Array<{origin_barangay_id: number|null, destination_barangay_id: number, count: number, origin_name: string, destination_name: string, within_barangay: boolean}>} flows
 * @param {Map<number, {latitude: number, longitude: number}>} pointsById  barangay centroid per id
 * @param {number} topN  How many of the largest flows to draw (within-barangay
 *   pairs never become lines — they are the matrix's diagonal).
 * @returns {{arcs: object, arrows: object}} GeoJSON FeatureCollections:
 *   `arcs` are LineStrings carrying count/bearing for the line + arrow layers.
 */
export function flowArcFeatures(flows, pointsById, topN = 10) {
  const drawable = (flows ?? [])
    .filter(
      (flow) =>
        !flow.within_barangay &&
        flow.origin_barangay_id !== null &&
        pointsById.has(flow.origin_barangay_id) &&
        pointsById.has(flow.destination_barangay_id),
    )
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(0, topN));

  const arcs = drawable.map((flow) => {
    const from = pointsById.get(flow.origin_barangay_id);
    const to = pointsById.get(flow.destination_barangay_id);
    const coordinates = arcPoints(from, to, ARC_SEGMENTS);
    const middle = coordinates[Math.floor(coordinates.length / 2)];

    return {
      type: "Feature",
      properties: {
        origin_barangay_id: flow.origin_barangay_id,
        destination_barangay_id: flow.destination_barangay_id,
        origin_name: flow.origin_name,
        destination_name: flow.destination_name,
        count: flow.count,
        // sqrt scale: width ∝ sqrt(count), so 9 animals is 3× the line of 1.
        width: Math.sqrt(flow.count),
        bearing: bearingDegrees(from, to),
      },
      geometry: { type: "LineString", coordinates },
    };
  });

  // One arrow head per arc, at the midpoint, rotated along the flow.
  const arrows = arcs
    .filter((arc) => arc.geometry.coordinates.length > 2)
    .map((arc) => {
      const middle = arc.geometry.coordinates[Math.floor(arc.geometry.coordinates.length / 2)];

      return {
        type: "Feature",
        properties: {
          count: arc.properties.count,
          origin_name: arc.properties.origin_name,
          destination_name: arc.properties.destination_name,
          bearing: arc.properties.bearing,
        },
        geometry: { type: "Point", coordinates: middle },
      };
    });

  return {
    arcs: { type: "FeatureCollection", features: arcs },
    arrows: { type: "FeatureCollection", features: arrows },
  };
}

/**
 * Points along a quadratic bezier from `from` to `to`, bowed sideways by a
 * fixed share of the distance so the bow stays visible at city scale.
 *
 * @returns {Array<[number, number]>} [lng, lat] pairs.
 */
export function arcPoints(from, to, segments = ARC_SEGMENTS) {
  const [x0, y0] = [from.longitude, from.latitude];
  const [x1, y1] = [to.longitude, to.latitude];

  // Perpendicular of the straight line, normalised, scaled by the distance.
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy) || 1;
  const bow = length * 0.18;
  const cx = (x0 + x1) / 2 - (dy / length) * bow;
  const cy = (y0 + y1) / 2 + (dx / length) * bow;

  const points = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    points.push([
      u * u * x0 + 2 * u * t * cx + t * t * x1,
      u * u * y0 + 2 * u * t * cy + t * t * y1,
    ]);
  }

  return points;
}
