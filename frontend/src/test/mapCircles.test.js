import { describe, expect, it } from "vitest";
import {
  buildCircleFeatures,
  circleClusterLayerSpecs,
  circleLayerSpecs,
  circlePaintForMode,
  circleRadius,
  circleSizeSamples,
  circleSourceOptions,
  intensityColor,
  isCircleMode,
  CIRCLE_CLUSTER,
  CIRCLE_CLUSTER_LAYER,
  CIRCLE_GLOW_LAYER,
  CIRCLE_LAYER_IDS,
  CIRCLE_MAIN_LAYER,
  CIRCLE_MODES,
  CIRCLE_PALETTE,
  INTENSITY_STOPS,
} from "../lib/mapCircles";

/**
 * The circle marker rules are pure, so they are pinned here without a GL
 * context: the sqrt-area scale, the stable ids, the zero-value fallback and
 * the legend samples. The map component only paints what this returns.
 */

/** A small square polygon around a corner of Bayawan, as GeoJSON. */
function square(name, west, south) {
  return {
    type: "Feature",
    id: 0,
    properties: { name, value: 0 },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [west + 0.02, south],
          [west + 0.02, south + 0.02],
          [west, south + 0.02],
          [west, south],
        ],
      ],
    },
  };
}

function choropleth(features, max) {
  return { max, collection: { type: "FeatureCollection", features } };
}

describe("circleRadius", () => {
  it("scales by area, not radius, and clamps at the documented range", () => {
    expect(circleRadius(0, 100)).toBe(7);
    expect(circleRadius(null, 100)).toBe(7);
    expect(circleRadius(100, 100)).toBe(21);
    // A quarter of the peak gets half the growth (sqrt), not a quarter of it.
    expect(circleRadius(25, 100)).toBe(14);
    // Never exceeds the maximum, even if the value does.
    expect(circleRadius(500, 100)).toBe(21);
    // A dataset with no maximum cannot rank anything: minimum only.
    expect(circleRadius(10, 0)).toBe(7);
  });
});

describe("buildCircleFeatures", () => {
  const features = [
    { ...square("Dawis", 122.8, 9.6), id: 0 },
    { ...square("Tabuan", 122.85, 9.65), id: 1 },
  ];

  it("places one circle per polygon at an interior point, keeping stable ids", () => {
    const data = buildCircleFeatures(
      choropleth(
        features.map((feature, index) => ({
          ...feature,
          properties: { ...feature.properties, value: index === 0 ? 40 : 10 },
        })),
        40,
      ),
    );

    expect(data.features).toHaveLength(2);
    expect(data.features.map((feature) => feature.id)).toEqual([0, 1]);

    const [dawis, tabuan] = data.features;
    // The point is inside the polygon's bounding box, not its raw centroid.
    expect(dawis.geometry.coordinates[0]).toBeCloseTo(122.81, 2);
    expect(dawis.geometry.coordinates[1]).toBeCloseTo(9.61, 2);
    expect(dawis.properties.r).toBeGreaterThan(tabuan.properties.r);
  });

  it("keeps a covered barangay with no value as a small grey circle", () => {
    const data = buildCircleFeatures(
      choropleth([{ ...features[0], properties: { name: "Dawis", value: 0 } }], 10),
    );

    expect(data.features).toHaveLength(1);
    expect(data.features[0].properties.r).toBe(7);
    expect(data.features[0].properties.color).toBe(CIRCLE_PALETTE.muted);
  });

  it("can skip zero-value circles for maps where the pins are the content", () => {
    const data = buildCircleFeatures(
      choropleth(
        [
          { ...features[0], properties: { name: "Dawis", value: 8 } },
          { ...features[1], properties: { name: "Tabuan", value: 0 } },
        ],
        8,
      ),
      { includeZero: false },
    );

    expect(data.features).toHaveLength(1);
    expect(data.features[0].properties.name).toBe("Dawis");
  });

  it("returns null when there is nothing to paint", () => {
    expect(buildCircleFeatures(null)).toBeNull();
    expect(buildCircleFeatures({ max: 0, collection: { features: [] } })).toBeNull();
  });
});

describe("circleSizeSamples", () => {
  it("offers the peak, half and a quarter, in that order", () => {
    const samples = circleSizeSamples(80);
    expect(samples.map((sample) => sample.value)).toEqual([80, 40, 20]);
    expect(samples[0].size).toBeGreaterThan(samples[1].size);
    expect(circleSizeSamples(0)).toEqual([]);
  });
});

