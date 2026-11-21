import { useEffect, useRef, useState } from "react";
import { vaccinationApi } from "../api/vaccinationApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { useToast } from "../context/ToastContext";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { Modal } from "./Modal";
import { ConfirmDialog } from "./ConfirmDialog";
import { ButtonSpinner } from "./LoadingSpinner";
import { TextField } from "./TextField";
import { Icon } from "./Icons";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(value, days) {
  if (!value || !Number.isFinite(Number(days))) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + Number(days));

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function initialForm(row, protocolDays) {
  const administered = today();
  const days = Number(protocolDays) || 180;

  return {
    vaccine_name: row?.vaccine_name ?? "",
    administered_on: administered,
    quantity: row?.quantity ?? 1,
    batch_number: "",
    protocol_days: days,
    next_due_on: addDays(administered, days),
    notes: "",
  };
}

/**
 * Quick completed-vaccination entry, opened with a schedule row already
 * selected. The household identity is read-only; the only facts the
 * technician supplies are the dose facts and the protocol interval.
 */
export function VaccinationRecordModal({
  open,
  onClose,
  row,
  protocolDays = 180,
  vaccineNames = [],
  onSaved,
}) {
  const toast = useToast();
  const [form, setForm] = useState(() => initialForm(row, protocolDays));
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const seededRef = useRef(null);
  const savingRef = useRef(false);
  const nextDueTouchedRef = useRef(false);

  useUnsavedChangesGuard({ when: open && dirty && !saving });

  useEffect(() => {
    if (!open) {
      seededRef.current = null;
      return;
    }

    const key = row ? `row:${row.id}` : "closed";
    if (seededRef.current === key) return;
    seededRef.current = key;
    nextDueTouchedRef.current = false;
    setForm(initialForm(row, protocolDays));
    setPhoto(null);
    setErrors({});
    setDirty(false);
    setConfirmDiscard(false);
  }, [open, row, protocolDays]);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return undefined;
    }

    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function update(field, value) {
    setForm((previous) => {
      const next = { ...previous, [field]: value };

      if ((field === "administered_on" || field === "protocol_days") && !nextDueTouchedRef.current) {
        next.next_due_on = addDays(next.administered_on, next.protocol_days);
      }

      return next;
    });
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setDirty(true);
  }

  function requestClose() {
    if (dirty && !saving) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (savingRef.current) return;

    if (!form.vaccine_name.trim()) {
      setErrors((previous) => ({ ...previous, vaccine_name: "Enter the vaccine administered." }));
      return;
    }
    if (!form.administered_on) {
      setErrors((previous) => ({ ...previous, administered_on: "Enter the administration date." }));
      return;
    }
    if (!Number(form.quantity) || Number(form.quantity) < 1) {
      setErrors((previous) => ({ ...previous, quantity: "Enter at least one animal vaccinated." }));
      return;
    }
    if (!Number(form.protocol_days) || Number(form.protocol_days) < 1) {
      setErrors((previous) => ({ ...previous, protocol_days: "Enter the protocol interval in days." }));
      return;
    }
    if (!form.next_due_on || form.next_due_on <= form.administered_on) {
      setErrors((previous) => ({
        ...previous,
        next_due_on: "The next dose must be after this administration.",
      }));
      return;
    }

    savingRef.current = true;
    setSaving(true);

    try {
      const saved = await vaccinationApi.create({
        beneficiary_id: row.id,
        vaccine_name: form.vaccine_name.trim(),
        administered_on: form.administered_on,
        quantity: Number(form.quantity),
        batch_number: form.batch_number.trim() || null,
        protocol_days: Number(form.protocol_days),
        next_due_on: form.next_due_on,
        notes: form.notes.trim() || null,
      });

      if (photo && saved?.id) {
        try {
          await vaccinationApi.uploadPhoto(saved.id, photo);
        } catch (photoError) {
          toast.error(
            `Vaccination saved, but the photo could not be uploaded: ${getErrorMessage(photoError)}`,
          );
        }
      }

      toast.success("Vaccination recorded.");
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
      <Modal open={open} title="Record vaccination" onClose={requestClose}>
        <form onSubmit={handleSubmit} noValidate>
          <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-brand-800 uppercase">
              <Icon name="lock" className="h-3.5 w-3.5" />
              Household — read-only
            </p>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
              {[
                ["Farmer", row?.name_of_farmer],
                ["Barangay", row?.barangay ?? row?.address],
                ["Animal", row?.animal_type],
                ["Last vaccine", row?.vaccine_name || "None on record"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">{value || "—"}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
              Dose administered
            </p>
          </div>

          <div className="mt-3">
            <TextField
              id="vaccine-name"
              label="Vaccine administered"
              list="known-vaccines"
              placeholder="e.g. Anti-Rabies"
              value={form.vaccine_name}
              onChange={(event) => update("vaccine_name", event.target.value)}
              error={errors.vaccine_name}
            />
            <datalist id="known-vaccines">
              {[...new Set([...(vaccineNames ?? []), "Anti-Rabies"])].map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <TextField
              id="vaccine-date"
              label="Administration date"
              type="date"
              max={today()}
              value={form.administered_on}
              onChange={(event) => update("administered_on", event.target.value)}
              error={errors.administered_on}
            />
            <TextField
              id="vaccine-quantity"
              label="Animals vaccinated"
              type="number"
              min="1"
              max="1000"
              value={form.quantity}
              onChange={(event) => update("quantity", event.target.value)}
              error={errors.quantity}
            />
            <TextField
              id="vaccine-batch"
              label="Batch / lot number"
              placeholder="Optional"
              value={form.batch_number}
              onChange={(event) => update("batch_number", event.target.value)}
              error={errors.batch_number}
            />
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
              Follow-up protocol
            </p>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <TextField
              id="vaccine-protocol"
              label="Protocol interval (days)"
              type="number"
              min="1"
              max="3650"
              value={form.protocol_days}
              onChange={(event) => update("protocol_days", event.target.value)}
              error={errors.protocol_days}
              hint="Defaults to the program cycle; adjust for this vaccine."
            />
            <TextField
              id="vaccine-next-due"
              label="Next dose due"
              type="date"
              value={form.next_due_on}
              onChange={(event) => {
                nextDueTouchedRef.current = true;
                update("next_due_on", event.target.value);
              }}
              error={errors.next_due_on}
              hint="You can reschedule this later without editing the history."
            />
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            Partial coverage? Record the number actually vaccinated and set the next dose date for the
            remaining animals.
          </p>

          <div className="mt-4">
            <label htmlFor="vaccine-notes" className="block text-sm font-medium text-slate-700">
              Notes
            </label>
            <textarea
              id="vaccine-notes"
              rows={2}
              className="field mt-1.5"
              placeholder="Reactions, remaining animals, or field notes"
              value={form.notes}
              onChange={(event) => update("notes", event.target.value)}
            />
            {errors.notes && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{errors.notes}</p>
            )}
          </div>

          <div className="mt-3">
            <label htmlFor="vaccine-photo" className="block text-sm font-medium text-slate-700">
              Supporting photo
            </label>
            <input
              id="vaccine-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(event) => {
                setPhoto(event.target.files?.[0] ?? null);
                setDirty(true);
              }}
              className="mt-1.5 block w-full text-xs text-slate-600 file:mr-3 file:rounded-pill file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-brand-800 hover:file:bg-brand-100"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Optional. JPG, PNG or WebP, up to 8 MB.
            </p>
            {photoPreview && (
              <img
                src={photoPreview}
                alt="Selected vaccination photo preview"
                className="mt-2 h-20 w-full rounded-lg object-cover ring-1 ring-slate-200"
              />
            )}
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
              ) : (
                "Save vaccination"
              )}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDiscard}
        message="This vaccination hasn't been saved yet. Closing the form discards what you've entered."
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}
