/**
 * Small pure helpers shared by every map's HTML-string output (popups,
 * tooltips, hover labels). They lived as three drifting copies across
 * DispersalMap, BarangayFlowMap and LandingMap; one definition keeps the
 * escaping rules — and therefore the safety of every interpolated value —
 * identical everywhere.
 */

/** Escape a value for safe interpolation inside a map popup's HTML. */
export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/**
 * Feature properties ride GeoJSON as strings, so a joined analytics row may
 * arrive serialized. A malformed string must not throw inside a hover or
 * click handler — parse defensively, fall back to the raw value.
 *
 * @param {object|string|null} row the row as attached to a feature
 * @returns {object|null} the parsed row, or the original object
 */
export function parseFeatureRow(row) {
  let parsed = row;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  return parsed ?? null;
}
