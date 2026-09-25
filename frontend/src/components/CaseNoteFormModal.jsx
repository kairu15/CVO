import { useEffect, useMemo, useState } from "react";
import { caseNotesApi } from "../api/caseNotesApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Modal } from "./Modal";
import { ButtonSpinner } from "./LoadingSpinner";
import { TextField } from "./TextField";
import { Icon } from "./Icons";

const EMPTY_FORM = {
  date_noted: "",
  body: "",
};

/**
 * Veterinarian's case note form.
 *
 * Deliberately plainer than the health record form: this is freeform text, and
 * asking for a diagnosis here would push observations out of the note and into
 * a clinical record where they do not belong.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose called after a successful save or cancel
 * @param {Array<object>} props.beneficiaries picker options (create mode)
 * @param {object} [props.note] existing note to edit
 * @param {() => void} props.onSaved
 */
export function CaseNoteFormModal({ open, onClose, beneficiaries = [], note = null, onSaved }) {
  const editing = Boolean(note);

  const [form, setForm] = useState(EMPTY_FORM);
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const toast = useToast();
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const beneficiary = useMemo(
    () => beneficiaries.find((b) => String(b.id) === String(beneficiaryId)) ?? note ?? null,
    [beneficiaries, beneficiaryId, note],
  );

  useEffect(() => {
    if (!open) return;

    if (note) {
      setForm({
        date_noted: note.date_noted ?? "",
        body: note.body ?? "",
      });
      setBeneficiaryId(String(note.beneficiary_id));
    } else {
      setForm({ ...EMPTY_FORM, date_noted: new Date().toISOString().slice(0, 10) });
      setBeneficiaryId(beneficiaries.length === 1 ? String(beneficiaries[0].id) : "");
    }

    setErrors({});
  }, [open, note, beneficiaries]);

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
      setErrors((prev) => ({ ...prev, beneficiary_id: "Choose the animal this note is about." }));
      return;
    }
    if (!form.date_noted) {
      setErrors((prev) => ({ ...prev, date_noted: "Enter the date of the note." }));
      return;
    }
    if (!form.body.trim()) {
      setErrors((prev) => ({ ...prev, body: "Write the note." }));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        date_noted: form.date_noted,
        body: form.body.trim(),
      };

      if (editing) {
        await caseNotesApi.update(note.id, payload);
      } else {
        await caseNotesApi.create({ ...payload, beneficiary_id: Number(beneficiaryId) });
      }

      toast.success(editing ? "Case note updated." : "Case note created.");
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
    <Modal open={open} title={editing ? "Edit case note" : "New case note"} onClose={onClose}>
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

        {!editing && (
          <div className="mt-4">
            <label
              htmlFor="note-beneficiary"
              className="block text-sm font-medium text-slate-700"
            >
              Beneficiary
            </label>
            <select
              id="note-beneficiary"
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

        <div className="mt-4">
          <TextField
            id="note-date"
            label="Date of note"
            type="date"
            value={form.date_noted}
            onChange={update("date_noted")}
            error={errors.date_noted}
            className="sm:w-1/2"
          />
        </div>

        <div className="mt-3">
          <label htmlFor="note-body" className="block text-sm font-medium text-slate-700">
            Note
          </label>
          <textarea
            id="note-body"
            rows={6}
            className="field mt-1.5"
            placeholder="e.g. Owner phoned — animal still limping, advised rest for a week."
            value={form.body}
            onChange={update("body")}
            aria-describedby="note-body-hint"
          />
          {errors.body ? (
            <p className="mt-1.5 text-xs font-medium text-red-600">{errors.body}</p>
          ) : (
            <p id="note-body-hint" className="mt-1.5 text-xs text-slate-500">
              Observations, advice given or referrals. A confirmed diagnosis goes in
              Health Records instead.
            </p>
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
              "Save note"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
