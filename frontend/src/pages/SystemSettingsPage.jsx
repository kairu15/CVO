import { useCallback, useEffect, useState } from "react";
import { settingsApi } from "../api/settingsApi";
import { adminApi } from "../api/adminApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { InlineAlert } from "../components/InlineAlert";
import { SkeletonList } from "../components/Skeleton";
import { Icon } from "../components/Icons";
import { SymptomRulesEditor } from "../components/SymptomRulesEditor";
import { VocabularyEditor } from "../components/VocabularyEditor";
import { useToast } from "../context/ToastContext";
import { getRole } from "../config/roles";

/**
 * Admin "System Settings" screen.
 *
 * Sections with three different natures, grouped rather than listed flat:
 *
 * - Office contact profile — DATA. The office edits it (the phone number
 *   changes when the office moves), and the public landing page, the farmer
 *   Support page and the password-reset note read it back through
 *   `GET /api/v1/site`.
 * - Alerts & thresholds — POLICY. The vaccination cycle and the field-visit
 *   overdue window used to be config values, which made a clinical decision a
 *   code deploy. They are settings now, read by every derived surface through
 *   the backend SettingsService.
 * - Session — the SPA's own inactivity auto-logout. The server's session
 *   ceilings sit beside it READ-ONLY, because they are enforced by the
 *   framework's session configuration and genuinely cannot change without a
 *   restart. Showing them is the honest option: the admin needs to see the
 *   limit the client window must stay under.
 * - Animal types — the suggested species vocabulary the forms offer. It stays
 *   a suggestion (the importer keeps unknown workbook values as their own
 *   type), but the list is data now, so a new program category needs no deploy.
 * - Notification preferences — which stored event types and smart-alert rules
 *   actually write notification rows. A disabled smart-alert rule also clears
 *   the rows it had already written on the next scan.
 * - Reference data — puroks/sitios are managed here (add, rename, delete
 *   while unused; beneficiaries point at them by id, so renames are safe).
 *   Barangays can be added and re-centered but not renamed — the free-text
 *   historical addresses normalize against the list, so a rename would orphan
 *   them.
 * - Form vocabularies — the clinical outcome and field-visit purpose lists the
 *   health and field forms validate against. They used to be config, which
 *   made adding an outcome a deploy; they are data now, saved whole through
 *   the settings PATCH and read back by the API's own validation.
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
  {
    key: "field_visit_overdue_days",
    label: "Field-visit overdue (days)",
    min: 1,
    max: 3650,
    hint: "How stale a household's latest field visit may get before the daily smart-alert scan flags it.",
  },
];

/**
 * The notification switches, grouped the way the notifications screen reads.
 * `type` is the server's event vocabulary; `key` is the settings key the
 * toggle saves under.
 */
