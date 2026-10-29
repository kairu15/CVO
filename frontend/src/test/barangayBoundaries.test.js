import { describe, expect, it } from "vitest";
import {
  BOUNDARY_URL,
  NO_DATA_COLOR,
  NO_ROW_COLOR,
  boundaryBounds,
  bubbleColor,
  bubbleRadius,
  buildChoropleth,
  formatMetricReadout,
  lightenColor,
  metricValue,
  normalizeBarangayName,
} from "../lib/barangayBoundaries";

/**
 * The choropleth's data side: the name join (database rows ↔ boundary asset),
 * the hover lift, and the per-feature colours. Pure functions — no GL context.
 */

const polygon = (name, extra = {}) => ({
  type: "Feature",
  properties: { name, psgc: "PH0704606XXX", ...extra },
  geometry: { type: "Polygon", coordinates: [[[122.7, 9.4], [122.8, 9.4], [122.8, 9.5], [122.7, 9.4]]] },
});

const row = (name, extra = {}) => ({
  barangay_id: 1,
  name,
  latitude: 9.45,
  longitude: 122.75,
  dispersed: 0,
  redispersed_out: 0,
  redispersed_in: 0,
  within_barangay: 0,
  net_flow: 0,
  redispersal_rate: null,
  rate_eligible: false,
  ...extra,
});

describe("normalizeBarangayName", () => {
  it("unifies the dataset's (Pob.) abbreviation with the database's (Poblacion)", () => {
    expect(normalizeBarangayName("Suba (Pob.)")).toBe(normalizeBarangayName("Suba (Poblacion)"));
  });

  it("is case- and whitespace-insensitive", () => {
    expect(normalizeBarangayName("  tayawan ")).toBe(normalizeBarangayName("Tayawan"));
  });

  it("strips diacritics", () => {
    expect(normalizeBarangayName("San José")).toBe(normalizeBarangayName("San Jose"));
  });
});

