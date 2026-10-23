import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fil from "./locales/fil.json";
import ceb from "./locales/ceb.json";

/**
 * Internationalization (item 8).
 *
 * The app now runs in English only: the language picker was removed, so there
 * is no way to choose another language and no stored preference is honoured.
 * The Filipino and Cebuano bundles stay registered with i18next, unused, so
 * re-enabling the picker later needs only the UI back.
 */

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fil: { translation: fil },
    ceb: { translation: ceb },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
});

document.documentElement.lang = "en";

export default i18n;
