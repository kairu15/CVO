import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fil from "./locales/fil.json";
import ceb from "./locales/ceb.json";

/**
 * Internationalization (item 8).
 *
 * Three languages, English as the fallback: Filipino and Cebuano are partial —
 * any key not yet translated resolves to its English value through
 * `fallbackLng`, so a half-translated screen degrades to English rather than
 * showing raw keys.
 *
 * The choice persists in localStorage (no backend, per the brief) and is
 * applied to <html lang> for assistive tech.
 */

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fil", label: "Filipino" },
  { code: "ceb", label: "Cebuano" },
];

export const LANGUAGE_STORAGE_KEY = "cvo.language";

/** A stored language only wins if it is still one we offer. */
function initialLanguage() {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return LANGUAGES.some((language) => language.code === stored) ? stored : "en";
  } catch {
    return "en"; // storage blocked (private mode) — fall back to English
  }
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fil: { translation: fil },
    ceb: { translation: ceb },
  },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
});

i18n.on("languageChanged", (language) => {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Persisting is best-effort; the switch still applies for this session.
  }

  document.documentElement.lang = language;
});

export default i18n;
