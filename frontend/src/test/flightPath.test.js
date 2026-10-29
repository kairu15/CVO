import { describe, expect, it } from "vitest";
import {
  MAX_ARROWS,
  bearingDegrees,
  buildArrows,
  buildPointMarkers,
  buildSegments,
  dateRangeLabel,
  formatPointDate,
  haversineMeters,
  parseDateOnly,
  sameLocationPoints,
  sanitizePoints,
  validCoordinate,
} from "../lib/flightPath";

/** Three trail points: origin, one visit, the current pin. */
function trail() {
  return [
    {
      kind: "origin",
      latitude: 9.3638,
      longitude: 122.8022,
      occurred_on: "2026-01-10",
      title: "Initial dispersal",
      subtitle: "Juan Dela Cruz · Poblacion",
    },
    {
      kind: "field-visit",
      latitude: 9.3738,
      longitude: 122.8122,
      occurred_on: "2026-03-12",
      title: "Field visit",
      subtitle: "Routine check",
    },
    {
      kind: "current",
      latitude: 9.3838,
      longitude: 122.8222,
      occurred_on: "2026-06-01",
      title: "Current pin",
      subtitle: "Juan Dela Cruz · Poblacion",
    },
  ];
}

describe("buildSegments", () => {
  it("pairs consecutive points in trail order, oldest first", () => {
    const { features } = buildSegments(trail());

    expect(features).toHaveLength(2);
    expect(features[0].geometry.coordinates[0]).toEqual([122.8022, 9.3638]);
    expect(features[0].geometry.coordinates[1]).toEqual([122.8122, 9.3738]);
    expect(features[0].properties.from_date).toBe("2026-01-10");
    expect(features[0].properties.to_date).toBe("2026-03-12");
    expect(features[1].properties.from_date).toBe("2026-03-12");
    expect(features[1].properties.to_date).toBe("2026-06-01");
  });

  it("ages segments from faded (oldest = 0) to solid (most recent = 1)", () => {
    const fourPoints = [trail()[0], trail()[1], trail()[2], { ...trail()[2], latitude: 9.3938 }];
    const { features } = buildSegments(fourPoints);

    expect(features.map((feature) => feature.properties.age)).toEqual([0, 0.5, 1]);
  });

  it("marks the only segment of a two-point trail as fully recent", () => {
    const { features } = buildSegments(trail().slice(0, 2));

    expect(features).toHaveLength(1);
    expect(features[0].properties.age).toBe(1);
  });

  it("drops a zero-length segment instead of freezing an arrowhead there", () => {
    const points = trail();
    points.push({ ...points[2] }); // duplicate of the last coordinate

    const { features } = buildSegments(points);

    expect(features).toHaveLength(2);
  });

  it("marks a span touching an approximate stop so the map can dash it", () => {
    const points = trail();
    points[1] = { ...points[1], approximate: true };

    const { features } = buildSegments(points);

    expect(features.map((feature) => feature.properties.approximate)).toEqual([true, true]);

    const exact = buildSegments(trail());
    expect(exact.features.map((feature) => feature.properties.approximate)).toEqual([false, false]);
  });
});

describe("buildArrows", () => {
  it("orients each arrow along its own segment", () => {
    // Due east: longitude only.
    const points = [
      { latitude: 9.36, longitude: 122.8 },
      { latitude: 9.36, longitude: 122.81 },
    ];
    const { features } = buildArrows(points, 10_000);

    expect(features).toHaveLength(1);
    expect(features[0].properties.bearing).toBeCloseTo(90, 0);
  });

  it("spaces arrows along a long segment instead of clustering them", () => {
    const points = [
      { latitude: 9.36, longitude: 122.8 },
      { latitude: 9.45, longitude: 122.8 }, // ~10 km north
    ];
    const { features } = buildArrows(points, 1_000);

    expect(features.length).toBeGreaterThan(5);
    for (const feature of features) {
      expect(feature.properties.bearing).toBeCloseTo(0, 0); // heading north
      expect(feature.geometry.coordinates[1]).toBeGreaterThan(9.36);
      expect(feature.geometry.coordinates[1]).toBeLessThan(9.45);
    }
  });

  it("caps the number of arrowheads on a path with many points", () => {
    const points = Array.from({ length: 40 }, (_, index) => ({
      latitude: 9.36 + index * 0.05, // each hop ~5 km apart
      longitude: 122.8,
    }));

    const { features } = buildArrows(points, 50);

    expect(features.length).toBeLessThanOrEqual(MAX_ARROWS);
  });

  it("skips a segment with no distance", () => {
    const same = { latitude: 9.36, longitude: 122.8 };
    const { features } = buildArrows([same, { ...same }], 100);

    expect(features).toHaveLength(0);
  });
});

