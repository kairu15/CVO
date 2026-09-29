/**
 * Display positions for dispersal-map markers.
 *
 * Excel-imported households are pinned at their BARANGAY CENTRE — that is all
 * the sheet says — so dozens of markers can carry the exact same coordinate
 * and stack into a single dot. The map then reads as "the program has a
 * handful of farmers" even though the monitoring table lists hundreds.
 *
 * This spreads each coincident group over a small ring, deterministically, so
 * every household is visible and clickable. It is purely presentational: the
 * stored latitude/longitude still means "this barangay", and nothing is
 * written back. A ring radius of a few hundred metres is deliberately small
 * relative to a barangay — the cluster still clearly sits where the barangay
 * is, and the popup/table always show the authoritative address.
 */

/** Ring radius in degrees, grown with the group so dense barangays stay readable. */
function radiusFor(count) {
  return 0.0018 + Math.min(count, 40) * 0.00012;
}

/** Group key rounded well below the centroid rounding (~11 m) so only true duplicates group. */
function keyFor(row) {
  return `${Number(row.longitude).toFixed(5)},${Number(row.latitude).toFixed(5)}`;
}

/**
 * @param {Array<{id: number|string, latitude: number, longitude: number}>} rows
 * @returns {Map<string, [number, number]>} marker id → [lng, lat] to draw at
 */
export function spreadPositions(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = keyFor(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const positions = new Map();

  for (const group of groups.values()) {
    const [lng, lat] = [Number(group[0].longitude), Number(group[0].latitude)];

    if (group.length === 1) {
      positions.set(String(group[0].id), [lng, lat]);
      continue;
    }

    const radius = radiusFor(group.length);

    group.forEach((row, index) => {
      const angle = (2 * Math.PI * index) / group.length;
      positions.set(String(row.id), [
        lng + radius * Math.cos(angle),
        lat + radius * Math.sin(angle),
      ]);
    });
  }

  return positions;
}
