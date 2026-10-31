import { describe, expect, it } from "vitest";
import {
  BOUNDARY_URL,
  NO_DATA_COLOR,
  NO_ROW_COLOR,
  barangayLabelPoint,
  barangayLabelSpanMeters,
  boundaryBounds,
  bubbleColor,
  bubbleRadius,
  buildChoropleth,
  formatMetricReadout,
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

describe("barangayLabelPoint", () => {
  // Independent even-odd ray cast, so the test does not trust the code it
  // is testing to decide what "inside" means.
  const inRing = (ring, x, y) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const inPolygon = (poly, x, y) => inRing(poly[0], x, y) && !poly.slice(1).some((hole) => inRing(hole, x, y));

  it("lands inside a simple polygon", () => {
    const feature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[122.7, 9.4], [122.8, 9.4], [122.8, 9.5], [122.7, 9.5], [122.7, 9.4]]],
      },
    };
    const point = barangayLabelPoint(feature);
    expect(inPolygon(feature.geometry.coordinates, point[0], point[1])).toBe(true);
  });

  it("stays inside a CONCAVE polygon whose centroid falls outside it", () => {
    // An L-shape: the centroid of its bbox sits in the notch, outside the
    // polygon — exactly where a naive label would float over a neighbour.
    const ring = [
      [122.70, 9.40],
      [122.80, 9.40],
      [122.80, 9.44],
      [122.74, 9.44],
      [122.74, 9.50],
      [122.70, 9.50],
      [122.70, 9.40],
    ];
    const feature = { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } };
    const [cx, cy] = [122.75, 9.45];
    expect(inPolygon([ring], cx, cy)).toBe(false);

    const point = barangayLabelPoint(feature);
    expect(inPolygon([ring], point[0], point[1])).toBe(true);

    // And it is not hugging an edge: the L's widest span is ~0.021°, so the
    // visual centre lands well clear of the boundary.
    const edgeDistance = (px, py) => {
      let best = Infinity;
      for (let i = 0; i < ring.length - 1; i += 1) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[i + 1];
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSq = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        if (d < best) best = d;
      }
      return best;
    };
    expect(edgeDistance(point[0], point[1])).toBeGreaterThan(0.015);
  });

  it("picks a point in the largest part of a MultiPolygon", () => {
    const feature = {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[122.60, 9.40], [122.61, 9.40], [122.61, 9.41], [122.60, 9.41], [122.60, 9.40]]],
          [[[122.70, 9.40], [122.80, 9.40], [122.80, 9.50], [122.70, 9.50], [122.70, 9.40]]],
        ],
      },
    };
    const point = barangayLabelPoint(feature);
    expect(inPolygon(feature.geometry.coordinates[1], point[0], point[1])).toBe(true);
  });

  it("avoids a hole when one is punched into the polygon", () => {
    const outer = [[122.70, 9.40], [122.80, 9.40], [122.80, 9.50], [122.70, 9.50], [122.70, 9.40]];
    const hole = [[122.74, 9.44], [122.76, 9.44], [122.76, 9.46], [122.74, 9.46], [122.74, 9.44]];
    const feature = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [outer, hole] },
    };
    const point = barangayLabelPoint(feature);
    expect(inPolygon(feature.geometry.coordinates, point[0], point[1])).toBe(true);
  });

  it("returns null for unusable geometry", () => {
    expect(barangayLabelPoint(null)).toBeNull();
    expect(barangayLabelPoint({ type: "Feature", geometry: null })).toBeNull();
    expect(barangayLabelPoint({ type: "Feature", geometry: { type: "Point", coordinates: [122, 9] } })).toBeNull();
  });
});

describe("barangayLabelSpanMeters", () => {
  it("measures the wider side of the bounding box in metres", () => {
    // 0.1° of longitude at ~9.45° latitude ≈ 10.98 km; 0.1° of latitude
    // ≈ 11.06 km — here the taller side wins.
    const feature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[122.7, 9.4], [122.8, 9.4], [122.8, 9.5], [122.7, 9.5], [122.7, 9.4]]],
      },
    };
    expect(barangayLabelSpanMeters(feature)).toBeGreaterThan(10900);
    expect(barangayLabelSpanMeters(feature)).toBeLessThan(11200);
  });

  it("is small for the poblacion-scale strips that must declutter away", () => {
    // A 0.02° × 0.008° coastal strip ≈ 2.2 km × 0.9 km — the wider side
    // carries the label fit check.
    const feature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[122.74, 9.44], [122.76, 9.44], [122.76, 9.448], [122.74, 9.448], [122.74, 9.44]]],
      },
    };
    expect(barangayLabelSpanMeters(feature)).toBeGreaterThan(1500);
    expect(barangayLabelSpanMeters(feature)).toBeLessThan(2600);
  });

  it("is zero without usable geometry", () => {
    expect(barangayLabelSpanMeters(null)).toBe(0);
    expect(barangayLabelSpanMeters({ type: "Feature", geometry: { type: "Point", coordinates: [122, 9] } })).toBe(0);
  });
});
