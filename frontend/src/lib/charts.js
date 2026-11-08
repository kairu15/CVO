/**
 * Shared chart tokens — the UI's own brand/earth palette from index.css, as
 * concrete values for SVG. Recharts must never fall back to its defaults: a
 * chart is part of this app, not an app embedded in it.
 *
 * Used by the Reports screen and the Admin Dashboard Overview, so both
 * surfaces draw from the same palette.
 */

export const CHART_COLORS = {
  primary: "#558b2f", // brand-700
  accent: "#8bc34a", // brand-400
  deep: "#2d4d19", // brand-900
  earth: "#a1784d", // earth-500
  sand: "#d2b48c", // earth-300
  clay: "#bb9469", // earth-400
};

/** The donut's slice palette: greens for the herd, earth tones for the rest. */
export const PIE_COLORS = [
  CHART_COLORS.primary,
  CHART_COLORS.accent,
  CHART_COLORS.earth,
  CHART_COLORS.sand,
  CHART_COLORS.deep,
  CHART_COLORS.clay,
];

export const AXIS_STYLE = { fontSize: 11, fill: "#64748b" };
