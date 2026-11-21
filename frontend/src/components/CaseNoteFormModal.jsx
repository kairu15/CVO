import { useEffect, useMemo, useRef, useState } from "react";
import { caseNotesApi } from "../api/caseNotesApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { enqueue, isNetworkError } from "../lib/offlineQueue";
import { useToast } from "../context/ToastContext";
import { useNotifyOfflineSaved } from "../context/OfflineQueueContext";
import { useAuth } from "../context/AuthContext";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { Modal } from "./Modal";
import { ConfirmDialog } from "./ConfirmDialog";
import { ButtonSpinner } from "./LoadingSpinner";
import { TextField } from "./TextField";
import { Icon } from "./Icons";
import { HealthConcernHints } from "./HealthConcernHints";
import { VoiceInputButton } from "./VoiceInputButton";
import {
  CASE_CATEGORY_LABELS,
  CASE_STATUS_LABELS,
  caseCategoryLabel,
  caseStatusLabel,
  formatCaseDate,
} from "../lib/caseLabels";

const DEFAULT_CATEGORIES = [
  "general",
  "illness",
  "injury",
  "reproduction",
  "parasites",
  "mortality",
  "other",
];
const DEFAULT_STATUSES = ["open", "observation", "resolved"];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const EMPTY_FORM = {
  date_noted: "",
  category: "general",
  status: "open",
  location: "",
  body: "",
  actions_taken: "",
  recommendations: "",
  follow_up_on: "",
};

/** Coarse connectivity check — see useOnlineStatus. */
const isOnline = () =>
  typeof navigator === "undefined" ? true : navigator.onLine !== false;

/**
 * Open or revise a case.
 *
 * The case's original observation stays in `body`; follow-up activity and
 * status changes added later are append-only timeline entries, not rewrites of
 * this form. Optional photos are uploaded after the case row exists.
 */
