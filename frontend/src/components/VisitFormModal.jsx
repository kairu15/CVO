import { useEffect, useMemo, useState } from "react";
import { monitoringApi } from "../api/monitoringApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { Modal } from "./Modal";
import { ButtonSpinner } from "./LoadingSpinner";
import { TextField } from "./TextField";
import { Icon } from "./Icons";

const EMPTY_FORM = {
  date_monitored: "",
  date_vits_supp: "",
  deworming_date: "",
  vaccination_date: "",
  date_breed: "",
  date_calved: "",
  bcs: "",
  farmers_signature: "",
  remarks: "",
};

const DATE_FIELDS = [
  ["date_monitored", "Date monitored"],
  ["date_vits_supp", "Date of Vits Supp."],
  ["deworming_date", "Deworming"],
  ["vaccination_date", "Vaccination"],
  ["date_breed", "Date Breed"],
  ["date_calved", "Date Calved"],
];

/**
 * Technician's "Log a Visit" form.
 *
 * The four identity fields (name of farmer, address, animal type, sex) render
 * read-only from the beneficiary record — the technician only fills the
 * visit-specific fields, exactly like the paper form except the first four
 * columns can never be retyped.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose called after a successful save or cancel
 * @param {Array<object>} props.beneficiaries assigned beneficiaries for the picker (create mode)
 * @param {object} [props.record] existing record to edit (identity fields still read-only)
 * @param {() => void} props.onSaved
 */
export function VisitFormModal({ open, onClose, beneficiaries = [], record = null, onSaved }) {
  const editing = Boolean(record);

  const [form, setForm] = useState(EMPTY_FORM);
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const beneficiary = useMemo(
    () => beneficiaries.find((b) => String(b.id) === String(beneficiaryId)) ?? record?.beneficiary ?? null,
    [beneficiaries, beneficiaryId, record],
  );

  useEffect(() => {
    if (!open) return;

    if (record) {
      setForm({
        date_monitored: record.date_monitored ?? "",
        date_vits_supp: record.date_vits_supp ?? "",
        deworming_date: record.deworming_date ?? "",
        vaccination_date: record.vaccination_date ?? "",
        date_breed: record.date_breed ?? "",
        date_calved: record.date_calved ?? "",
        bcs: record.bcs ?? "",
        farmers_signature: record.farmers_signature ?? "",
        remarks: record.remarks ?? "",
      });
      setBeneficiaryId(String(record.beneficiary_id));
    } else {
      setForm({ ...EMPTY_FORM, date_monitored: new Date().toISOString().slice(0, 10) });
      setBeneficiaryId(beneficiaries.length === 1 ? String(beneficiaries[0].id) : "");
    }

    setErrors({});
    setFormError(null);
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
    setFormError(null);

    if (!editing && !beneficiaryId) {
      setErrors((prev) => ({ ...prev, beneficiary_id: "Choose the beneficiary visited." }));
      return;
    }
    if (!form.date_monitored) {
      setErrors((prev) => ({ ...prev, date_monitored: "Enter the visit date." }));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        bcs: form.bcs === "" ? null : Number(form.bcs),
      };

      if (editing) {
        await monitoringApi.update(record.id, payload);
      } else {
        await monitoringApi.create({ ...payload, beneficiary_id: Number(beneficiaryId) });
      }

      onSaved?.();
      onClose();
    } catch (error) {
      const fields = getFieldErrors(error);
      if (fields) setErrors(fields);
      else setFormError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title={editing ? "Edit monitoring entry" : "Add monitoring record"} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        {/* Identity block — read-only, from the beneficiary record. */}
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

        {formError && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
          >
            {formError}
          </div>
        )}

        {!editing && (
          <div className="mt-4">
            <label htmlFor="visit-beneficiary" className="block text-sm font-medium text-slate-700">
              Beneficiary visited
            </label>
            <select
              id="visit-beneficiary"
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
          {DATE_FIELDS.map(([field, label]) => (
            <TextField
              key={field}
              id={`visit-${field}`}
              label={label}
              type="date"
              value={form[field]}
              onChange={update(field)}
              error={errors[field]}
            />
          ))}

          <TextField
            id="visit-bcs"
            label="BCS (1–5)"
            type="number"
            min="1"
            max="5"
            placeholder="3"
            value={form.bcs}
            onChange={update("bcs")}
            error={errors.bcs}
          />

          <TextField
            id="visit-signature"
            label="Farmer's signature"
            type="text"
            placeholder="Typed confirmation"
            value={form.farmers_signature}
            onChange={update("farmers_signature")}
            error={errors.farmers_signature}
            hint="Name of the farmer confirming the visit."
          />
        </div>

        <div className="mt-3">
          <label htmlFor="visit-remarks" className="block text-sm font-medium text-slate-700">
            Remarks
          </label>
          <textarea
            id="visit-remarks"
            rows={3}
            className="field mt-1.5"
            placeholder='e.g. "Healthy"'
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
              "Log visit"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
