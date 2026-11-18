import { describe, expect, it } from "vitest";
import { buildFlowFeatures, buildFlowLabelFeatures } from "../lib/mapFlows";

describe("map flow features", () => {
  const flow = {
    from_barangay_id: 1,
    from_name: "Dawis",
    from_latitude: 9.5,
    from_longitude: 122.8,
    to_barangay_id: 2,
    to_name: "Tabuan",
    to_latitude: 9.6,
    to_longitude: 122.9,
    total: 3,
  };

  it("draws one directional line with a readable from → to label", () => {
    const [feature] = buildFlowFeatures([flow]);

    expect(feature.geometry.coordinates).toEqual([
      [122.8, 9.5],
      [122.9, 9.6],
    ]);
    expect(feature.properties.label).toBe("Dawis → Tabuan · 3");
  });

  it("puts the label on the midpoint and skips CVO legs with no centre", () => {
    const [label] = buildFlowLabelFeatures([flow]);
    expect(label.geometry.coordinates[0]).toBeCloseTo(122.85);
    expect(label.geometry.coordinates[1]).toBeCloseTo(9.55);

    expect(
      buildFlowFeatures([
        {
          ...flow,
          from_barangay_id: null,
          from_name: null,
          from_latitude: null,
          from_longitude: null,
        },
      ]),
    ).toEqual([]);
  });
});