describe("hotspot intensity and display modes", () => {
  const point = (value, max) =>
    choropleth(
      [{ ...square("Dawis", 122.8, 9.6), properties: { name: "Dawis", value } }],
      max,
    );

  it("buckets a value into the red → green relative-load ramp", () => {
    expect(intensityColor(100, 100)).toBe(INTENSITY_STOPS[0].color);
    expect(intensityColor(60, 100)).toBe(INTENSITY_STOPS[1].color);
    expect(intensityColor(40, 100)).toBe(INTENSITY_STOPS[2].color);
    expect(intensityColor(10, 100)).toBe(INTENSITY_STOPS[3].color);
    // Nothing recorded is not "low load" — it stays grey.
    expect(intensityColor(0, 100)).toBe(CIRCLE_PALETTE.muted);
    expect(intensityColor(5, 0)).toBe(CIRCLE_PALETTE.muted);
  });

  it("uses the ramp only on the page that opts in", () => {
    const hot = buildCircleFeatures(point(100, 100), { intensity: true });
    expect(hot.features[0].properties.color).toBe(INTENSITY_STOPS[0].color);

    const branded = buildCircleFeatures(point(100, 100));
    expect(branded.features[0].properties.color).toBe(CIRCLE_PALETTE.fill);
  });

  it("offers exactly the three display modes and guards unknown values", () => {
    expect(CIRCLE_MODES.map((mode) => mode.id)).toEqual(["whole", "circles", "glow"]);
    expect(isCircleMode("glow")).toBe(true);
    expect(isCircleMode("whole")).toBe(true);
    expect(isCircleMode("neon")).toBe(false);
    expect(isCircleMode(undefined)).toBe(false);
  });

  it("trades glow and growth for exact sizes in circles mode", () => {
    const whole = circlePaintForMode("whole");
    const circles = circlePaintForMode("circles");
    const glow = circlePaintForMode("glow");

    // Resting glow opacity is the first operand of the opacity sum.
    expect(circles[CIRCLE_GLOW_LAYER]["circle-opacity"][1]).toBe(0);
    expect(glow[CIRCLE_GLOW_LAYER]["circle-opacity"][1]).toBeGreaterThan(
      whole[CIRCLE_GLOW_LAYER]["circle-opacity"][1],
    );

    // Marker growth at the pulse peak: none / 10% / 30%.
    const growth = (paint) => paint[CIRCLE_MAIN_LAYER]["circle-radius"][1][2][2][2];
    expect(growth(circles)).toBe(0);
    expect(growth(whole)).toBe(0.1);
    expect(growth(glow)).toBe(0.3);

    // Every mode still fades its properties instead of snapping.
    for (const paint of [whole, circles, glow]) {
      expect(paint[CIRCLE_MAIN_LAYER]["circle-radius-transition"]).toEqual({
        duration: 320,
        delay: 0,
      });
      expect(paint[CIRCLE_MAIN_LAYER]["circle-color"][0]).toBe("case");
    }
  });
});

describe("circle clustering", () => {
  it("configures the source to group overlapping barangays and sum their values", () => {
    const options = circleSourceOptions(true);
    expect(options).toMatchObject({
      cluster: true,
      clusterRadius: CIRCLE_CLUSTER.radius,
      clusterMaxZoom: CIRCLE_CLUSTER.maxZoom,
      clusterMinPoints: CIRCLE_CLUSTER.minPoints,
    });
    expect(options.clusterProperties.total).toEqual(["+", ["get", "value"]]);
    // A page can opt out entirely.
    expect(circleSourceOptions(false)).toEqual({});
  });

  it("keeps the per-barangay layers off cluster features", () => {
    const point = circleLayerSpecs();
    expect(point.map((layer) => layer.id)).toContain(CIRCLE_MAIN_LAYER);
    for (const layer of point) {
      expect(layer.filter).toEqual(["!", ["has", "point_count"]]);
    }
  });

  it("sizes the cluster bubble by grouped barangay count", () => {
    const [glow, cluster] = circleClusterLayerSpecs();
    expect(cluster.id).toBe(CIRCLE_CLUSTER_LAYER);
    expect(cluster.filter).toEqual(["has", "point_count"]);
    expect(cluster.paint["circle-radius"][0]).toBe("step");
    expect(glow.filter).toEqual(["has", "point_count"]);
    // Polygons must stand down over clusters too, not just single markers.
    expect(CIRCLE_LAYER_IDS).toContain(CIRCLE_CLUSTER_LAYER);
  });
});
