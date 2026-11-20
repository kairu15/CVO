import { useEffect, useMemo, useState } from "react";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { technicianApi } from "../api/technicianApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToast } from "../context/ToastContext";
import { Modal } from "./Modal";
import { ButtonSpinner } from "./LoadingSpinner";
import { TextField } from "./TextField";
import { Icon } from "./Icons";

const today = () => new Date().toISOString().slice(0, 10);
const NO_PURPOSES = [];

/**
 * Plan a field visit for one of the signed-in technician's assigned
 * households. The server enforces the assignment and rejects a duplicate open
 * plan for the same household on the same day.
 */
export function PlanVisitModal({ open, onClose, onSaved, purposes = NO_PURPOSES, initialBeneficiary = null }) {
  const toast = useToast();
  const [beneficiaries, setBeneficiaries] = useState([]);
  // The modal is mounted per open (see TechnicianDashboard), so these initial
  // values are also the reset values.
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [form, setForm] = useState({
    beneficiary_id: initialBeneficiary?.id ? String(initialBeneficiary.id) : "",
    planned_for: today(),
    purpose: purposes[0] ?? "",
    notes: "",
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return undefined;

    let active = true;

    beneficiariesApi
      .list({
        assigned: 1,
        per_page: 50,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      })
      .then((rows) => {
        if (active) {
          setBeneficiaries(Array.isArray(rows) ? rows : []);
          setErrors((current) => ({ ...current, beneficiary_id: undefined }));
        }
      })
      .catch((err) => {
        if (active) setErrors((current) => ({ ...current, beneficiary_id: getErrorMessage(err) }));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, debouncedSearch]);

  const options = useMemo(() => {
    const map = new Map(beneficiaries.map((row) => [String(row.id), row]));
    if (initialBeneficiary) map.set(String(initialBeneficiary.id), initialBeneficiary);
    return [...map.values()];
  }, [beneficiaries, initialBeneficiary]);

  function update(field) {
    return (event) => {
      setForm((current) => ({ ...current, [field]: event.target.value }));
      setErrors((current) => ({ ...current, [field]: undefined }));
    };
  }

  async function submit(event) {
    event.preventDefault();

    const next = {};
    if (!form.beneficiary_id) next.beneficiary_id = "Choose a household.";
    if (!form.planned_for) next.planned_for = "Choose the planned date.";
    if (!form.purpose) next.purpose = "Choose the purpose.";

    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }

    setSaving(true);
    try {
      await technicianApi.createPlan({
        beneficiary_id: Number(form.beneficiary_id),
        planned_for: form.planned_for,
        purpose: form.purpose,
        notes: form.notes.trim() || null,
      });
      toast.success("Visit planned.");
      onSaved?.();
      onClose();
    } catch (err) {
      const fields = getFieldErrors(err);
      if (fields) setErrors(fields);
      else toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Plan a field visit" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div>
          <label htmlFor="plan-beneficiary-search" className="block text-sm font-medium text-slate-700">
            Find an assigned household
          </label>
          <div className="relative mt-1.5">
            <Icon
              name="search"
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <input
              id="plan-beneficiary-search"
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setLoading(true);
              }}
              placeholder="Name, RSBSA or ear tag"
              className="field pl-9"
            />
          </div>

          <label htmlFor="plan-beneficiary" className="mt-3 block text-sm font-medium text-slate-700">
            Household
          </label>
          <select
            id="plan-beneficiary"
            value={form.beneficiary_id}
            onChange={update("beneficiary_id")}
            className="field mt-1.5"
          >
            <option value="">{loading ? "Loading assigned households…" : "Select a household…"}</option>
            {options.map((household) => (
              <option key={household.id} value={household.id}>
                {[household.name_of_farmer, household.animal_type, household.address]
                  .filter(Boolean)
                  .join(" · ")}
              </option>
            ))}
          </select>
          {errors.beneficiary_id && (
            <p className="mt-1.5 text-xs font-medium text-red-600">{errors.beneficiary_id}</p>
          )}
          {!loading && options.length === 0 && (
            <p className="mt-1.5 text-xs text-slate-500">
              No assigned households match. Ask an administrator to assign one first.
            </p>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <TextField
            id="plan-date"
            label="Planned date"
            type="date"
            min={today()}
            value={form.planned_for}
            onChange={update("planned_for")}
            error={errors.planned_for}
          />
          <div>
            <label htmlFor="plan-purpose" className="block text-sm font-medium text-slate-700">
              Purpose
            </label>
            <select
              id="plan-purpose"
              value={form.purpose}
              onChange={update("purpose")}
              className="field mt-1.5"
            >
              <option value="">Select a purpose…</option>
              {purposes.map((purpose) => (
                <option key={purpose} value={purpose}>
                  {purpose.charAt(0).toUpperCase() + purpose.slice(1).replace(/-/g, " ")}
                </option>
              ))}
            </select>
            {errors.purpose && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{errors.purpose}</p>
            )}
          </div>
        </div>

        <label htmlFor="plan-notes" className="mt-4 block text-sm font-medium text-slate-700">
          Notes (optional)
        </label>
        <textarea
          id="plan-notes"
          rows={3}
          value={form.notes}
          onChange={update("notes")}
          placeholder="e.g. Bring the vaccination record."
          className="field mt-1.5"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? (
              <>
                <ButtonSpinner /> Saving…
              </>
            ) : (
              "Plan visit"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
