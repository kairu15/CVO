import { useCallback, useEffect, useState } from "react";
import { settingsApi } from "../api/settingsApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { InlineAlert } from "../components/InlineAlert";
import { SkeletonList } from "../components/Skeleton";
import { Icon } from "../components/Icons";
import { SymptomRulesEditor } from "../components/SymptomRulesEditor";
import { getRole } from "../config/roles";

/**
 * Admin "System Settings" screen.
 *
 * Four sections with three different natures, grouped rather than listed flat:
 *
 * - Office contact profile — DATA. The office edits it (the phone number
 *   changes when the office moves), and the public landing page, the farmer
 *   Support page and the password-reset note read it back through
 *   `GET /api/v1/site`.
 * - Alerts & thresholds — POLICY. The vaccination cycle used to be a config
 *   value, which made a clinical decision a code deploy. It is a setting now,
 *   read by every derived surface through SettingsService.
 * - Session — the SPA's own inactivity auto-logout. The server's session
 *   ceilings sit beside it READ-ONLY, because they are enforced by the
 *   framework's session configuration and genuinely cannot change without a
 *   restart. Showing them is the honest option: the admin needs to see the
 *   limit the client window must stay under.
 * - Barangays & vocabularies — read-only on purpose. Both validate existing
 *   records, so an edited copy here could drift from what the server enforces.
 *
 * Each writable section saves only its own keys, so an edit to one group can
 * never blank another.
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

const ALERT_FIELDS = [
  {
    key: "vaccination_interval_days",
    label: "Vaccination interval (days)",
    min: 1,
    max: 3650,
    hint: "How long after a recorded vaccination the animal is due again.",
  },
  {
    key: "vaccination_due_soon_days",
    label: "Due-soon warning (days)",
    min: 1,
    max: 365,
    hint: "How far ahead of the due date the animal starts showing as due soon.",
  },
];

/** Shared input row: label wraps the control, hint doubles as error slot. */
function Field({ id, label, hint, error, children }) {
  return (
    <div>
      {/* The hint sits outside the <label> text so the label's accessible
          name stays exactly the field name (tests and screen readers both
          rely on it). */}
      <label htmlFor={id} className="block text-xs font-semibold text-slate-600">
        {label}
      </label>
      {children}
      <span className="mt-1 block text-[11px] text-slate-500">{error ?? hint}</span>
    </div>
  );
}

