import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * Light/dark theme, system-wide.
 *
 * The choice persists in localStorage so a reload (and a second tab) keeps
 * it. `system` is the default until the user explicitly chooses light or dark;
 * choosing System again clears the stored value and follows the OS live.
 *
 * Application is class-strategy: a `dark` class on `<html>`, which Tailwind's
 * `@custom-variant dark` (index.css) turns into the `dark:` variant, so every
 * existing utility with a dark variant works without touching the cascade.
 * A short `transition-colors` on <body> (index.css) turns the flip into a
 * 200ms cross-fade instead of a flash.
 *
 * ThemeProvider sits ABOVE ToastProvider in main.jsx so a theme flip while
 * toasts are stacked re-renders them in the new scheme.
 */

const THEME_STORAGE_KEY = "cvo.theme";

const ThemeContext = createContext(null);

/** Stored preference, or undefined when the user follows the OS. */
function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : undefined;
  } catch {
    return undefined; // storage blocked (private mode) — fall back to OS
  }
}

/** The OS preference at initial load and while System is selected. */
function osPrefersDark() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches)
  );
}

export function ThemeProvider({ children }) {
  // undefined = "follow the OS"; light/dark = an explicit saved choice.
  const [preference, setPreference] = useState(readStoredTheme);
  const [systemDark, setSystemDark] = useState(osPrefersDark);

  const theme = preference ?? (systemDark ? "dark" : "light");

  // Apply the effective theme to the document for every consumer.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // While System is selected, follow OS changes live. A manual choice stops
  // this listener until the reader picks System again.
  useEffect(() => {
    if (preference !== undefined) return undefined;

    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function onChange(event) {
      setSystemDark(event.matches);
    }

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const persist = useCallback((next) => {
    setPreference(next);

    try {
      if (next === undefined) localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persisting is best-effort; the choice still applies this session.
    }
  }, []);

  const setThemeMode = useCallback(
    (mode) => {
      if (mode === "system") persist(undefined);
      else if (mode === "light" || mode === "dark") persist(mode);
    },
    [persist],
  );

  // Kept for callers that only need the familiar two-state flip.
  const toggleTheme = useCallback(() => {
    setThemeMode(theme === "dark" ? "light" : "dark");
  }, [setThemeMode, theme]);

  const value = useMemo(
    () => ({
      theme,
      mode: preference ?? "system",
      hasChosen: preference !== undefined,
      toggleTheme,
      setThemeMode,
    }),
    [theme, preference, toggleTheme, setThemeMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
