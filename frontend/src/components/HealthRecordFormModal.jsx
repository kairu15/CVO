import { useEffect, useMemo, useRef, useState } from "react";
import { healthRecordsApi } from "../api/healthRecordsApi";
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

/** `ongoing` → `Ongoing`. */
export const outcomeLabel = (value) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : "—";

const EMPTY_FORM = {
  animal_quantity: 1,
  date_recorded: "",
  diagnosis: "",
  symptoms: "",
  treatment: "",
  outcome: "",
  follow_up_on: "",
  remarks: "",
};

/** Coarse connectivity check — see useOnlineStatus. */
const isOnline = () =>
  typeof navigator === "undefined" ? true : navigator.onLine !== false;

/**
 * Technician's health record form.
 *
 * The beneficiary identity block renders read-only from the beneficiary
 * record, the same way the technician's visit form works — the vet fills in
 * the clinical fields only.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose called after a successful save or cancel
 * @param {Array<object>} props.beneficiaries picker options (create mode)
 * @param {Array<string>} props.outcomes served vocabulary for the outcome select
 * @param {object} [props.record] existing record to edit
 * @param {() => void} props.onSaved
 */
export function HealthRecordFormModal({
  open,
  onClose,
  beneficiaries = [],
  outcomes = [],
  record = null,
  onSaved,
}) {
  const editing = Boolean(record);

  const [form, setForm] = useState(EMPTY_FORM);
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const toast = useToast();
  const notifyOfflineSaved = useNotifyOfflineSaved();
  const { user } = useAuth();
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  // Unsaved-input tracking — see FieldVisitFormModal for the full rationale.
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const markDirty = () => setDirty(true);

  useUnsavedChangesGuard({ when: open && dirty && !saving });

  // Object URLs must be revoked or a long field session leaks every preview.
  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return undefined;
    }

    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [photo]);

  // Which "session" of the form has been seeded. The beneficiaries prop is
  // re-fetched on a 30s poll (and on window focus) and arrives as a brand-new
  // array, so it must NOT re-run the seeding effect: doing so wipes the
  // beneficiary chosen and the diagnosis/treatment typed mid-entry.
  const seededRef = useRef(null);
  const savingRef = useRef(false);

  const beneficiary = useMemo(
    () =>
      beneficiaries.find((b) => String(b.id) === String(beneficiaryId)) ??
      record ??
      null,
    [beneficiaries, beneficiaryId, record],
  );

  useEffect(() => {
    if (!open) {
      seededRef.current = null;
      return;
    }

    // Seed once per open/record, not on every poll that hands us a new
    // beneficiaries array (see seededRef).
    const seedKey = record ? `edit:${record.id}` : "create";
    // A poll that arrives later must not re-seed: that is exactly what wiped
    // the vet's entry. Bail once this open/record has been seeded.
    if (seededRef.current === seedKey) return;
    seededRef.current = seedKey;

    if (record) {
      setForm({
        animal_quantity: record.animal_quantity ?? 1,
        date_recorded: record.date_recorded ?? "",
        diagnosis: record.diagnosis ?? "",
        symptoms: record.symptoms ?? "",
        treatment: record.treatment ?? "",
        outcome: record.outcome ?? "",
        follow_up_on: record.follow_up_on ?? "",
        remarks: record.remarks ?? "",
      });
      setBeneficiaryId(String(record.beneficiary_id));
    } else {
      setForm({ ...EMPTY_FORM, date_recorded: new Date().toISOString().slice(0, 10) });
      setBeneficiaryId(beneficiaries.length === 1 ? String(beneficiaries[0].id) : "");
    }

    setPhoto(null);
    setErrors({});
    setDirty(false);
    setConfirmDiscard(false);
  }, [open, record, beneficiaries]);

  function update(field) {
    return (event) => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      markDirty();
    };
  }

  /** Close — asking first when there is unsaved input to lose. */
  function requestClose() {
    if (dirty && !saving) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  /**
   * Keep the record on the device instead of sending it, so a vet examining an
   * animal in the field never loses a diagnosis to a dropped connection. The
   * queue replays it when the API is reachable again.
   */
  async function queueRecord(createPayload) {
    await enqueue({
      kind: "health-record",
      mode: "create",
      label: `Health record — ${beneficiary?.name_of_farmer ?? "beneficiary"}`,
      payload: createPayload,
      userId: user?.id ?? null,
    });

    notifyOfflineSaved({
      noun: "health record",
      label: beneficiary?.name_of_farmer ?? undefined,
    });
    setDirty(false);
    onSaved?.();
    onClose();
  }

  /**
   * Queue an EDIT of an existing record. Editing the SAME record can overwrite
   * a change someone else made — the queue checks that before applying.
   */
  async function queueRecordEdit(payload) {
    await enqueue({
      kind: "health-record",
      mode: "update",
      serverId: record.id,
      label: `Health record edit — ${beneficiary?.name_of_farmer ?? "beneficiary"}`,
      payload,
      userId: user?.id ?? null,
    });

    notifyOfflineSaved({
      noun: "health record edit",
      label: beneficiary?.name_of_farmer ?? undefined,
    });
    setDirty(false);
    onSaved?.();
    onClose();
  }

  async function handleSubmit(event) {
    event.preventDefault();

    // The button is disabled while saving, but a double Enter keypress can
    // still land two submits in the same tick. Refuse the second one.
    if (savingRef.current) return;

    if (!editing && !beneficiaryId) {
      setErrors((prev) => ({ ...prev, beneficiary_id: "Choose the animal this record is about." }));
      return;
    }
    if (!form.date_recorded) {
      setErrors((prev) => ({ ...prev, date_recorded: "Enter the date of examination." }));
      return;
    }
    if (!form.diagnosis.trim()) {
      setErrors((prev) => ({ ...prev, diagnosis: "Enter a diagnosis." }));
      return;
    }
    if (form.follow_up_on && form.follow_up_on < form.date_recorded) {
      setErrors((prev) => ({
        ...prev,
        follow_up_on: "The follow-up cannot be before the examination date.",
      }));
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      // Empty optional fields go up as null so a cleared field actually clears
      // rather than being ignored by the server's `nullable` rule.
      const payload = {
        animal_quantity: Number(form.animal_quantity) || 1,
        date_recorded: form.date_recorded,
        diagnosis: form.diagnosis.trim(),
        symptoms: form.symptoms.trim() || null,
        treatment: form.treatment.trim() || null,
        outcome: form.outcome || null,
        follow_up_on: form.follow_up_on || null,
        remarks: form.remarks.trim() || null,
      };

      let saved = null;

      if (editing) {
        // Offline: queue the edit; the queue replays it and flags a conflict
        // if the record changed on the server in the meantime.
        if (!isOnline()) {
          await queueRecordEdit(payload);
          if (photo) toast.error("The edit will sync later, but the photo cannot be queued offline.");
          return;
        }

        try {
          saved = await healthRecordsApi.update(record.id, payload);
        } catch (editError) {
          if (isNetworkError(editError)) {
            await queueRecordEdit(payload);
            if (photo) toast.error("The edit will sync later, but the photo cannot be queued offline.");
            return;
          }
          throw editError;
        }
      } else {
        const createPayload = { ...payload, beneficiary_id: Number(beneficiaryId) };

        // No connection: queue the record for later instead of failing.
        if (!isOnline()) {
          await queueRecord(createPayload);
          if (photo) toast.error("The record will sync later, but the photo cannot be queued offline.");
          return;
        }

        try {
          saved = await healthRecordsApi.create(createPayload);
        } catch (createError) {
          // The request never reached the server — queue it rather than
          // surfacing a dead-end error.
          if (isNetworkError(createError)) {
            await queueRecord(createPayload);
            if (photo) toast.error("The record will sync later, but the photo cannot be queued offline.");
            return;
          }
          throw createError;
        }
      }

      // The record is the primary save. A photo failure must not discard a
      // diagnosis that already reached the audit trail; tell the technician
      // plainly and let them attach it again from the record.
      if (photo && saved?.id) {
        try {
          await healthRecordsApi.uploadPhoto(saved.id, photo);
        } catch (photoError) {
          toast.error(
            `Record saved, but the photo could not be uploaded: ${getErrorMessage(photoError)}`,
          );
        }
      }

      toast.success(editing ? "Health record updated." : "Health record created.");
      setDirty(false);
      onSaved?.();
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
        title={editing ? "Edit health record" : "New health record"}
        onClose={requestClose}
      >
      <form onSubmit={handleSubmit} noValidate>
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

        {/* A record is about one animal; moving it is not allowed, so the
            picker is create-only (see UpdateHealthRecordRequest). */}
        {!editing && (
          <div className="mt-4">
            <label
              htmlFor="health-beneficiary"
              className="block text-sm font-medium text-slate-700"
            >
              Beneficiary
            </label>
            <select
              id="health-beneficiary"
              className="field mt-1.5"
              value={beneficiaryId}
              onChange={(event) => {
                setBeneficiaryId(event.target.value);
                setErrors((prev) => ({ ...prev, beneficiary_id: undefined }));
                markDirty();
              }}
            >
              <option value="">Select a beneficiary…</option>
              {beneficiaries.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name_of_farmer} — {b.animal_type} ({b.sex}) · {b.address}
                </option>
              ))}
            </select>
            {errors.beneficiary_id && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{errors.beneficiary_id}</p>
            )}
          </div>
        )}

        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
            Examination
          </p>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <TextField
            id="health-date"
            label="Date of examination"
            type="date"
            value={form.date_recorded}
            onChange={update("date_recorded")}
            error={errors.date_recorded}
          />

          <TextField
            id="health-quantity"
            label="Animals examined"
            type="number"
            min="1"
            max="1000"
            value={form.animal_quantity}
            onChange={update("animal_quantity")}
            error={errors.animal_quantity}
          />

          <div>
            <label htmlFor="health-outcome" className="block text-sm font-medium text-slate-700">
              Outcome
            </label>
            <select
              id="health-outcome"
              className="field mt-1.5"
              value={form.outcome}
              onChange={update("outcome")}
              aria-describedby="health-outcome-hint"
            >
              <option value="">Not yet closed out</option>
              {outcomes.map((value) => (
                <option key={value} value={value}>
                  {outcomeLabel(value)}
                </option>
              ))}
            </select>
            <p id="health-outcome-hint" className="mt-1.5 text-xs text-slate-500">
              Leave blank while the case is still open.
            </p>
          </div>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
            Observations & assessment
          </p>
        </div>

        <div className="mt-3">
          <label htmlFor="health-symptoms" className="block text-sm font-medium text-slate-700">
            Observations / symptoms
          </label>
          <textarea
            id="health-symptoms"
            rows={2}
            className="field mt-1.5"
            placeholder="What did you see? e.g. fever, limping, loss of appetite"
            value={form.symptoms}
            onChange={update("symptoms")}
          />
          {errors.symptoms && (
            <p className="mt-1.5 text-xs font-medium text-red-600">{errors.symptoms}</p>
          )}
        </div>

        <div className="mt-3">
          <TextField
            id="health-diagnosis"
            label="Diagnosis"
            type="text"
            placeholder="e.g. Foot and mouth disease (suspected)"
            value={form.diagnosis}
            onChange={update("diagnosis")}
            error={errors.diagnosis}
          />
        </div>

        {/* Rule-based, client-side keyword match over the observations,
            diagnosis and remarks — decision support, never a diagnosis. */}
        <HealthConcernHints
          className="mt-3"
          text={`${form.symptoms} ${form.diagnosis} ${form.remarks}`}
          animalType={beneficiary?.animal_type}
        />

        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
            Treatment & recommendations
          </p>
        </div>

        <div className="mt-3">
          <label htmlFor="health-treatment" className="block text-sm font-medium text-slate-700">
            Treatment
          </label>
          <textarea
            id="health-treatment"
            rows={3}
            className="field mt-1.5"
            placeholder="Medication, dosage and instructions given"
            value={form.treatment}
            onChange={update("treatment")}
          />
          {errors.treatment && (
            <p className="mt-1.5 text-xs font-medium text-red-600">{errors.treatment}</p>
          )}

          {/* Voice dictation appends to the field; it never saves the record. */}
          <VoiceInputButton
            hintId="health-treatment-voice-hint"
            onTranscript={(text) =>
              setForm((prev) => ({
                ...prev,
                treatment: prev.treatment ? `${prev.treatment.trim()} ${text}` : text,
              }))
            }
          />
        </div>

        <div className="mt-3">
          <label htmlFor="health-remarks" className="block text-sm font-medium text-slate-700">
            Recommendations / follow-up notes
          </label>
          <textarea
            id="health-remarks"
            rows={2}
            className="field mt-1.5"
            placeholder="Home care, isolation, or what to check at the next visit"
            value={form.remarks}
            onChange={update("remarks")}
          />
          {errors.remarks && (
            <p className="mt-1.5 text-xs font-medium text-red-600">{errors.remarks}</p>
          )}

          <VoiceInputButton
            hintId="health-remarks-voice-hint"
            onTranscript={(text) =>
              setForm((prev) => ({
                ...prev,
                remarks: prev.remarks ? `${prev.remarks.trim()} ${text}` : text,
              }))
            }
          />
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
            Follow-up & supporting photo
          </p>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField
            id="health-follow-up"
            label="Follow-up date"
            type="date"
            value={form.follow_up_on}
            onChange={update("follow_up_on")}
            error={errors.follow_up_on}
            hint="Optional. Leave blank when no recheck is needed."
          />

          <div>
            <label htmlFor="health-photo" className="block text-sm font-medium text-slate-700">
              Supporting photo
            </label>
            <input
              id="health-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(event) => {
                setPhoto(event.target.files?.[0] ?? null);
                setErrors((prev) => ({ ...prev, image: undefined }));
                markDirty();
              }}
              className="mt-1.5 block w-full text-xs text-slate-600 file:mr-3 file:rounded-pill file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-brand-800 hover:file:bg-brand-100"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Optional. JPG, PNG or WebP, up to 8 MB; a new photo replaces the old one.
            </p>
            {errors.image && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{errors.image}</p>
            )}
            {photoPreview ? (
              <img
                src={photoPreview}
                alt="Selected clinical photo preview"
                className="mt-2 h-20 w-full rounded-lg object-cover ring-1 ring-slate-200"
              />
            ) : record?.photo_url ? (
              <a
                href={record.photo_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs font-semibold text-brand-800 underline-offset-2 hover:underline"
              >
                View current photo
              </a>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
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
              "Save record"
            )}
          </button>
        </div>
      </form>
      </Modal>

      <ConfirmDialog
        open={confirmDiscard}
        message="This record hasn't been saved yet. Closing the form discards what you've entered."
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}
