import { describe, expect, it } from "vitest";
import { spreadPositions } from "../lib/mapPositions";

/**
 * Excel-imported households all carry their barangay's centre coordinate, so
 * without spreading they stack into one dot and the map looks like the program
 * has a handful of farmers.
 */
describe("spreadPositions", () => {
  it("leaves a lone household exactly on its stored coordinate", () => {
    const positions = spreadPositions([
      { id: 1, latitude: 9.4103525, longitude: 122.7266917 },
    ]);

    expect(positions.get("1")).toEqual([122.7266917, 9.4103525]);
  });

  it("leaves households in different barangays untouched", () => {
    const positions = spreadPositions([
      { id: 1, latitude: 9.4, longitude: 122.7 },
      { id: 2, latitude: 9.6, longitude: 122.9 },
    ]);

    expect(positions.get("1")).toEqual([122.7, 9.4]);
    expect(positions.get("2")).toEqual([122.9, 9.6]);
  });

  it("gives every household sharing a coordinate its own spot", () => {
    const rows = Array.from({ length: 27 }, (_, index) => ({
      id: index + 1,
      latitude: 9.4103525,
      longitude: 122.7266917,
    }));

    const positions = spreadPositions(rows);
    const unique = new Set(positions.values().map(([lng, lat]) => `${lng},${lat}`));

    expect(positions.size).toBe(27);
    // No two markers land on the same spot any more.
    expect(unique.size).toBe(27);
  });

  it("keeps the spread close to the barangay rather than scattering it", () => {
    const rows = Array.from({ length: 27 }, (_, index) => ({
      id: index + 1,
      latitude: 9.4103525,
      longitude: 122.7266917,
    }));

    for (const [lng, lat] of spreadPositions(rows).values()) {
      // Within ~700 m of the barangay centre — the cluster still clearly sits
      // where the barangay is.
      expect(Math.abs(lng - 122.7266917)).toBeLessThan(0.008);
      expect(Math.abs(lat - 9.4103525)).toBeLessThan(0.008);
    }
  });

  it("is deterministic, so a refetch never shuffles the pins", () => {
    const rows = [
      { id: 5, latitude: 9.4, longitude: 122.7 },
      { id: 6, latitude: 9.4, longitude: 122.7 },
      { id: 7, latitude: 9.4, longitude: 122.7 },
    ];

    expect([...spreadPositions(rows)]).toEqual([...spreadPositions(rows)]);
  });
});
