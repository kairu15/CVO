/**
 * Aggregate movement flows for the selected date: one line per
 * origin → destination barangay pair, with the pair count in the label.
 *
 * Pure, so the thin map component never owns the data rules. CVO-origin and
 * return-to-CVO legs have no barangay centre to draw from; they stay in the
 * API/CSV but are excluded here rather than inventing a coordinate.
 */

export const FLOW_SOURCE = "cvo-map-flows";
export const FLOW_LABEL_SOURCE = "cvo-map-flows-labels";
export const FLOW_LAYER_IDS = ["cvo-map-flows-line", "cvo-map-flows-label"];

export function buildFlowFeatures(flows = []) {
  const features = [];

  for (const flow of flows) {
    // Null endpoints mean CVO: there is no barangay centre to draw from.
    if (
      flow.from_latitude === null ||
      flow.from_longitude === null ||
      flow.to_latitude === null ||
      flow.to_longitude === null ||
      flow.from_latitude === undefined ||
      flow.from_longitude === undefined ||
      flow.to_latitude === undefined ||
      flow.to_longitude === undefined
    ) {
      continue;
    }
    const from = [Number(flow.from_longitude), Number(flow.from_latitude)];
    const to = [Number(flow.to_longitude), Number(flow.to_latitude)];
    if (!from.every(Number.isFinite) || !to.every(Number.isFinite)) continue;
    if (from[0] === to[0] && from[1] === to[1]) continue;

    const total = Math.max(1, Number(flow.total) || 1);
    const fromName = flow.from_name || "CVO";
    const toName = flow.to_name || "CVO";
    const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];

    features.push({
      type: "Feature",
      id: `${flow.from_barangay_id ?? "cvo"}-${flow.to_barangay_id ?? "cvo"}`,
      properties: {
        from_name: fromName,
        to_name: toName,
        total,
        label: `${fromName} → ${toName} · ${total}`,
        mid_lng: mid[0],
        mid_lat: mid[1],
      },
      geometry: {
        type: "LineString",
        coordinates: [from, to],
      },
    });
  }

  return features;
}

/** Point collection for the count labels; kept separate so the line layer can
 *  keep its coordinates while labels are collision-managed. */
export function buildFlowLabelFeatures(flows = []) {
  return buildFlowFeatures(flows).map((feature) => ({
    type: "Feature",
    id: feature.id,
    properties: feature.properties,
    geometry: {
      type: "Point",
      coordinates: [feature.properties.mid_lng, feature.properties.mid_lat],
    },
  }));
}
