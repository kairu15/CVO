import { describe, expect, it } from "vitest";
import { arcPoints, flowArcFeatures } from "../lib/flowArcs";

/**
 * The flow-line geometry: arcs bow sideways (so A→B and B→A stay two
 * separate curves), within-barangay pairs never become lines, and the top-N
 * control caps what is drawn.
 */

const POINTS = new Map([
  [1, { latitude: 9.6, longitude: 123.1 }],
  [2, { latitude: 9.75, longitude: 123.3 }],
  [3, { latitude: 9.5, longitude: 123.25 }],
]);

const flow = (origin, destination, count, extra = {}) => ({
  origin_barangay_id: origin,
  destination_barangay_id: destination,
  count,
  origin_name: origin === null ? "CVO" : `B${origin}`,
  destination_name: `B${destination}`,
  within_barangay: origin === destination,
  ...extra,
});

describe("arcPoints", () => {
  it("starts at the origin, ends at the destination, and bows off the straight line", () => {
    const from = POINTS.get(1);
    const to = POINTS.get(2);
    const points = arcPoints(from, to, 36);

    expect(points).toHaveLength(37);
    expect(points[0]).toEqual([from.longitude, from.latitude]);
    expect(points[36]).toEqual([to.longitude, to.latitude]);

    // The midpoint of the arc is NOT the midpoint of the straight line —
    // that offset is the bow that keeps opposing flows legible.
    const [mx, my] = points[18];
    const straightMid = [(from.longitude + to.longitude) / 2, (from.latitude + to.latitude) / 2];
    expect(Math.hypot(mx - straightMid[0], my - straightMid[1])).toBeGreaterThan(0.001);
  });
});

describe("flowArcFeatures", () => {
  it("draws the largest flows first and caps them at topN", () => {
    const { arcs } = flowArcFeatures(
      [flow(1, 2, 4), flow(2, 3, 9), flow(3, 1, 1)],
      POINTS,
      2,
    );

    expect(arcs.features).toHaveLength(2);
    expect(arcs.features[0].properties.count).toBe(9);
    expect(arcs.features[1].properties.count).toBe(4);
    // Width rides the square root: 9 animals is 3× the line of 1.
    expect(arcs.features[0].properties.width).toBe(3);
  });

  it("never turns same-barangay re-dispersals into flow lines", () => {
    const { arcs, arrows } = flowArcFeatures([flow(1, 1, 7)], POINTS, 10);

    expect(arcs.features).toHaveLength(0);
    expect(arrows.features).toHaveLength(0);
  });

  it("carries one arrow head per arc at the midpoint, rotated along the flow", () => {
    const { arcs, arrows } = flowArcFeatures([flow(1, 2, 5)], POINTS, 10);

    expect(arrows.features).toHaveLength(arcs.features.length);
    expect(arrows.features[0].properties.bearing).toBeCloseTo(arcs.features[0].properties.bearing, 5);
    expect(arrows.features[0].geometry.coordinates).toEqual(
      arcs.features[0].geometry.coordinates[18],
    );
  });
});