export default function SystemSettingsPage({ roleKey = "admin" }) {
  const config = getRole(roleKey);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [profile, setProfile] = useState({});
  const [alerts, setAlerts] = useState({});
  const [session, setSession] = useState({});

  // Which section's Save button is in flight — so only that button shows a
  // spinner and the others stay usable.
  const [savingSection, setSavingSection] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const apply = useCallback((settings) => {
    setData(settings);
    setProfile(settings.office_profile ?? {});
    setAlerts(settings.alerts ?? {});
    setSession(settings.session ?? {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      apply(await settingsApi.get());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    load();
  }, [load]);

  function setField(setter, key, value) {
    setter((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * Save one group. Sending only that group's keys keeps a section's edit from
   * touching another's values — the API writes exactly what it is given.
   */
  async function save(section, keys, values, successMessage) {
    setSavingSection(section);
    setError(null);
    setNotice(null);
    setFieldErrors({});

    try {
      const payload = Object.fromEntries(keys.map((key) => [key, values[key] ?? null]));
      const saved = await settingsApi.save(payload);

      apply(saved);
      setNotice(successMessage);
    } catch (err) {
      const fields = getFieldErrors(err);

      if (fields) {
        setFieldErrors(fields);
        setError("Some fields need attention before this can be saved.");
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setSavingSection(null);
    }
  }

  const saving = savingSection !== null;

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <p className="eyebrow">{config?.label ?? "Administrator"}</p>
        <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
          System Settings
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          What the public pages say about the office, the vaccination cycle the
          derived schedules run on, and the inactivity timeout for signed-in
          users. Saved values take effect immediately — no redeploy, no restart.
        </p>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}
      {notice && (
        <InlineAlert
          tone="success"
          message={notice}
          onDismiss={() => setNotice(null)}
          autoDismiss={5000}
        />
      )}

      {loading ? (
        <section className="card overflow-hidden">
          <SkeletonList rows={3} rowClassName="h-16" />
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
              Contact info
            </h3>
            <p className="mt-1.5 text-xs text-slate-500">
              Rendered on the public landing page, the farmer Support page and
              the password-reset note on the sign-in form. Values shown before
              the first save are the shipped defaults.
            </p>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                save(
                  "profile",
                  PROFILE_FIELDS.map((field) => field.key),
                  profile,
                  "Contact details saved. The public pages show them immediately.",
                );
              }}
              className="mt-4 grid gap-4 sm:grid-cols-2"
            >
              {PROFILE_FIELDS.map(({ key, label, type, hint }) => (
                <Field key={key} id={`profile-${key}`} label={label} hint={hint} error={fieldErrors[key]}>
                  <input
                    id={`profile-${key}`}
                    type={type}
                    value={profile[key] ?? ""}
                    onChange={(event) => setField(setProfile, key, event.target.value)}
                    className="field mt-1 w-full text-sm"
                  />
                </Field>
              ))}

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary inline-flex items-center gap-2 rounded-pill px-5 py-2 text-sm font-semibold disabled:opacity-60"
                >
                  {savingSection === "profile" ? "Saving…" : "Save contact details"}
                  {savingSection !== "profile" && <Icon name="check" className="h-4 w-4" />}
                </button>
              </div>
            </form>
          </section>

          {/* Writable: the vaccination cycle */}
          <section className="card p-6">
            <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
              Alerts &amp; thresholds
            </h3>
            <p className="mt-1.5 text-xs text-slate-500">
              The vaccination cycle. Every derived surface reads these two
              numbers — the Vaccination Schedule screen, Animal Health
              Monitoring, the public program counts and the daily smart-alert
              scan — so they can never disagree about which animals are late.
            </p>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                save(
                  "alerts",
                  ALERT_FIELDS.map((field) => field.key),
                  alerts,
                  "Vaccination thresholds saved. The derived schedules follow them now.",
                );
              }}
              className="mt-4 grid gap-4 sm:grid-cols-2"
            >
              {ALERT_FIELDS.map(({ key, label, min, max, hint }) => (
                <Field key={key} id={`alert-${key}`} label={label} hint={hint} error={fieldErrors[key]}>
                  <input
                    id={`alert-${key}`}
                    type="number"
                    min={min}
                    max={max}
                    required
                    value={alerts[key] ?? ""}
                    onChange={(event) => setField(setAlerts, key, event.target.value)}
                    className="field mt-1 w-full text-sm"
                  />
                </Field>
              ))}

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary inline-flex items-center gap-2 rounded-pill px-5 py-2 text-sm font-semibold disabled:opacity-60"
                >
                  {savingSection === "alerts" ? "Saving…" : "Save thresholds"}
                  {savingSection !== "alerts" && <Icon name="check" className="h-4 w-4" />}
                </button>
              </div>
            </form>
          </section>

          {/* Writable (client window) + read-only (server ceilings) */}
          <section className="card p-6">
            <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
              Session
            </h3>
            <p className="mt-1.5 text-xs text-slate-500">
              How long a signed-in user can be idle before the app signs them
              out. A countdown appears before that happens, and any interaction
              cancels it.
            </p>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                save(
                  "session",
                  ["session_idle_minutes"],
                  { session_idle_minutes: session.idle_minutes },
                  "Inactivity timeout saved.",
                );
              }}
              className="mt-4 max-w-md"
            >
              <Field
                id="session-idle"
                label="Inactivity timeout (minutes)"
                hint={`Cannot exceed the server's own limit of ${session.server_idle_minutes ?? "—"} minutes.`}
                error={fieldErrors.session_idle_minutes}
              >
                <input
                  id="session-idle"
                  type="number"
                  min={1}
                  max={session.server_idle_minutes ?? undefined}
                  required
                  value={session.idle_minutes ?? ""}
                  onChange={(event) => setField(setSession, "idle_minutes", event.target.value)}
                  className="field mt-1 w-full text-sm"
                />
              </Field>

              <button
                type="submit"
                disabled={saving}
                className="btn-primary mt-4 inline-flex items-center gap-2 rounded-pill px-5 py-2 text-sm font-semibold disabled:opacity-60"
              >
                {savingSection === "session" ? "Saving…" : "Save session timeout"}
                {savingSection !== "session" && <Icon name="check" className="h-4 w-4" />}
              </button>
            </form>

            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
                <Icon name="lock" className="h-3 w-3" />
                Server session limits · read-only
              </p>
              <p className="mt-1.5 text-xs text-slate-600">
                The API expires a session after{" "}
                <span className="font-semibold text-slate-800">
                  {session.server_idle_minutes ?? "—"} minutes
                </span>{" "}
                of inactivity, and after{" "}
                <span className="font-semibold text-slate-800">
                  {session.server_absolute_minutes ?? "—"} minutes
                </span>{" "}
                from sign-in regardless of activity.
              </p>
              <p className="mt-1.5 text-[11px] text-slate-500">
                These are read from the server's session configuration at boot,
                so they change with a deploy, not from this screen. The timeout
                above has to stay at or below the inactivity limit — otherwise a
                user would lose an unsaved form to a silent sign-out with no
                warning.
              </p>
            </div>
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
              setting — renaming a barangay would orphan historical records that
              spell it the old way.
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

      {/*
       * Writable, and deliberately not part of the failed-settings guard
       * above: the hint rules are their own table with their own load, so a
       * settings fetch failure should not hide the clinical rule editor.
       */}
      <SymptomRulesEditor />
    </div>
  );
}