export function CaseNoteFormModal({
  open,
  onClose,
  beneficiaries = [],
  note = null,
  options = {},
  onSaved,
}) {
  const editing = Boolean(note);
  const categories = options.categories?.length ? options.categories : DEFAULT_CATEGORIES;
  const statuses = options.statuses?.length ? options.statuses : DEFAULT_STATUSES;

  const [form, setForm] = useState(EMPTY_FORM);
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const [photo, setPhoto] = useState(null);
  const toast = useToast();
  const notifyOfflineSaved = useNotifyOfflineSaved();
  const { user } = useAuth();
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const markDirty = () => setDirty(true);

  useUnsavedChangesGuard({ when: open && dirty && !saving });

  const seededRef = useRef(null);

  const beneficiary = useMemo(
    () => beneficiaries.find((item) => String(item.id) === String(beneficiaryId)) ?? note ?? null,
    [beneficiaries, beneficiaryId, note],
  );

  useEffect(() => {
    if (!open) {
      seededRef.current = null;
      return;
    }

    const seedKey = note ? `edit:${note.id}` : "create";
    if (seededRef.current === seedKey) return;
    seededRef.current = seedKey;

    if (note) {
      setForm({
        date_noted: note.date_reported ?? note.date_noted ?? "",
        category: note.category ?? "general",
        status: note.status ?? "open",
        location: note.location ?? "",
        body: note.body ?? note.observations ?? "",
        actions_taken: note.actions_taken ?? "",
        recommendations: note.recommendations ?? "",
        follow_up_on: note.follow_up_on ?? "",
      });
      setBeneficiaryId(String(note.beneficiary_id));
    } else {
      setForm({ ...EMPTY_FORM, date_noted: new Date().toISOString().slice(0, 10) });
      setBeneficiaryId(beneficiaries.length === 1 ? String(beneficiaries[0].id) : "");
    }

    setPhoto(null);
    setErrors({});
    setDirty(false);
    setConfirmDiscard(false);
  }, [open, note, beneficiaries]);

  function update(field) {
    return (event) => {
      const { value } = event.target;
      setForm((previous) => ({ ...previous, [field]: value }));
      setErrors((previous) => ({ ...previous, [field]: undefined }));
      markDirty();
    };
  }

  function chooseBeneficiary(event) {
    const nextId = event.target.value;
    const selected = beneficiaries.find((item) => String(item.id) === String(nextId));

    setBeneficiaryId(nextId);
    setForm((previous) => ({
      ...previous,
      location: previous.location || selected?.address || "",
    }));
    setErrors((previous) => ({ ...previous, beneficiary_id: undefined }));
    markDirty();
  }

  function choosePhoto(event) {
    const file = event.target.files?.[0] ?? null;

    if (file && (!file.type.startsWith("image/") || file.size > MAX_PHOTO_BYTES)) {
      setPhoto(null);
      setErrors((previous) => ({
        ...previous,
        photo: "Choose a JPG, PNG or WebP image no larger than 8 MB.",
      }));
      event.target.value = "";
      return;
    }

    setPhoto(file);
    setErrors((previous) => ({ ...previous, photo: undefined }));
    markDirty();
  }

  function requestClose() {
    if (dirty && !saving) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  async function queueCase(payload, mode) {
    await enqueue({
      kind: "case-note",
      mode,
      ...(mode === "update" ? { serverId: note.id } : {}),
      label: `${mode === "update" ? "Case edit" : "Case"} — ${beneficiary?.name_of_farmer ?? "beneficiary"}`,
      payload,
      userId: user?.id ?? null,
    });

    notifyOfflineSaved({
      noun: "case note",
      label: beneficiary?.name_of_farmer ?? undefined,
    });

    if (photo) {
      toast.info("Case saved offline. Add the supporting photo when you are back online.");
    }

    setDirty(false);
    onSaved?.();
    onClose();
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (savingRef.current) return;

    if (!editing && !beneficiaryId) {
      setErrors((previous) => ({
        ...previous,
        beneficiary_id: "Choose the beneficiary this case belongs to.",
      }));
      return;
    }
    if (!form.date_noted) {
      setErrors((previous) => ({ ...previous, date_noted: "Enter the date reported." }));
      return;
    }
    if (!form.body.trim()) {
      setErrors((previous) => ({
        ...previous,
        body: "Record the initial observation.",
      }));
      return;
    }
    if (form.follow_up_on && form.follow_up_on < form.date_noted) {
      setErrors((previous) => ({
        ...previous,
        follow_up_on: "The follow-up cannot be before the case was reported.",
      }));
      return;
    }

    savingRef.current = true;
    setSaving(true);

    try {
      const payload = {
        date_noted: form.date_noted,
        category: form.category,
        status: form.status,
        location: form.location.trim() || null,
        body: form.body.trim(),
        actions_taken: form.actions_taken.trim() || null,
        recommendations: form.recommendations.trim() || null,
        follow_up_on: form.follow_up_on || null,
      };

      let saved = null;

      if (editing) {
        if (!isOnline()) {
          await queueCase(payload, "update");
          return;
        }

        try {
          saved = await caseNotesApi.update(note.id, payload);
        } catch (error) {
          if (isNetworkError(error)) {
            await queueCase(payload, "update");
            return;
          }
          throw error;
        }
      } else {
        const createPayload = { ...payload, beneficiary_id: Number(beneficiaryId) };

        if (!isOnline()) {
          await queueCase(createPayload, "create");
          return;
        }

        try {
          saved = await caseNotesApi.create(createPayload);
        } catch (error) {
          if (isNetworkError(error)) {
            await queueCase(createPayload, "create");
            return;
          }
          throw error;
        }
      }

      if (photo && saved?.id) {
        try {
          await caseNotesApi.uploadPhoto(saved.id, photo);
        } catch (uploadError) {
          toast.error(`Case saved, but the photo could not be attached: ${getErrorMessage(uploadError)}`);
        }
      }

      toast.success(editing ? "Case updated." : "Case opened.");
      setDirty(false);
      onSaved?.(saved);
      onClose();
    } catch (error) {
      const fields = getFieldErrors(error);
      if (fields) setErrors(fields);
      else toast.error(getErrorMessage(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        title={editing ? "Edit case" : "Open new case"}
        onClose={requestClose}
        contentClassName="max-w-3xl"
      >
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-brand-800 uppercase">
              <Icon name="lock" className="h-3.5 w-3.5" />
              From beneficiary record — read-only
            </p>
            {beneficiary ? (
              <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                {[
                  ["Name of Farmer", beneficiary.name_of_farmer],
                  ["Address", beneficiary.address],
                  ["Type of Animal", beneficiary.animal_type],
                  ["Sex", beneficiary.sex],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="mt-0.5 font-semibold text-slate-900">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                Pick a beneficiary below to load their details.
              </p>
            )}
          </div>

          <div>
            <h4 className="font-display text-sm font-bold text-slate-900">Case details</h4>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {!editing && (
                <div className="sm:col-span-2">
                  <label htmlFor="case-beneficiary" className="block text-sm font-medium text-slate-700">
                    Beneficiary
                  </label>
                  <select
                    id="case-beneficiary"
                    className="field mt-1.5"
                    value={beneficiaryId}
                    onChange={chooseBeneficiary}
                  >
                    <option value="">Select a beneficiary…</option>
                    {beneficiaries.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name_of_farmer} — {item.animal_type} ({item.sex}) · {item.address}
                      </option>
                    ))}
                  </select>
                  {errors.beneficiary_id && (
                    <p className="mt-1.5 text-xs font-medium text-red-600">
                      {errors.beneficiary_id}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="case-category" className="block text-sm font-medium text-slate-700">
                  Case category
                </label>
                <select
                  id="case-category"
                  className="field mt-1.5"
                  value={form.category}
                  onChange={update("category")}
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {CASE_CATEGORY_LABELS[category] ?? caseCategoryLabel(category)}
                    </option>
                  ))}
                </select>
                {errors.category && (
                  <p className="mt-1.5 text-xs font-medium text-red-600">{errors.category}</p>
                )}
              </div>

              <div>
                <label htmlFor="case-status" className="block text-sm font-medium text-slate-700">
                  Case status
                </label>
                <select
                  id="case-status"
                  className="field mt-1.5"
                  value={form.status}
                  onChange={update("status")}
                >
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {CASE_STATUS_LABELS[status] ?? caseStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>

              <TextField
                id="case-date"
                label="Date reported"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={form.date_noted}
                onChange={update("date_noted")}
                error={errors.date_noted}
              />

              <TextField
                id="case-follow-up"
                label="Next follow-up"
                type="date"
                value={form.follow_up_on}
                onChange={update("follow_up_on")}
                error={errors.follow_up_on}
                hint="Optional. Shown as upcoming or overdue until completed."
              />

              <TextField
                id="case-location"
                label="Location / sitio"
                value={form.location}
                onChange={update("location")}
                error={errors.location}
                placeholder="e.g. Purok 2, near the creek"
                className="sm:col-span-2"
              />
            </div>
          </div>

          <div>
            <label htmlFor="case-body" className="block text-sm font-medium text-slate-700">
              Initial observations
            </label>
            <textarea
              id="case-body"
              rows={5}
              className="field mt-1.5"
              placeholder="What did you see? e.g. The animal is limping and the left hoof is swollen."
              value={form.body}
              onChange={update("body")}
              aria-describedby="case-body-hint"
            />
            {errors.body ? (
              <p className="mt-1.5 text-xs font-medium text-red-600">{errors.body}</p>
            ) : (
              <p id="case-body-hint" className="mt-1.5 text-xs text-slate-500">
                A confirmed diagnosis belongs in Health Records. This is the case&apos;s opening observation.
              </p>
            )}
            <VoiceInputButton
              hintId="case-body-voice-hint"
              onTranscript={(text) =>
                setForm((previous) => ({
                  ...previous,
                  body: previous.body ? `${previous.body.trim()} ${text}` : text,
                }))
              }
            />
          </div>

          <HealthConcernHints
            text={form.body}
            animalType={beneficiary?.animal_type}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="case-actions" className="block text-sm font-medium text-slate-700">
                Actions taken
              </label>
              <textarea
                id="case-actions"
                rows={3}
                className="field mt-1.5"
                value={form.actions_taken}
                onChange={update("actions_taken")}
                placeholder="Treatment, advice or referral already given."
              />
              {errors.actions_taken && (
                <p className="mt-1.5 text-xs font-medium text-red-600">{errors.actions_taken}</p>
              )}
            </div>

            <div>
              <label htmlFor="case-recommendations" className="block text-sm font-medium text-slate-700">
                Recommendations
              </label>
              <textarea
                id="case-recommendations"
                rows={3}
                className="field mt-1.5"
                value={form.recommendations}
                onChange={update("recommendations")}
                placeholder="What should the owner or next technician do?"
              />
              {errors.recommendations && (
                <p className="mt-1.5 text-xs font-medium text-red-600">{errors.recommendations}</p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="case-photo" className="block text-sm font-medium text-slate-700">
              Supporting photo <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <input
              id="case-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={choosePhoto}
              className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 file:mr-3 file:rounded-pill file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-800"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Private to authorized staff. JPG, PNG or WebP up to 8 MB.
              {editing && note?.photo_url ? " Uploading replaces the current photo." : ""}
            </p>
            {photo && (
              <p className="mt-1 text-[11px] font-medium text-brand-800">
                Selected: {photo.name}
              </p>
            )}
            {errors.photo && (
              <p className="mt-1 text-xs font-medium text-red-600">{errors.photo}</p>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={requestClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? (
                <>
                  <ButtonSpinner />
                  Saving…
                </>
              ) : editing ? (
                "Save changes"
              ) : (
                "Open case"
              )}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDiscard}
        message="This case hasn't been saved yet. Closing the form discards what you've entered."
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}