const NOTIFICATION_PREFERENCES = [
  {
    group: "Events",
    items: [
      { key: "notify_registration_new", type: "registration-new", label: "New registration submitted" },
      { key: "notify_registration_accepted", type: "registration-accepted", label: "Registration accepted" },
      { key: "notify_technician_assigned", type: "technician-assigned", label: "Technician assigned" },
      { key: "notify_technician_reassigned", type: "technician-reassigned", label: "Technician reassigned" },
      { key: "notify_field_visit_photo", type: "field-visit-photo", label: "Field visit photo uploaded" },
    ],
  },
  {
    group: "Smart alerts (daily scan)",
    items: [
      { key: "notify_smart_vaccination_overdue", type: "smart-vaccination-overdue", label: "Overdue vaccination" },
      { key: "notify_smart_bcs_out_of_range", type: "smart-bcs-out-of-range", label: "Body condition out of range" },
      { key: "notify_smart_no_recent_visit", type: "smart-no-recent-visit", label: "No recent field visit" },
      { key: "notify_smart_barangay_flag", type: "smart-barangay-flag", label: "Barangay concern flag" },
    ],
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
  const [animalTypes, setAnimalTypes] = useState([]);
  const [newAnimalType, setNewAnimalType] = useState("");
  const [healthOutcomes, setHealthOutcomes] = useState([]);
  const [newHealthOutcome, setNewHealthOutcome] = useState("");
  const [fieldVisitPurposes, setFieldVisitPurposes] = useState([]);
  const [newFieldVisitPurpose, setNewFieldVisitPurpose] = useState("");
  const [notifications, setNotifications] = useState({});

  // Reference-data editor state (puroks are row operations, saved immediately
  // rather than through the section-save pattern — each change is its own
  // API call, and the canonical list is refetched after every one).
  const [newPurokByBarangay, setNewPurokByBarangay] = useState({});
  const [renamingPurokId, setRenamingPurokId] = useState(null);
  const [renamePurokValue, setRenamePurokValue] = useState("");
  const [confirmingPurokId, setConfirmingPurokId] = useState(null);
  const [newBarangay, setNewBarangay] = useState({ name: "", latitude: "", longitude: "" });
  const [refBusy, setRefBusy] = useState(false);
  const toast = useToast();

  // Which section's Save button is in flight — so only that button shows a
  // spinner and the others stay usable.
  const [savingSection, setSavingSection] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const apply = useCallback((settings) => {
    setData(settings);
    setProfile(settings.office_profile ?? {});
    setAlerts(settings.alerts ?? {});
    setSession(settings.session ?? {});
    setAnimalTypes(settings.animal_types ?? []);
    setHealthOutcomes(settings.health_outcomes ?? []);
    setFieldVisitPurposes(settings.field_visit_purposes ?? []);
    setNotifications(settings.notifications ?? {});
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

  // Refetch without the full-page skeleton — for row operations (purok add /
  // rename / delete) where the screen should stay put.
  const refetchQuietly = useCallback(async () => {
    try {
      apply(await settingsApi.get());
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [apply]);

  useEffect(() => {
    load();
  }, [load]);

  function setField(setter, key, value) {
    setter((prev) => ({ ...prev, [key]: value }));
  }

  /** Append a trimmed draft to a list setting (no duplicates), clearing it. */
  function addOption(list, setList, draft, setDraft) {
    const trimmed = draft.trim();

    if (trimmed && !list.includes(trimmed)) {
      setList((prev) => [...prev, trimmed]);
    }

    setDraft("");
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

  // ── Reference data (puroks / barangays) ─────────────────────────────────
  // Each mutation is its own request, then the canonical list is refetched so
  // the screen never drifts from what the server has.

  async function runRefAction(action, successMessage) {
    setRefBusy(true);
    setError(null);
    setNotice(null);

    try {
      await action();
      await refetchQuietly();
      toast.success(successMessage);
      return true;
    } catch (err) {
      toast.error(getErrorMessage(err));
      return false;
    } finally {
      setRefBusy(false);
    }
  }

  async function addPurok(barangay) {
    const name = (newPurokByBarangay[barangay.id] ?? "").trim();
    if (!name) return;

    const ok = await runRefAction(
      () => adminApi.createPurok(barangay.id, { name }),
      `Purok "${name}" added to ${barangay.name}.`,
    );

    if (ok) setNewPurokByBarangay((prev) => ({ ...prev, [barangay.id]: "" }));
  }

  async function renamePurok(purok) {
    const name = renamePurokValue.trim();
    if (!name || name === purok.name) {
      setRenamingPurokId(null);
      return;
    }

    const ok = await runRefAction(
      () => adminApi.updatePurok(purok.id, { name }),
      "Purok renamed. Registered households now show the new name.",
    );

    if (ok) setRenamingPurokId(null);
  }

  async function deletePurok(purok) {
    const ok = await runRefAction(
      () => adminApi.deletePurok(purok.id),
      `Purok "${purok.name}" deleted.`,
    );

    if (ok) setConfirmingPurokId(null);
  }

  async function addBarangay(event) {
    event.preventDefault();

    const ok = await runRefAction(
      () =>
        adminApi.createBarangay({
          name: newBarangay.name.trim(),
          latitude: newBarangay.latitude,
          longitude: newBarangay.longitude,
        }),
      `Barangay "${newBarangay.name.trim()}" is now covered.`,
    );

    if (ok) setNewBarangay({ name: "", latitude: "", longitude: "" });
  }

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

          {/* Writable: the suggested animal-type vocabulary */}
          <section className="card p-6">
            <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
              Animal types
            </h3>
            <p className="mt-1.5 text-xs text-slate-500">
              The species list the forms suggest. It never becomes a filter on
              existing records — the import keeps every value it finds, even one
              not listed here — so adding a program category is safe. Saved as
              one list.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {animalTypes.map((type) => (
                <span
                  key={type}
                  className="inline-flex items-center gap-1.5 rounded-pill bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800"
                >
                  {type}
                  <button
                    type="button"
                    aria-label={`Remove ${type}`}
                    disabled={saving}
                    onClick={() =>
                      setAnimalTypes((prev) => prev.filter((t) => t !== type))
                    }
                    className="text-brand-600 hover:text-rose-600 disabled:opacity-40"
                  >
                    <Icon name="close" className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {animalTypes.length === 0 && (
                <p className="text-xs text-slate-500">No types yet — add the first one below.</p>
              )}
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                save(
                  "animal_types",
                  ["animal_types"],
                  { animal_types: animalTypes },
                  "Animal types saved. New registrations offer the updated list.",
                );
              }}
              className="mt-4 flex flex-wrap items-end gap-3"
            >
              <Field
                id="new-animal-type"
                label="Add a type"
                hint="Shown as a suggestion on forms."
                error={fieldErrors["animal_types"]}
              >
                <input
                  id="new-animal-type"
                  type="text"
                  maxLength={50}
                  value={newAnimalType}
                  onChange={(event) => setNewAnimalType(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const trimmed = newAnimalType.trim();
                      if (trimmed && !animalTypes.includes(trimmed)) {
                        setAnimalTypes((prev) => [...prev, trimmed]);
                      }
                      setNewAnimalType("");
                    }
                  }}
                  className="field mt-1 w-48 text-sm"
                />
              </Field>
              <button
                type="button"
                disabled={saving || !newAnimalType.trim()}
                onClick={() => {
                  const trimmed = newAnimalType.trim();
                  if (trimmed && !animalTypes.includes(trimmed)) {
                    setAnimalTypes((prev) => [...prev, trimmed]);
                  }
                  setNewAnimalType("");
                }}
                className="btn-secondary inline-flex items-center gap-2 rounded-pill px-4 py-2 text-sm font-semibold disabled:opacity-60"
              >
                <Icon name="plus" className="h-4 w-4" />
                Add
              </button>

              <button
                type="submit"
                disabled={saving}
                className="btn-primary inline-flex items-center gap-2 rounded-pill px-5 py-2 text-sm font-semibold disabled:opacity-60"
              >
                {savingSection === "animal_types" ? "Saving…" : "Save animal types"}
                {savingSection !== "animal_types" && <Icon name="check" className="h-4 w-4" />}
              </button>
            </form>
          </section>

          {/* Writable: which notifications actually write rows */}
          <section className="card p-6">
            <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
              Notification preferences
            </h3>
            <p className="mt-1.5 text-xs text-slate-500">
              Which events and smart-alert rules create a notification. Turning
              a smart alert off also clears the flags it had already written, on
              the next daily scan.
            </p>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const items = NOTIFICATION_PREFERENCES.flatMap((group) => group.items);
                const keys = items.map((item) => item.key);
                const values = Object.fromEntries(
                  items.map((item) => [item.key, notifications[item.type] ?? true]),
                );
                save(
                  "notifications",
                  keys,
                  values,
                  "Notification preferences saved. Future events follow them now.",
                );
              }}
              className="mt-4 grid gap-6 sm:grid-cols-2"
            >
              {NOTIFICATION_PREFERENCES.map((group) => (
                <fieldset key={group.group}>
                  <legend className="text-xs font-semibold text-slate-700">{group.group}</legend>
                  <ul className="mt-2 space-y-2">
                    {group.items.map((item) => (
                      <li
                        key={item.key}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2"
                      >
                        <label
                          htmlFor={`notify-${item.key}`}
                          className="text-xs font-medium text-slate-700"
                        >
                          {item.label}
                        </label>
                        <input
                          id={`notify-${item.key}`}
                          type="checkbox"
                          checked={notifications[item.type] ?? true}
                          onChange={(event) =>
                            setNotifications((prev) => ({
                              ...prev,
                              [item.type]: event.target.checked,
                            }))
                          }
                          className="h-4 w-4 accent-brand-700"
                        />
                      </li>
                    ))}
                  </ul>
                </fieldset>
              ))}

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary inline-flex items-center gap-2 rounded-pill px-5 py-2 text-sm font-semibold disabled:opacity-60"
                >
                  {savingSection === "notifications" ? "Saving…" : "Save notification preferences"}
                  {savingSection !== "notifications" && <Icon name="check" className="h-4 w-4" />}
                </button>
              </div>
            </form>
          </section>

          {/* Writable: reference data (puroks) + add-only barangays */}
          <section className="card p-6">
            <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
              Reference data
            </h3>
            <p className="mt-1.5 text-xs text-slate-500">
              The barangays the program covers and the puroks inside them.
              Puroks can be added, renamed and deleted while no household is
              registered in them — the registration form's dropdown follows
              immediately. Barangays can be added but not renamed: renaming one
              would orphan every historical address that spells it the old way.
            </p>

            <div className="mt-4 space-y-4">
              {data.barangays.map((barangay) => (
                <div key={barangay.id} className="rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                    <p className="text-sm font-semibold text-slate-800">{barangay.name}</p>
                    <span className="text-[11px] text-slate-500">
                      {barangay.puroks.length}{" "}
                      {barangay.puroks.length === 1 ? "purok" : "puroks"}
                    </span>
                  </div>

                  <ul className="divide-y divide-slate-50 px-4">
                    {barangay.puroks.map((purok) => (
                      <li key={purok.id} className="flex items-center justify-between gap-3 py-2">
                        {renamingPurokId === purok.id ? (
                          <span className="flex items-center gap-2">
                            <input
                              type="text"
                              value={renamePurokValue}
                              onChange={(event) => setRenamePurokValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  renamePurok(purok);
                                }
                              }}
                              className="field w-48 text-sm"
                              aria-label="Purok name"
                            />
                            <button
                              type="button"
                              disabled={refBusy}
                              onClick={() => renamePurok(purok)}
                              className="text-xs font-semibold text-brand-700 hover:text-brand-900 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenamingPurokId(null)}
                              className="text-xs text-slate-500 hover:text-slate-700"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span className="flex items-center gap-2 text-xs text-slate-700">
                            {purok.name}
                            {purok.is_placeholder && (
                              <span className="rounded-pill bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 uppercase">
                                Placeholder
                              </span>
                            )}
                          </span>
                        )}

                        {renamingPurokId !== purok.id && (
                          <span className="flex items-center gap-3">
                            <button
                              type="button"
                              disabled={refBusy}
                              onClick={() => {
                                setRenamingPurokId(purok.id);
                                setRenamePurokValue(purok.name);
                              }}
                              className="text-xs font-semibold text-brand-700 hover:text-brand-900 disabled:opacity-50"
                            >
                              Rename
                            </button>
                            {confirmingPurokId === purok.id ? (
                              <span className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={refBusy}
                                  onClick={() => deletePurok(purok)}
                                  className="rounded-pill bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                                >
                                  Confirm delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmingPurokId(null)}
                                  className="text-xs text-slate-500 hover:text-slate-700"
                                >
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={refBusy}
                                onClick={() => setConfirmingPurokId(purok.id)}
                                className="text-xs font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50"
                              >
                                Delete
                              </button>
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                    {barangay.puroks.length === 0 && (
                      <li className="py-2 text-xs text-slate-500">No puroks recorded yet.</li>
                    )}
                  </ul>

                  <div className="flex items-end gap-2 px-4 py-3">
                    <input
                      type="text"
                      value={newPurokByBarangay[barangay.id] ?? ""}
                      onChange={(event) =>
                        setNewPurokByBarangay((prev) => ({
                          ...prev,
                          [barangay.id]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addPurok(barangay);
                        }
                      }}
                      placeholder="New purok / sitio name"
                      className="field w-56 text-sm"
                      aria-label={`New purok in ${barangay.name}`}
                    />
                    <button
                      type="button"
                      disabled={refBusy || !newPurokByBarangay[barangay.id]?.trim()}
                      onClick={() => addPurok(barangay)}
                      className="btn-secondary inline-flex items-center gap-1.5 rounded-pill px-4 py-2 text-xs font-semibold disabled:opacity-60"
                    >
                      <Icon name="plus" className="h-3.5 w-3.5" />
                      Add purok
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={addBarangay} className="mt-6 rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-700">Add a barangay</p>
              <p className="mt-1 text-[11px] text-slate-500">
                The map center is used for GPS auto-detect. New barangays appear
                at the end of every dropdown.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={255}
                  value={newBarangay.name}
                  onChange={(event) =>
                    setNewBarangay((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder="Barangay name"
                  className="field text-sm"
                  aria-label="Barangay name"
                />
                <input
                  type="number"
                  step="any"
                  required
                  value={newBarangay.latitude}
                  onChange={(event) =>
                    setNewBarangay((prev) => ({ ...prev, latitude: event.target.value }))
                  }
                  placeholder="Latitude"
                  className="field text-sm"
                  aria-label="Latitude"
                />
                <input
                  type="number"
                  step="any"
                  required
                  value={newBarangay.longitude}
                  onChange={(event) =>
                    setNewBarangay((prev) => ({ ...prev, longitude: event.target.value }))
                  }
                  placeholder="Longitude"
                  className="field text-sm"
                  aria-label="Longitude"
                />
                <button
                  type="submit"
                  disabled={refBusy}
                  className="btn-primary inline-flex items-center justify-center gap-2 rounded-pill px-4 py-2 text-sm font-semibold disabled:opacity-60"
                >
                  {refBusy ? "Working…" : "Add barangay"}
                </button>
              </div>
            </form>
          </section>

          {/* Writable: the clinical outcome vocabulary */}
          <VocabularyEditor
            title="Health outcomes"
            description="The list the health record form offers and the API validates against. Saved as one list; the form updates as soon as it is saved."
            inputId="new-health-outcome"
            addLabel="Add an outcome"
            addHint="Shown on the health record form."
            saveLabel="Save health outcomes"
            values={healthOutcomes}
            draft={newHealthOutcome}
            onDraftChange={setNewHealthOutcome}
            onAdd={() =>
              addOption(healthOutcomes, setHealthOutcomes, newHealthOutcome, setNewHealthOutcome)
            }
            onRemove={(value) =>
              setHealthOutcomes((prev) => prev.filter((outcome) => outcome !== value))
            }
            onSave={(event) => {
              event.preventDefault();
              save(
                "health_outcomes",
                ["health_outcomes"],
                { health_outcomes: healthOutcomes },
                "Health outcomes saved. The clinical form offers the updated list.",
              );
            }}
            saving={savingSection === "health_outcomes"}
            error={fieldErrors.health_outcomes}
            display={(value) => value.replaceAll("-", " ")}
          />

          {/* Writable: the field-visit purpose vocabulary */}
          <VocabularyEditor
            title="Field visit purposes"
            description="The list the field visit form offers and the API validates against. Saved as one list; the form updates as soon as it is saved."
            inputId="new-field-visit-purpose"
            addLabel="Add a purpose"
            addHint="Shown on the field visit form."
            saveLabel="Save field visit purposes"
            values={fieldVisitPurposes}
            draft={newFieldVisitPurpose}
            onDraftChange={setNewFieldVisitPurpose}
            onAdd={() =>
              addOption(
                fieldVisitPurposes,
                setFieldVisitPurposes,
                newFieldVisitPurpose,
                setNewFieldVisitPurpose,
              )
            }
            onRemove={(value) =>
              setFieldVisitPurposes((prev) => prev.filter((purpose) => purpose !== value))
            }
            onSave={(event) => {
              event.preventDefault();
              save(
                "field_visit_purposes",
                ["field_visit_purposes"],
                { field_visit_purposes: fieldVisitPurposes },
                "Field visit purposes saved. The field form offers the updated list.",
              );
            }}
            saving={savingSection === "field_visit_purposes"}
            error={fieldErrors.field_visit_purposes}
            display={(value) => value.replaceAll("-", " ")}
          />
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