describe("lightenColor", () => {
  it("lifts a colour toward white", () => {
    const lifted = lightenColor("#33691e");
    expect(lifted).not.toBe("#33691e");

    // Every channel moves toward 255, never past it.
    for (const [at, original] of [[1, 0x33], [3, 0x69], [5, 0x1e]]) {
      const channel = parseInt(lifted.slice(at, at + 2), 16);
      expect(channel).toBeGreaterThan(original);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });

  it("expands three-digit hex", () => {
    expect(lightenColor("#000")).toBe(lightenColor("#000000"));
  });

  it("never returns anything but hex", () => {
    expect(lightenColor("#eaf3dd")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("buildChoropleth", () => {
  it("joins polygons to rows by normalized name, database name winning", () => {
    const { collection } = buildChoropleth(
      { features: [polygon("Suba (Pob.)")] },
      [row("Suba (Poblacion)", { dispersed: 40 })],
      { metric: "dispersed" },
    );

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.name).toBe("Suba (Poblacion)");
  });

  it("colours by the metric's scale and lifts on hover", () => {
    const { collection, max } = buildChoropleth(
      { features: [polygon("Tayawan"), polygon("Nangka")] },
      [row("Tayawan", { dispersed: 40 }), row("Nangka", { dispersed: 10 })],
      { metric: "dispersed" },
    );

    expect(max).toBe(40);

    const [tayawan, nangka] = collection.features.map((f) => f.properties);
    expect(tayawan.color).toBe(bubbleColor(40, 40, "dispersed"));
    expect(nangka.color).toBe(bubbleColor(10, 40, "dispersed"));
    // More dispersed = darker green: a higher step on the same scale.
    expect(tayawan.color).not.toBe(nangka.color);

    for (const paint of [tayawan, nangka]) {
      expect(paint.hoverColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(paint.hoverColor).not.toBe(paint.color);
    }
  });

  it("greys a polygon whose barangay has no row, keeping its dataset name", () => {
    const { collection } = buildChoropleth(
      { features: [polygon("Pagatban")] },
      [row("Tayawan", { dispersed: 3 })],
      { metric: "dispersed" },
    );

    const paint = collection.features[0].properties;
    expect(paint.color).toBe(NO_ROW_COLOR);
    expect(paint.name).toBe("Pagatban");
    expect(paint.row).toBeNull();
  });

  it("greys a ranked-out rate instead of colouring it", () => {
    const { collection } = buildChoropleth(
      { features: [polygon("Nangka")] },
      [row("Nangka", { dispersed: 0, redispersal_rate: null })],
      { metric: "redispersal_rate" },
    );

    expect(collection.features[0].properties.color).toBe(NO_DATA_COLOR);
  });

  it("ignores rows without a polygon — the CVO source is not a place", () => {
    const { collection } = buildChoropleth(
      { features: [polygon("Tayawan")] },
      [row("Tayawan", { dispersed: 2 }), row("CVO", { dispersed: 5 })],
      { metric: "dispersed" },
    );

    expect(collection.features).toHaveLength(1);
  });

  it("computes the scale maximum across ALL rows, matched or not", () => {
    const { max } = buildChoropleth(
      { features: [polygon("Tayawan")] },
      [row("Tayawan", { dispersed: 2 }), row("CVO", { dispersed: 90 })],
      { metric: "dispersed" },
    );

    expect(max).toBe(90);
  });

  it("honours the per-1,000 switch", () => {
    const per1000 = buildChoropleth(
      { features: [polygon("Tayawan")] },
      [row("Tayawan", { dispersed: 40 })], // no per-1000 field → null → 0
      { metric: "dispersed", per1000: true },
    );

    const plain = buildChoropleth({ features: [polygon("Tayawan")] }, [row("Tayawan", { dispersed: 40 })], { metric: "dispersed" });

    expect(metricValue(row("Tayawan", { dispersed_per_1000: 7.5 }), "dispersed", true)).toBe(7.5);
    expect(per1000.collection.features[0].properties.value).toBe(0);
    expect(plain.collection.features[0].properties.value).toBe(40);
  });

  it("returns null without a usable collection", () => {
    expect(buildChoropleth(null, [row("Tayawan")], { metric: "dispersed" })).toBeNull();
    expect(buildChoropleth({ features: [] }, [row("Tayawan")], { metric: "dispersed" })).toBeNull();
  });
});

describe("boundaryBounds", () => {
  it("returns the city's [west, south, east, north] across every ring", () => {
    const bounds = boundaryBounds({
      features: [
        polygon("A"),
        {
          type: "Feature",
          properties: { name: "B" },
          geometry: {
            type: "MultiPolygon",
            coordinates: [[[[123.0, 9.6], [123.1, 9.6], [123.1, 9.7], [123.0, 9.6]]]],
          },
        },
      ],
    });

    expect(bounds).toEqual([122.7, 9.4, 123.1, 9.7]);
  });

  it("returns null without a usable collection", () => {
    expect(boundaryBounds(null)).toBeNull();
  });
});

describe("formatMetricReadout", () => {
  it("spells the rate the way the table spells it", () => {
    expect(formatMetricReadout(row("Tayawan", { redispersal_rate: 0.25 }), "redispersal_rate", false, 5)).toBe("25.0%");
    expect(formatMetricReadout(row("Tayawan", { redispersal_rate: null }), "redispersal_rate", false, 5)).toBe("Not ranked (n < 5)");
  });

  it("falls back to plain counts elsewhere", () => {
    expect(formatMetricReadout(row("Tayawan", { dispersed: 12 }), "dispersed", false, 5)).toBe("12");
  });
});

describe("bubbleRadius", () => {
  it("grows with the square root so AREA carries the volume", () => {
    expect(bubbleRadius(16, 16)).toBeCloseTo(4.4, 5);
    expect(bubbleRadius(4, 16)).toBeCloseTo(2.4, 5);
    expect(bubbleRadius(null, 16)).toBe(0.4);
  });
});

describe("asset URL", () => {
  it("serves the boundaries from the public directory", () => {
    expect(BOUNDARY_URL).toContain("geojson/bayawan-city-barangays.geojson");
  });
});
