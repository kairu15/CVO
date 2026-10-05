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
 * it. With nothing stored, the first visit follows the OS via
 * `prefers-color-scheme`; the first manual toggle writes to storage and wins
 * from then on — the OS is only ever the *default*, never a live override.
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

/** Stored preference, or undefined when the user has never chosen. */
function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : undefined;
  } catch {
    return undefined; // storage blocked (private mode) — fall back to OS
  }
}

/** The OS preference at first load; the manual toggle overrides it after. */
function osPrefersDark() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

export function ThemeProvider({ children }) {
  // undefined = "no stored choice yet" — follow the OS, don't write anything.
  const [theme, setTheme] = useState(readStoredTheme);

  useEffect(() => {
    const root = document.documentElement;
    const effective = theme ?? (osPrefersDark() ? "dark" : "light");
    root.classList.toggle("dark", effective === "dark");
  }, [theme]);

  // Keep the no-choice case in sync with the OS until the user decides.
  useEffect(() => {
    if (theme !== undefined) return undefined;

    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function onChange(event) {
      document.documentElement.classList.toggle("dark", event.matches);
    }

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = (prev ?? (osPrefersDark() ? "dark" : "light")) === "dark" ? "light" : "dark";

      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Persisting is best-effort; the flip still applies for this session.
      }

      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      theme: theme ?? (osPrefersDark() ? "dark" : "light"),
      hasChosen: theme !== undefined,
      toggleTheme,
    }),
    [theme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
