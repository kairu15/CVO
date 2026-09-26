import { useCallback, useEffect, useState } from "react";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { useAutoRefresh } from "../api/queries";
import { dispersalApi } from "../api/dispersalApi";
import { getErrorMessage } from "../api/client";
import { DispersalMap } from "../components/DispersalMap";
import { EmptyState } from "../components/EmptyState";
import { InlineAlert } from "../components/InlineAlert";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { Modal } from "../components/Modal";
import { TextField } from "../components/TextField";
import { useAuth } from "../context/AuthContext";
import { useBarangays } from "../hooks/useBarangays";

/**
 * "Dispersal Map" — every geo-tagged beneficiary on one map, for the roles
 * with city-wide or field oversight (admin, doctor, technician).
 *
 * Technicians additionally get the "Record re-dispersal" action: offspring of
 * an assigned beneficiary's animal is passed on to a new household, either an
 * existing beneficiary or one registered inline with its own geo-tag.
 */
export default function DispersalMapPage({ roleKey }) {
  const { user } = useAuth();
  const [barangays] = useBarangays();
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Re-dispersal modal state
  const [recordOpen, setRecordOpen] = useState(false);
  const [source, setSource] = useState("");
  const [form, setForm] = useState({
    new_name_of_farmer: "",
    new_address: "",
    new_animal_type: "",
    new_sex: "F",
    date_dispersed: "",
    remarks: "",
  });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const isTechnician = user?.role === "technician" || roleKey === "technician";

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const rows = await beneficiariesApi.list({ per_page: 500 });
      setBeneficiaries(rows ?? []);
    } catch (err) {
      if (!quiet) setError(getErrorMessage(err));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Quietly re-fetch so re-dispersals registered elsewhere appear without a
  // manual reload.
  useAutoRefresh(load);

  function update(field) {
    return (event) => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [field]: value }));
      setFormErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  async function submitReDispersal(event) {
    event.preventDefault();
    setFormErrors({});
    setNotice(null);

    const next = {};
    if (!source) next.source = "Select the beneficiary whose animal produced the offspring.";
    if (!form.new_name_of_farmer.trim()) next.new_name_of_farmer = "Enter the recipient's name.";
    if (!form.new_address.trim()) next.new_address = "Select the recipient's barangay.";
    if (!form.new_animal_type) next.new_animal_type = "Select the animal type.";
    if (Object.keys(next).length > 0) {
      setFormErrors(next);
      return;
    }

    setSubmitting(true);
    try {
      await dispersalApi.create({
        beneficiary_id: Number(source),
        parent_beneficiary_id: Number(source),
        dispersal_type: "re-dispersal",
        register_new: true,
        date_dispersed: form.date_dispersed || undefined,
        remarks: form.remarks.trim() || undefined,
        new_name_of_farmer: form.new_name_of_farmer.trim(),
        new_address: form.new_address.trim(),
        new_animal_type: form.new_animal_type,
        new_sex: form.new_sex,
      });
      setRecordOpen(false);
      setSource("");
      setForm({
        new_name_of_farmer: "",
        new_address: "",
        new_animal_type: "",
        new_sex: "F",
        date_dispersed: "",
        remarks: "",
      });
      setNotice("Re-dispersal recorded — the recipient now appears on the map.");
      await load();
    } catch (err) {
      setFormErrors({ form: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  const assignable = beneficiaries.filter((b) => b.technician_id === user?.id);

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Geo-Tagged Records</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Dispersal Map
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Every geo-tagged beneficiary in the program. Markers are colored
              by animal type; a full table view follows the map for
              accessibility.
            </p>
          </div>
          {isTechnician && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setRecordOpen(true)}
              disabled={assignable.length === 0}
              title={
                assignable.length === 0
                  ? "No beneficiaries are assigned to you yet"
                  : undefined
              }
            >
              Record re-dispersal
            </button>
          )}
        </div>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}
      {!error && notice && (
        <InlineAlert tone="success" message={notice} onDismiss={() => setNotice(null)} />
      )}

      <DispersalMap beneficiaries={beneficiaries} loading={loading} error={null} />

      {beneficiaries.length === 0 && !loading && !error && (
        <section className="card">
          <EmptyState
            title={
              isTechnician
                ? "No farmers assigned to you yet"
                : "Nothing to map yet"
            }
            description={
              isTechnician
                ? "You haven't been assigned any farmers. Contact an administrator to be assigned households to map."
                : "Geo-tagged beneficiaries appear here as soon as coordinates are captured in the field."
            }
          />
        </section>
      )}

      <Modal
        open={recordOpen}
        title="Record re-dispersal (pass-on)"
        onClose={() => setRecordOpen(false)}
      >
        <form onSubmit={submitReDispersal} noValidate className="space-y-3">
          {formErrors.form && <InlineAlert message={formErrors.form} />}

          <div>
            <label htmlFor="redispersal-source" className="block text-sm font-medium text-slate-700">
              Offspring of (your assigned beneficiary)
            </label>
            <select
              id="redispersal-source"
              className="field mt-1.5"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="">Select beneficiary…</option>
              {assignable.map((beneficiary) => (
                <option key={beneficiary.id} value={beneficiary.id}>
                  {beneficiary.name_of_farmer} — {beneficiary.address} ({beneficiary.animal_type})
                </option>
              ))}
            </select>
            {formErrors.source && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{formErrors.source}</p>
            )}
          </div>

          <TextField
            id="redispersal-recipient"
            label="New recipient — name of farmer"
            value={form.new_name_of_farmer}
            onChange={update("new_name_of_farmer")}
            error={formErrors.new_name_of_farmer}
          />          <div>
            <label htmlFor="redispersal-address" className="block text-sm font-medium text-slate-700">
              Recipient barangay
            </label>
            <select
              id="redispersal-address"
              className="field mt-1.5"
              value={form.new_address}
              onChange={update("new_address")}
            >
              <option value="">Select barangay…</option>
              {barangays.map((barangay) => (
                <option key={barangay.id ?? barangay.name} value={barangay.name}>
                  {barangay.name}
                </option>
              ))}
            </select>
            {formErrors.new_address && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{formErrors.new_address}</p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="redispersal-animal" className="block text-sm font-medium text-slate-700">
                Animal type
              </label>
              <select
                id="redispersal-animal"
                className="field mt-1.5"
                value={form.new_animal_type}
                onChange={update("new_animal_type")}
              >
                <option value="">Select animal…</option>
                <option>Carabao</option>
                <option>Cattle</option>
                <option>Goat</option>
                <option>Swine</option>
                <option>Boar</option>
              </select>
              {formErrors.new_animal_type && (
                <p className="mt-1.5 text-xs font-medium text-red-600">
                  {formErrors.new_animal_type}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="redispersal-sex" className="block text-sm font-medium text-slate-700">
                Sex of animal
              </label>
              <select
                id="redispersal-sex"
                className="field mt-1.5"
                value={form.new_sex}
                onChange={update("new_sex")}
              >
                <option value="F">Female (F)</option>
                <option value="M">Male (M)</option>
              </select>
            </div>
          </div>

          <TextField
            id="redispersal-date"
            label="Date dispersed"
            type="date"
            value={form.date_dispersed}
            onChange={update("date_dispersed")}
            error={formErrors.date_dispersed}
          />

          <TextField
            id="redispersal-remarks"
            label="Remarks"
            value={form.remarks}
            onChange={update("remarks")}
            error={formErrors.remarks}
          />

          <p className="text-xs text-slate-500">
            The recipient household is registered with the animal type above;
            its map pin is placed automatically from the chosen barangay.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setRecordOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? (
                <>
                  <ButtonSpinner />
                  Saving…
                </>
              ) : (
                "Record re-dispersal"
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
