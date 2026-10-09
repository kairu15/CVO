import { useTranslation } from "react-i18next";
import { LANGUAGES } from "../i18n";
import { Icon } from "./Icons";

/**
 * Language picker (item 8): English / Filipino / Cebuano.
 *
 * The choice is applied through i18next and persisted to localStorage by the
 * i18n init (see src/i18n/index.js) — there is no backend involved, matching
 * the brief. Rendered as a native select so it works without extra JS and is
 * keyboard/screen-reader friendly.
 *
 * The root carries no display utility of its own: it used to hardcode
 * `inline-flex`, which competed with a caller's `hidden` (the dashboard header
 * passes `hidden md:inline-flex`) at equal specificity — and because Tailwind
 * orders the two display utilities, the `hidden` lost and the switcher stayed
 * visible on phones, crowding the header. Callers now supply `inline-flex`
 * themselves, so `hidden` wins as intended.
 */
export function LanguageSwitcher({ className = "" }) {
  const { i18n, t } = useTranslation();

  return (
    <label className={`items-center gap-1.5 ${className}`}>
      <Icon name="globe" className="h-4 w-4 text-slate-500" />
      <span className="sr-only">{t("common.language")}</span>
      <select
        value={i18n.resolvedLanguage ?? i18n.language}
        onChange={(event) => i18n.changeLanguage(event.target.value)}
        aria-label={t("common.language")}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:border-brand-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
      >
        {LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {language.label}
          </option>
        ))}
      </select>
    </label>
  );
}
