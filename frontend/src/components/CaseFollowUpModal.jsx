import { useEffect, useRef, useState } from "react";
import { caseNotesApi } from "../api/caseNotesApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { useToast } from "../context/ToastContext";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { Modal } from "./Modal";
import { ConfirmDialog } from "./ConfirmDialog";
import { ButtonSpinner } from "./LoadingSpinner";
import { TextField } from "./TextField";
import {
  CASE_STATUS_LABELS,
  caseCategoryLabel,
  caseFollowUpLabel,
  formatCaseDate,
} from "../lib/caseLabels";

const EMPTY_FORM = {
  happened_on: "",
  observations: "",
  actions_taken: "",
  recommendations: "",
  status: "",
  follow_up_on: "",
  health_record_id: "",
  field_visit_id: "",
};

/**
 * Append a follow-up observation to a case.
 *
 * This is deliberately not the edit form: it never rewrites the original case
 * or an earlier timeline entry. It may also record the resulting status and
 * the next follow-up date, which are mirrored onto the case row.
 */
export function CaseFollowUpModal({ open, caseDetail, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [completed, setCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const seededRef = useRef(null);
  const toast = useToast();

  useUnsavedChangesGuard({ when: open && dirty && !saving });

  useEffect(() => {
    if (!open || !caseDetail) {
      if (!open) seededRef.current = null;
      return;
    }

    const key = `case-update:${caseDetail.id}`;
    if (seededRef.current === key) return;
    seededRef.current = key;

    setForm({
      ...EMPTY_FORM,
      happened_on: new Date().toISOString().slice(0, 10),
      follow_up_on: caseDetail.follow_up_on ?? "",
    });
    setCompleted(false);
    setErrors({});
    setDirty(false);
    setConfirmDiscard(false);
  }, [open, caseDetail]);

  function update(field) {
    return (event) => {
      setForm((previous) => ({ ...previous, [field]: event.target.value }));
      setErrors((previous) => ({ ...previous, [field]: undefined }));
      setDirty(true);
    };
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
    if (savingRef.current || !caseDetail) return;

    if (!form.happened_on) {
      setErrors({ happened_on: "Enter the date of this update." });
      return;
    }

    const changedFollowUp =
      (form.follow_up_on || "") !== (caseDetail.follow_up_on || "") || completed;
    const hasContent = [form.observations, form.actions_taken, form.recommendations].some(
      (value) => value.trim() !== "",
    );

    if (!hasContent && !form.status && !changedFollowUp) {
      setErrors({
        observations: "Add an observation, action, status or follow-up change.",
      });
      return;
    }

    savingRef.current = true;
    setSaving(true);

    try {
      await caseNotesApi.addUpdate(caseDetail.id, {
        happened_on: form.happened_on,
        observations: form.observations.trim() || null,
        actions_taken: form.actions_taken.trim() || null,
        recommendations: form.recommendations.trim() || null,
        status: form.status || null,
        follow_up_on: form.follow_up_on || null,
        follow_up_completed: completed ? true : undefined,
        health_record_id: form.health_record_id ? Number(form.health_record_id) : null,
        field_visit_id: form.field_visit_id ? Number(form.field_visit_id) : null,
      });

      toast.success("Follow-up added to the case.");
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

  const relatedHealth = caseDetail?.related_health_records ?? [];
  const relatedVisits = caseDetail?.related_field_visits ?? [];

  return (
    <>
      <Modal
        open={open}
        title="Add follow-up note"
        onClose={requestClose}
        contentClassName="max-w-2xl"
      >
        {caseDetail && (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                    {caseDetail.reference_number ?? "Case"}
                  </p>
                  <p className="mt-1 font-display text-sm font-bold text-slate-900">
                    {caseDetail.name_of_farmer}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {caseCategoryLabel(caseDetail.category)} · {caseDetail.animal_type}
                    {caseDetail.sex ? ` (${caseDetail.sex})` : ""} · {caseDetail.address}
                  </p>
                </div>
                <div className="text-right">
                  <span className="rounded-pill bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200">
                    {CASE_STATUS_LABELS[caseDetail.status] ?? caseDetail.status}
                  </span>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Follow-up: {caseFollowUpLabel(caseDetail.follow_up_status)}
                    {caseDetail.follow_up_on ? ` · ${formatCaseDate(caseDetail.follow_up_on)}` : ""}
                  </p>
                </div>
              </div>
            </div>

            <TextField
              id="update-date"
              label="Update date"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={form.happened_on}
              onChange={update("happened_on")}
              error={errors.happened_on}
              className="sm:w-1/2"
            />

            <div>
              <label htmlFor="update-observations" className="block text-sm font-medium text-slate-700">
                Follow-up observations
              </label>
              <textarea
                id="update-observations"
                rows={4}
                className="field mt-1.5"
                value={form.observations}
                onChange={update("observations")}
                placeholder="What changed since the last entry?"
              />
              {errors.observations && (
                <p className="mt-1.5 text-xs font-medium text-red-600">{errors.observations}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="update-actions" className="block text-sm font-medium text-slate-700">
                  Actions taken
                </label>
                <textarea
                  id="update-actions"
                  rows={3}
                  className="field mt-1.5"
                  value={form.actions_taken}
                  onChange={update("actions_taken")}
                  placeholder="Treatment or advice given during this follow-up."
                />
              </div>
              <div>
                <label htmlFor="update-recommendations" className="block text-sm font-medium text-slate-700">
                  Recommendations
                </label>
                <textarea
                  id="update-recommendations"
                  rows={3}
                  className="field mt-1.5"
                  value={form.recommendations}
                  onChange={update("recommendations")}
                  placeholder="What should happen next?"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="update-status" className="block text-sm font-medium text-slate-700">
                  Case status
                </label>
                <select
                  id="update-status"
                  className="field mt-1.5"
                  value={form.status}
                  onChange={update("status")}
                >
                  <option value="">No status change</option>
                  <option value="open">Open</option>
                  <option value="observation">Under observation</option>
                  <option value="resolved">Resolved</option>
                </select>
                {errors.status && (
                  <p className="mt-1.5 text-xs font-medium text-red-600">{errors.status}</p>
                )}
              </div>

              <TextField
                id="update-follow-up"
                label="Next follow-up"
                type="date"
                value={form.follow_up_on}
                onChange={update("follow_up_on")}
                error={errors.follow_up_on}
                hint="Leave blank to clear the scheduled follow-up."
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="update-health-record" className="block text-sm font-medium text-slate-700">
                  Link a health examination
                </label>
                <select
                  id="update-health-record"
                  className="field mt-1.5"
                  value={form.health_record_id}
                  onChange={update("health_record_id")}
                >
                  <option value="">No linked examination</option>
                  {relatedHealth.map((record) => (
                    <option key={record.id} value={record.id}>
                      {formatCaseDate(record.date_recorded)} — {record.diagnosis}
                    </option>
                  ))}
                </select>
                {errors.health_record_id && (
                  <p className="mt-1.5 text-xs font-medium text-red-600">
                    {errors.health_record_id}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="update-field-visit" className="block text-sm font-medium text-slate-700">
                  Link a field visit
                </label>
                <select
                  id="update-field-visit"
                  className="field mt-1.5"
                  value={form.field_visit_id}
                  onChange={update("field_visit_id")}
                >
                  <option value="">No linked visit</option>
                  {relatedVisits.map((visit) => (
                    <option key={visit.id} value={visit.id}>
                      {formatCaseDate(visit.visited_on)} — {visit.purpose?.replace("-", " ")}
                    </option>
                  ))}
                </select>
                {errors.field_visit_id && (
                  <p className="mt-1.5 text-xs font-medium text-red-600">{errors.field_visit_id}</p>
                )}
              </div>
            </div>

            <label className="flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50/60 p-3 text-xs text-brand-900">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded accent-brand-700"
                checked={completed}
                onChange={(event) => {
                  setCompleted(event.target.checked);
                  setDirty(true);
                }}
              />
              <span>
                <span className="font-semibold">Mark this follow-up complete.</span>{" "}
                The case keeps its full history; only the follow-up status changes.
              </span>
            </label>

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={requestClose} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? (
                  <>
                    <ButtonSpinner />
                    Saving…
                  </>
                ) : (
                  "Add follow-up"
                )}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDiscard}
        message="This follow-up note hasn't been saved yet. Closing it discards what you've entered."
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}