describe("distance and bearing", () => {
  it("measures a segment to roughly a kilometre", () => {
    const distance = haversineMeters(
      { latitude: 9.36, longitude: 122.8 },
      { latitude: 9.37, longitude: 122.8 },
    );

    expect(distance).toBeGreaterThan(1_050);
    expect(distance).toBeLessThan(1_150);
  });

  it("reports compass bearings clockwise from north", () => {
    const origin = { latitude: 9.36, longitude: 122.8 };

    expect(bearingDegrees(origin, { latitude: 9.37, longitude: 122.8 })).toBeCloseTo(0, 0);
    expect(bearingDegrees(origin, { latitude: 9.36, longitude: 122.81 })).toBeCloseTo(90, 0);
    expect(bearingDegrees(origin, { latitude: 9.35, longitude: 122.8 })).toBeCloseTo(180, 0);
  });
});

describe("buildPointMarkers", () => {
  it("flattens each point's popup facts into scalar properties", () => {
    const { features } = buildPointMarkers(trail());

    expect(features).toHaveLength(3);
    expect(features[0].properties).toMatchObject({
      kind: "origin",
      title: "Initial dispersal",
      subtitle: "Juan Dela Cruz · Poblacion",
      occurred_on: "2026-01-10",
      label: "January 10, 2026",
    });
    expect(features[2].geometry.coordinates).toEqual([122.8222, 9.3838]);
  });
});

describe("dates", () => {
  it("parses a date-only string as a LOCAL date, never UTC-shifted", () => {
    const date = parseDateOnly("2026-03-12");

    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(12);
  });

  it("formats a point date in full", () => {
    expect(formatPointDate("2026-03-12")).toBe(
      new Date(2026, 2, 12).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    );
    expect(formatPointDate("")).toBe("");
  });

  it("labels a hovered segment's date range", () => {
    const expected = `${new Date(2026, 2, 12).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })} → ${new Date(2026, 3, 2).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;

    expect(dateRangeLabel("2026-03-12", "2026-04-02")).toBe(expected);
    // Same-day span collapses instead of repeating the date.
    expect(dateRangeLabel("2026-03-12", "2026-03-12")).toBe(
      new Date(2026, 2, 12).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    );
    // An undated start falls back to the other end.
    expect(dateRangeLabel("", "2026-04-02")).toBe(
      new Date(2026, 3, 2).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    );
  });
});

describe("flight path coordinate hygiene", () => {
  it("accepts numbers and numeric strings inside the valid ranges", () => {
    expect(validCoordinate(9.63, 123.19)).toEqual({ latitude: 9.63, longitude: 123.19 });
    expect(validCoordinate("9.06", "122.98")).toEqual({ latitude: 9.06, longitude: 122.98 });
  });

  it("rejects missing, non-numeric and out-of-range coordinates", () => {
    // `Number(null)` is 0 — a missing coordinate must never become [0, 0].
    expect(validCoordinate(null, 123.19)).toBeNull();
    expect(validCoordinate(9.63, null)).toBeNull();
    expect(validCoordinate("", "122.98")).toBeNull();
    expect(validCoordinate(undefined, undefined)).toBeNull();
    expect(validCoordinate("north", 122.98)).toBeNull();
    expect(validCoordinate(91, 122.98)).toBeNull();
    expect(validCoordinate(9.63, 181)).toBeNull();
  });

  it("drops invalid points, logs each one, and keeps the order", () => {
    const warnings = [];
    const points = sanitizePoints(
      [
        { latitude: "9.63", longitude: "123.19", title: "CVO" },
        { latitude: null, longitude: null, title: "Unplaced owner" },
        { latitude: 9.06, longitude: 122.98, title: "Bob" },
      ],
      (message) => warnings.push(message),
    );

    expect(points).toEqual([
      { latitude: 9.63, longitude: 123.19, title: "CVO" },
      { latitude: 9.06, longitude: 122.98, title: "Bob" },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/invalid coordinate/i);
  });

  it("flags consecutive points at the same spot so the move stays visible", () => {
    const points = [
      { latitude: 9.63, longitude: 123.19, title: "CVO" },
      { latitude: 9.37, longitude: 122.81, title: "Alice" },
      { latitude: 9.37, longitude: 122.81, title: "Alice again" },
      { latitude: 9.06, longitude: 122.98, title: "Bob" },
    ];

    expect(sameLocationPoints(points)).toEqual([{ index: 2, point: points[2] }]);
    expect(sameLocationPoints(points.slice(0, 2))).toEqual([]);
  });
});
