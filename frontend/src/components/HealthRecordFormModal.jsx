import { useEffect, useMemo, useState } from "react";
import { healthRecordsApi } from "../api/healthRecordsApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Modal } from "./Modal";
import { ButtonSpinner } from "./LoadingSpinner";
import { TextField } from "./TextField";
import { Icon } from "./Icons";

/** `ongoing` → `Ongoing`. */
export const outcomeLabel = (value) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : "—";

const EMPTY_FORM = {
  date_recorded: "",
  diagnosis: "",
  treatment: "",
  outcome: "",
  remarks: "",
};

/**
 * Veterinarian's health record form.
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
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const beneficiary = useMemo(
    () =>
      beneficiaries.find((b) => String(b.id) === String(beneficiaryId)) ??
      record ??
      null,
    [beneficiaries, beneficiaryId, record],
  );

  useEffect(() => {
    if (!open) return;

    if (record) {
      setForm({
        date_recorded: record.date_recorded ?? "",
        diagnosis: record.diagnosis ?? "",
        treatment: record.treatment ?? "",
        outcome: record.outcome ?? "",
        remarks: record.remarks ?? "",
      });
      setBeneficiaryId(String(record.beneficiary_id));
    } else {
      setForm({ ...EMPTY_FORM, date_recorded: new Date().toISOString().slice(0, 10) });
      setBeneficiaryId(beneficiaries.length === 1 ? String(beneficiaries[0].id) : "");
    }

    setErrors({});
  }, [open, record, beneficiaries]);

  function update(field) {
    return (event) => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();

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

    setSaving(true);
    try {
      // Empty optional fields go up as null so a cleared field actually clears
      // rather than being ignored by the server's `nullable` rule.
      const payload = {
        date_recorded: form.date_recorded,
        diagnosis: form.diagnosis.trim(),
        treatment: form.treatment.trim() || null,
        outcome: form.outcome || null,
        remarks: form.remarks.trim() || null,
      };

      if (editing) {
        await healthRecordsApi.update(record.id, payload);
      } else {
        await healthRecordsApi.create({ ...payload, beneficiary_id: Number(beneficiaryId) });
      }

      toast.success(editing ? "Health record updated." : "Health record created.");
      onSaved?.();
      onClose();
    } catch (error) {
      const fields = getFieldErrors(error);
      if (fields) setErrors(fields);
      else toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={editing ? "Edit health record" : "New health record"}
      onClose={onClose}
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

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <TextField
            id="health-date"
            label="Date of examination"
            type="date"
            value={form.date_recorded}
            onChange={update("date_recorded")}
            error={errors.date_recorded}
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
        </div>

        <div className="mt-3">
          <label htmlFor="health-remarks" className="block text-sm font-medium text-slate-700">
            Remarks
          </label>
          <textarea
            id="health-remarks"
            rows={2}
            className="field mt-1.5"
            placeholder="Follow-up notes"
            value={form.remarks}
            onChange={update("remarks")}
          />
          {errors.remarks && (
            <p className="mt-1.5 text-xs font-medium text-red-600">{errors.remarks}</p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
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
  );
}
