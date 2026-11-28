/**
 * Shared chart tokens — the UI's own brand/earth palette from index.css, as
 * concrete values for SVG. Recharts must never fall back to its defaults: a
 * chart is part of this app, not an app embedded in it.
 *
 * Used by the Reports screen and the Admin Dashboard Overview, so both
 * surfaces draw from the same palette.
 */

export const CHART_COLORS = {
  primary: "#2d6a4f", // Evergreen — Classic Evergreen
  accent: "#4e8a6b", // Evergreen — Cedar Leaf
  deep: "#163b2a", // Evergreen — Deep Fir
  sage: "#558167", // Brunswick/Sage 500
  olive: "#6c7a3c", // Olive 600 (agriculture)
  earth: "#ac805b", // Frappe 500 (historical / warm)
  sand: "#d1b497", // Frappe 300
  clay: "#936340", // Frappe 600
  highlight: "#af851c", // Jasmine 800 — 3.5:1 on white
  ink: "#324e69", // Ink 500 (info / neutral comparison)
  neutral: "#7992a8", // Ink 300
};

/** The donut's slice palette: greens for the herd, warm and olive for the rest. */
export const PIE_COLORS = [
  CHART_COLORS.primary,
  CHART_COLORS.accent,
  CHART_COLORS.olive,
  CHART_COLORS.earth,
  CHART_COLORS.highlight,
  CHART_COLORS.deep,
];

export const AXIS_STYLE = { fontSize: 11, fill: "#536f8b" };
