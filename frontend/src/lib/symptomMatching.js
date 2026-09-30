/**
 * Matching for the Rule-Based Health Concern Hints.
 *
 * Kept out of the component file so the component module exports only
 * components (fast refresh), and so this pure function can be unit-tested
 * without rendering. There is no model here — just a keyword table lookup.
 */

/**
 * Which rules match a piece of text, in display order.
 *
 * - Case-insensitive substring match on ANY keyword: synonyms are
 *   alternatives, and a multi-word entry is a phrase match.
 * - A species-scoped rule only matches when the animal's type is known and
 *   equal; when the type is unknown we prefer silence over a wrong hint.
 * - Retired rules never match, even if a caller passes the full table.
 *
 * @param {Array<object>} rules
 * @param {string} text
 * @param {string|null} animalType
 * @returns {Array<object>}
 */
export function matchSymptomRules(rules, text, animalType) {
  const haystack = (text ?? "").toLowerCase();

  if (!haystack.trim()) return [];

  return (rules ?? []).filter((rule) => {
    if (rule.is_active === false) return false;

    if (rule.animal_type) {
      if (!animalType) return false;
      if (rule.animal_type.toLowerCase() !== String(animalType).toLowerCase()) return false;
    }

    return (rule.keywords ?? []).some(
      (keyword) => keyword && haystack.includes(String(keyword).toLowerCase()),
    );
  });
}
