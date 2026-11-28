import { DefaultTheme } from "@react-navigation/native";

/**
 * CVO mobile design tokens.
 *
 * Mirrors the web theme in `frontend/src/index.css`: exact palette values are
 * declared once here, then screens consume the semantic `colors` object. Keep
 * app-wide colour decisions in this file — screens should never hardcode a hex.
 *
 * Evergreen Gradient is the identity. Brunswick/Sage are identical in the
 * supplied palette, so one `sage` ramp serves both. Olive, Frappe, Jasmine and
 * Ink are the supporting families; the White ramp supplies surfaces.
 */

export const palette = {
  evergreen: {
    morningMist: "#e8f0eb",
    paleLichen: "#cde0d5",
    softPine: "#a3c6b3",
    sageNeedle: "#76a88d",
    cedarLeaf: "#4e8a6b",
    classicEvergreen: "#2d6a4f",
    spruce: "#20523b",
    deepFir: "#163b2a",
    borealShadow: "#0d261b",
    midnightForest: "#06140e",
  },
  // Brunswick Gradient == Sage Gradient (identical values in the brief).
  sage: ["#e0e8e3", "#c4d4ca", "#a8bfb1", "#8daa99", "#719680", "#558167", "#456853", "#344e3f", "#23352a", "#121c16"],
  olive: ["#f1f5e6", "#dfe6cc", "#ccd6b0", "#b7c293", "#a0ae75", "#869557", "#6c7a3c", "#515c29", "#363e19", "#1d210b"],
  frappe: ["#fbf7f0", "#efe2d4", "#e1ccb6", "#d1b497", "#bf9b79", "#ac805b", "#936340", "#764a29", "#563216", "#351a07"],
  jasmine: ["#fefdf3", "#fdf8e2", "#fbf1cc", "#f8e9b3", "#f5df95", "#f0d174", "#e4be52", "#cda334", "#af851c", "#896408"],
  ink: ["#e4eaef", "#c3d1dc", "#9eb2c3", "#7992a8", "#536f8b", "#324e69", "#1e3347", "#142231", "#0c141e", "#05080c"],
  white: ["#ffffff", "#fafafa", "#f7f6f3", "#f4f3ee", "#efefea", "#eae8e1", "#e5e2d9", "#dfdbd1", "#d9d4c9", "#d2cdbe"],
};

export const colors = {
  // Surfaces
  background: palette.white[2], // Porcelain
  surface: palette.white[0],
  surfaceMuted: palette.white[4], // Pearl
  border: palette.white[6], // Alabaster
  borderStrong: palette.white[8], // Linen
  selected: palette.evergreen.paleLichen,

  // Text (Ink)
  textPrimary: palette.ink[8],
  textSecondary: palette.ink[4],
  textOnDark: palette.white[0],

  // Brand
  brand: palette.evergreen.classicEvergreen,
  brandHover: palette.evergreen.spruce,
  brandDark: palette.evergreen.deepFir,
  brandSoft: palette.evergreen.morningMist,
  brandSoftBorder: palette.evergreen.paleLichen,

  // Status — identical meanings across web and mobile.
  success: palette.evergreen.classicEvergreen,
  successSoft: palette.evergreen.morningMist,
  warning: palette.jasmine[8],
  warningSoft: palette.jasmine[1],
  error: "#b42318",
  errorSoft: "#fee2e2",
  info: palette.ink[5],
  neutral: palette.ink[3],
  disabled: palette.white[8],
  accent: palette.jasmine[7],
};

/** React Navigation theme so headers/backgrounds match the screens. */
export const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.brand,
    background: colors.background,
    card: colors.brandDark,
    text: colors.textPrimary,
    border: colors.border,
    notification: colors.accent,
  },
};

/** Shared header styling for the native stack. */
export const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.brandDark },
  headerTintColor: colors.textOnDark,
  headerTitleStyle: { fontWeight: "700" },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.background },
};
