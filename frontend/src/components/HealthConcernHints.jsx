import { useMemo, useState } from "react";
import { useSymptomRules } from "../api/queries";
import { matchSymptomRules } from "../lib/symptomMatching";
import { Icon } from "./Icons";

/**
 * Rule-Based Health Concern Hints.
 *
 * A small, admin-editable lookup table mapped against what a doctor has typed:
 * when the note contains any of a rule's keywords, the rule's plain-language
 * hint appears inline. This is explicit decision support — NOT a diagnosis and
 * NOT AI/ML — and the component says so in its own labelling rather than
 * leaving users to guess.
 *
 * Matching runs entirely in the browser against the rule list the API serves,
 * so typing never waits on a request. The matching itself lives in
 * `lib/symptomMatching.js`, where it can be unit-tested on its own.
 */

/**
 * @param {object} props
 * @param {string} props.text the note / diagnosis text to scan
 * @param {string|null} [props.animalType] lets species-scoped rules match
 * @param {string} [props.className]
 */
export function HealthConcernHints({ text, animalType = null, className = "" }) {
  const { data: rules = [] } = useSymptomRules();
  const [dismissed, setDismissed] = useState([]);

  const matches = useMemo(
    () => matchSymptomRules(rules, text, animalType).filter((rule) => !dismissed.includes(rule.id)),
    [rules, text, animalType, dismissed],
  );

  if (matches.length === 0) return null;

  return (
    <div
      role="status"
      aria-label="Health concern hints"
      className={`rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 ${className}`}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-amber-800 uppercase">
        <Icon name="info" className="h-3.5 w-3.5" />
        Possible concern — not a diagnosis. Consult a veterinarian.
      </p>

      <ul className="mt-2.5 space-y-2">
        {matches.map((rule) => (
          <li
            key={rule.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-amber-200/70 bg-white/70 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-900">{rule.label}</p>
              <p className="mt-0.5 text-xs text-amber-900/80">{rule.hint}</p>
            </div>
            <button
              type="button"
              onClick={() => setDismissed((prev) => [...prev, rule.id])}
              aria-label={`Dismiss hint: ${rule.label}`}
              className="shrink-0 rounded-lg p-1 text-amber-700/70 transition hover:bg-amber-100 hover:text-amber-900"
            >
              <Icon name="close" className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10px] text-amber-800/70">
        Matched from keywords by a fixed rule table — not a check by a veterinarian.
      </p>
    </div>
  );
}
