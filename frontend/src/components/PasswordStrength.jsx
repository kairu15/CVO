import { useTranslation } from "react-i18next";
import { Icon } from "./Icons";

/** The same checks the server's Password::defaults() policy applies. */
const CHECKS = [
  { key: "requirementLength", test: (password) => password.length >= 8 },
  { key: "requirementLower", test: (password) => /[a-z]/.test(password) },
  { key: "requirementUpper", test: (password) => /[A-Z]/.test(password) },
  { key: "requirementNumber", test: (password) => /[0-9]/.test(password) },
  { key: "requirementSymbol", test: (password) => /[^A-Za-z0-9]/.test(password) },
];

const LEVEL_TONES = {
  weak: { text: "text-red-600", bar: "bg-red-500" },
  fair: { text: "text-amber-600", bar: "bg-amber-500" },
  good: { text: "text-lime-700", bar: "bg-lime-600" },
  strong: { text: "text-brand-700", bar: "bg-brand-600" },
};

/**
 * Live strength meter plus the requirement checklist.
 *
 * It mirrors the backend policy, but it is only guidance: the server still
 * validates the password, so a user who ignores the hints gets the same
 * rejection they would get for any other invalid field.
 */
export function PasswordStrength({ password }) {
  const { t } = useTranslation();
  const passed = CHECKS.filter((check) => check.test(password)).length;

  const level =
    passed >= 5 ? "strong" : passed >= 4 ? "good" : passed >= 3 ? "fair" : "weak";
  const tone = LEVEL_TONES[level];

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-3 dark:border-slate-200/70 dark:bg-slate-100/60">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-500">
          {t("resetPassword.strengthLabel")}
        </span>
        <span className={`text-xs font-semibold ${password ? tone.text : "text-slate-400"}`}>
          {t(`resetPassword.strength.${level}`)}
        </span>
      </div>

      <div className="mt-2 flex gap-1" aria-hidden="true">
        {CHECKS.map((check, index) => (
          <span
            key={check.key}
            className={`h-1.5 flex-1 rounded-full ${
              password && index < passed ? tone.bar : "bg-slate-200 dark:bg-slate-300"
            }`}
          />
        ))}
      </div>

      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {CHECKS.map((check) => {
          const met = check.test(password);

          return (
            <li
              key={check.key}
              className={`flex items-start gap-1.5 text-[11px] leading-snug ${
                met ? "text-brand-800 dark:text-brand-800" : "text-slate-500"
              }`}
            >
              <Icon
                name={met ? "check" : "close"}
                className={`mt-0.5 h-3 w-3 shrink-0 ${met ? "text-brand-600" : "text-slate-300"}`}
              />
              {t(`resetPassword.${check.key}`)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
