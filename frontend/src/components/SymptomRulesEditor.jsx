import { useCallback, useEffect, useState } from "react";
import { symptomRulesApi } from "../api/symptomRulesApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { InlineAlert } from "./InlineAlert";
import { SkeletonList } from "./Skeleton";
import { Icon } from "./Icons";

/**
 * System Settings → Health concern hints.
 *
 * The editable half of the Rule-Based Health Concern Hints. A rule maps a
 * keyword list to a plain-language "consider checking…" prompt; the case-note
 * and health-record forms show matching hints as the doctor types.
 *
 * Editable here on purpose: a hardcoded rule table would need a code change
 * every time the CVO's veterinarian wanted to add or correct a hint, which is
 * what would make it a one-off demo instead of a tool. Nothing in this module
 * is AI/ML, and the copy says so.
 */

const EMPTY_FORM = {
  id: null,
  label: "",
  keywordsText: "",
  hint: "",
  animalType: "",
  isActive: true,
  sortOrder: 0,
};

export function SymptomRulesEditor() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [form, setForm] = useState(null); // null = closed
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [confirmingDelete, setConfirmingDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setRules(await symptomRulesApi.list());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startCreate() {
    setForm({ ...EMPTY_FORM });
    setFieldErrors({});
    setNotice(null);
  }

  function startEdit(rule) {
    setForm({
      id: rule.id,
      label: rule.label ?? "",
      keywordsText: (rule.keywords ?? []).join(", "),
      hint: rule.hint ?? "",
      animalType: rule.animal_type ?? "",
      isActive: rule.is_active !== false,
      sortOrder: rule.sort_order ?? 0,
    });
    setFieldErrors({});
    setNotice(null);
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});

    // One keyword or phrase per comma-separated entry; blanks dropped here and
    // again server-side. A multi-word entry is a phrase match.
    const keywords = form.keywordsText
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean);

    const payload = {
      label: form.label.trim(),
      keywords,
      hint: form.hint.trim(),
      animal_type: form.animalType.trim() || null,
      is_active: form.isActive,
      sort_order: Number(form.sortOrder) || 0,
    };

    try {
      if (form.id) {
        await symptomRulesApi.update(form.id, payload);
        setNotice("Hint rule updated. Entry forms pick it up on their next open.");
      } else {
        await symptomRulesApi.create(payload);
        setNotice("Hint rule added. Entry forms pick it up on their next open.");
      }

      setForm(null);
      await load();
    } catch (err) {
      const fields = getFieldErrors(err);
      if (fields) {
        // Server error keys are `keywords.0`, etc. — surface under the keyword box.
        setFieldErrors({
          label: fields.label,
          keywordsText: fields.keywords || fields["keywords.0"],
          hint: fields.hint,
          animalType: fields.animal_type,
        });
        setError("Some fields need attention before this can be saved.");
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(rule) {
    setError(null);
    setNotice(null);
    setConfirmingDelete(null);

    try {
      await symptomRulesApi.remove(rule.id);
      setNotice(`Deleted “${rule.label}”.`);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
          Health concern hints
        </h3>
        {!form && (
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex items-center gap-1.5 rounded-pill border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50"
          >
            <Icon name="medical-cross" className="h-3.5 w-3.5" />
            Add rule
          </button>
        )}
      </div>

      <p className="mt-1.5 max-w-2xl text-xs text-slate-500">
        Rule-based hints shown while a doctor types a case note or health record.
        Matching is a fixed keyword lookup — <strong>not</strong> a model, and
        not a diagnosis. Each entry is one keyword or phrase; separate synonyms
        with commas.
      </p>

      {error && (
        <div className="mt-3">
          <InlineAlert message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {notice && (
        <div className="mt-3">
          <InlineAlert
            tone="success"
            message={notice}
            onDismiss={() => setNotice(null)}
            autoDismiss={5000}
          />
        </div>
      )}

      {form && (
        <form onSubmit={submit} className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <p className="text-xs font-semibold text-slate-700">
            {form.id ? "Edit rule" : "New rule"}
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <RuleField label="Label" error={fieldErrors.label}>
              <input
                type="text"
                value={form.label}
                onChange={(event) => setField("label", event.target.value)}
                placeholder="e.g. Digestive upset"
                className="field mt-1 w-full text-sm"
              />
            </RuleField>

            <RuleField
              label="Applies to animal type"
              hint="Leave blank for all animal types."
              error={fieldErrors.animalType}
            >
              <input
                type="text"
                value={form.animalType}
                onChange={(event) => setField("animalType", event.target.value)}
                placeholder="e.g. Carabao"
                className="field mt-1 w-full text-sm"
              />
            </RuleField>

            <RuleField
              label="Keywords"
              hint="Comma-separated. A multi-word entry matches that phrase."
              error={fieldErrors.keywordsText}
              full
            >
              <input
                type="text"
                value={form.keywordsText}
                onChange={(event) => setField("keywordsText", event.target.value)}
                placeholder="diarrhea, loose stool, watery stool"
                className="field mt-1 w-full text-sm"
              />
            </RuleField>

            <RuleField label="Hint shown to the doctor" error={fieldErrors.hint} full>
              <textarea
                rows={2}
                value={form.hint}
                onChange={(event) => setField("hint", event.target.value)}
                placeholder="Consider checking for dehydration and intestinal parasites."
                className="field mt-1 w-full text-sm"
              />
            </RuleField>

            <RuleField label="Sort order" hint="Lower shows first.">
              <input
                type="number"
                min="0"
                value={form.sortOrder}
                onChange={(event) => setField("sortOrder", event.target.value)}
                className="field mt-1 w-full text-sm"
              />
            </RuleField>

            <label className="flex items-center gap-2 self-end text-xs font-semibold text-slate-600">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setField("isActive", event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Active (offered on entry forms)
            </label>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setForm(null)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving…" : form.id ? "Save rule" : "Add rule"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="mt-4">
          <SkeletonList rows={3} rowClassName="h-14" />
        </div>
      ) : rules.length === 0 ? (
        <p className="mt-4 rounded-xl border border-slate-100 px-3 py-4 text-xs text-slate-500">
          No hint rules yet. Add one above, or run the seeder for starter rules.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="rounded-xl border border-slate-200 p-3.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                    {rule.label}
                    {rule.is_active === false && (
                      <span className="rounded-pill bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                        Retired
                      </span>
                    )}
                    {rule.animal_type && (
                      <span className="rounded-pill bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-800">
                        {rule.animal_type} only
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    <span className="font-medium text-slate-600">Keywords:</span>{" "}
                    {(rule.keywords ?? []).join(", ") || "—"}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">{rule.hint}</p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(rule)}
                    className="rounded-pill px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-50"
                  >
                    Edit
                  </button>
                  {confirmingDelete === rule.id ? (
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => remove(rule)}
                        className="rounded-pill bg-red-50 px-3 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-100"
                      >
                        Confirm delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(null)}
                        className="rounded-pill px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(rule.id)}
                      className="rounded-pill px-3 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Label + control + hint/error line, matching the settings page's field shape. */
function RuleField({ label, hint, error, full = false, children }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="block text-xs font-semibold text-slate-600">
        {label}
        {children}
      </label>
      <span className="mt-1 block font-normal text-[11px] text-slate-500">
        {error ?? hint}
      </span>
    </div>
  );
}
