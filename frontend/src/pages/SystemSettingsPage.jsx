import { useCallback, useEffect, useState } from "react";
import { settingsApi } from "../api/settingsApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { InlineAlert } from "../components/InlineAlert";
import { Icon } from "../components/Icons";
import { getRole } from "../config/roles";

/**
 * Admin "System Settings" screen.
 *
 * Deliberately small: one writable section (the office contact profile, shown
 * on the public landing page and the in-app Support page) and two read-only
 * sections (the barangay list and the vocabularies the forms offer). Neither
 * read-only section is a stub — the API refuses to store an edited copy,
 * because both validate existing records and a copy here could drift from
 * what the server enforces.
 */

const PROFILE_FIELDS = [
  {
    key: "office_email",
    label: "Office email",
    type: "email",
    hint: "Shown on the landing page and the Support page.",
  },
  {
    key: "office_phone",
    label: "Office phone",
    type: "text",
    hint: "The number beneficiaries call.",
  },
  {
    key: "office_hours",
    label: "Office hours",
    type: "text",
    hint: "When the office is open.",
  },
  {
    key: "office_address",
    label: "Office address",
    type: "text",
    hint: "Where the office is located.",
  },
];

export default function SystemSettingsPage({ roleKey = "admin" }) {
  const config = getRole(roleKey);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [profile, setProfile] = useState({});
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const settings = await settingsApi.get();

      setData(settings);
      setProfile(settings.office_profile ?? {});
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function setField(key, value) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});

    try {
      const payload = Object.fromEntries(
        PROFILE_FIELDS.map(({ key }) => [key, profile[key] ?? null]),
      );

      const saved = await settingsApi.saveProfile(payload);

      setData(saved);
      setProfile(saved.office_profile ?? {});
      setNotice("Contact details saved. Public pages show them immediately.");
    } catch (err) {
      const fields = getFieldErrors(err);

      if (fields) {
        setFieldErrors(fields);
        setError("Some fields need attention before this can be saved.");
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <p className="eyebrow">{config?.label ?? "Administrator"}</p>
        <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
          System Settings
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          The office contact details, and the program configuration the forms
          run on. Configuration is shown read-only on purpose — it validates
          existing records, so it is changed with a code deploy, not a click.
        </p>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}
      {notice && <InlineAlert tone="success" message={notice} onDismiss={() => setNotice(null)} />}

      {loading ? (
        <section className="card space-y-3 p-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </section>
      ) : !data ? (
        <section className="card">
          <InlineAlert message="Settings could not be loaded. Check the connection and try again." />
        </section>
      ) : (
        <>
          {/* Writable: the office contact profile */}
          <section className="card p-6">
            <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
              Office contact profile
            </h3>
            <p className="mt-1.5 text-xs text-slate-500">
              Rendered on the public landing page and the farmer Support page.
              Values shown before the first save are the shipped defaults.
            </p>

            <form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-2">
              {PROFILE_FIELDS.map(({ key, label, type, hint }) => (
                <div key={key}>
                  {/* The hint sits outside the <label> so the label's text
                      stays exactly the field name (the hint doubles as the
                      validation error slot). */}
                  <label className="block text-xs font-semibold text-slate-600">
                    {label}
                    <input
                      type={type}
                      value={profile[key] ?? ""}
                      onChange={(event) => setField(key, event.target.value)}
                      className="field mt-1 w-full text-sm"
                    />
                  </label>
                  <span className="mt-1 block font-normal text-[11px] text-slate-500">
                    {fieldErrors[key] ?? hint}
                  </span>
                </div>
              ))}

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary inline-flex items-center gap-2 rounded-pill px-5 py-2 text-sm font-semibold disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save contact details"}
                  {!saving && <Icon name="check" className="h-4 w-4" />}
                </button>
              </div>
            </form>
          </section>

          {/* Read-only: the barangay list */}
          <section className="card p-6">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                Barangays covered
              </h3>
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
                <Icon name="lock" className="h-3 w-3" />
                Read-only
              </span>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              The registration form's dropdown and every address validation
              normalize against this list. Changing it is a deploy, not a
              setting — renaming a barangay would orphan historical records.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {data.barangays.map((barangay) => (
                <span
                  key={barangay}
                  className="rounded-pill bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800"
                >
                  {barangay}
                </span>
              ))}
            </div>
          </section>

          {/* Read-only: form vocabularies */}
          <section className="card p-6">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                Form vocabularies
              </h3>
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
                <Icon name="lock" className="h-3 w-3" />
                Read-only
              </span>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              The outcome and visit-purpose lists the clinical and field forms
              validate against.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {Object.entries(data.vocabulary ?? {}).map(([name, options]) => (
                <div key={name}>
                  <p className="text-xs font-semibold text-slate-700 capitalize">
                    {name.replaceAll("_", " ")}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {options.map((option) => (
                      <li
                        key={option}
                        className="rounded-xl border border-slate-100 px-3 py-1.5 text-xs text-slate-600 capitalize"
                      >
                        {option.replaceAll("-", " ")}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
