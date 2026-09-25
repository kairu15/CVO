import { useEffect, useMemo, useState } from "react";
import { fieldVisitsApi } from "../api/fieldVisitsApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Modal } from "./Modal";
import { ButtonSpinner } from "./LoadingSpinner";
import { TextField } from "./TextField";
import { Icon } from "./Icons";

/** `routine-monitoring` → `Routine monitoring`. */
export const purposeLabel = (value) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/-/g, " ") : "—";

const EMPTY_FORM = {
  visited_on: "",
  purpose: "",
  notes: "",
};

/**
 * Technician's "Log a Visit" form.
 *
 * Captures the trip, not the animal: purpose and an optional on-site GPS fix.
 * There is deliberately no GPS map here — the technician is standing in the
 * field, so a single "capture my position" button is the whole interaction,
 * and it keeps the heavy MapLibre chunk off this page.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose called after a successful save or cancel
 * @param {Array<object>} props.beneficiaries assigned beneficiaries for the picker
 * @param {Array<string>} props.purposes served vocabulary for the purpose select
 * @param {object} [props.visit] existing visit to edit
 * @param {() => void} props.onSaved
 */
export function FieldVisitFormModal({
  open,
  onClose,
  beneficiaries = [],
  purposes = [],
  visit = null,
  onSaved,
}) {
  const editing = Boolean(visit);

  const [form, setForm] = useState(EMPTY_FORM);
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const [coords, setCoords] = useState(null); // [lat, lng]
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState(null);
  const toast = useToast();
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const beneficiary = useMemo(
    () =>
      beneficiaries.find((b) => String(b.id) === String(beneficiaryId)) ??
      visit ??
      null,
    [beneficiaries, beneficiaryId, visit],
  );

  useEffect(() => {
    if (!open) return;

    if (visit) {
      setForm({
        visited_on: visit.visited_on ?? "",
        purpose: visit.purpose ?? "",
        notes: visit.notes ?? "",
      });
      setBeneficiaryId(String(visit.beneficiary_id));
      setCoords(
        visit.latitude !== null && visit.longitude !== null
          ? [visit.latitude, visit.longitude]
          : null,
      );
    } else {
      setForm({ ...EMPTY_FORM, visited_on: new Date().toISOString().slice(0, 10) });
      setBeneficiaryId(beneficiaries.length === 1 ? String(beneficiaries[0].id) : "");
      setCoords(null);
    }

    setLocationNote(null);
    setErrors({});
  }, [open, visit, beneficiaries]);

  function update(field) {
    return (event) => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  /** Same options as CoordinatePicker uses, so behaviour is consistent. */
  function captureLocation() {
    if (!("geolocation" in navigator)) {
      setLocationNote({ tone: "error", text: "Geolocation is not available in this browser." });
      return;
    }

    setLocating(true);
    setLocationNote(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords([position.coords.latitude, position.coords.longitude]);
        setLocationNote({ tone: "ok", text: "GPS position captured on site." });
        setLocating(false);
      },
      () => {
        setLocationNote({
          tone: "error",
          text: "Could not get your position. The visit can still be logged without it.",
        });
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!editing && !beneficiaryId) {
      setErrors((prev) => ({ ...prev, beneficiary_id: "Choose the beneficiary visited." }));
      return;
    }
    if (!form.visited_on) {
      setErrors((prev) => ({ ...prev, visited_on: "Enter the visit date." }));
      return;
    }
    if (!form.purpose) {
      setErrors((prev) => ({ ...prev, purpose: "Choose why you went out." }));
      return;
    }

    setSaving(true);
    try {
      // Sent as a pair or not at all — the API rejects a half-captured fix.
      const payload = {
        visited_on: form.visited_on,
        purpose: form.purpose,
        notes: form.notes.trim() || null,
        latitude: coords?.[0] ?? null,
        longitude: coords?.[1] ?? null,
      };

      if (editing) {
        await fieldVisitsApi.update(visit.id, payload);
      } else {
        await fieldVisitsApi.create({ ...payload, beneficiary_id: Number(beneficiaryId) });
      }

      toast.success(editing ? "Field visit updated." : "Field visit recorded.");
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
    <Modal open={open} title={editing ? "Edit field visit" : "Log a field visit"} onClose={onClose}>
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
          <TextField
            id="visit-visited-on"
            label="Date of visit"
            type="date"
            value={form.visited_on}
            onChange={update("visited_on")}
            error={errors.visited_on}
          />

          <div>
            <label htmlFor="visit-purpose" className="block text-sm font-medium text-slate-700">
              Purpose
            </label>
            <select
              id="visit-purpose"
              className="field mt-1.5"
              value={form.purpose}
              onChange={update("purpose")}
            >
              <option value="">Select a purpose…</option>
              {purposes.map((value) => (
                <option key={value} value={value}>
                  {purposeLabel(value)}
                </option>
              ))}
            </select>
            {errors.purpose && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{errors.purpose}</p>
            )}
          </div>
        </div>

        {/* The evidence of the trip. Optional by design. */}
        <fieldset className="mt-4 rounded-xl border border-slate-200 p-4">
          <legend className="px-1.5 text-xs font-semibold tracking-wide text-slate-600 uppercase">
            On-site location (optional)
          </legend>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary !px-3.5 !py-1.5 text-xs"
              onClick={captureLocation}
              disabled={locating}
            >
              <Icon name="locate-fixed" className="h-4 w-4" />
              {locating ? "Locating…" : "Capture my position"}
            </button>

            {coords && (
              <>
                <span className="rounded-pill bg-brand-50 px-3 py-1.5 text-[11px] font-semibold text-brand-800">
                  {coords[0].toFixed(5)}, {coords[1].toFixed(5)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCoords(null);
                    setLocationNote(null);
                  }}
                  className="rounded-pill px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100"
                >
                  Clear
                </button>
              </>
            )}
          </div>

          {locationNote ? (
            <p
              className={`mt-2 text-xs ${
                locationNote.tone === "ok" ? "text-brand-800" : "text-amber-700"
              }`}
            >
              {locationNote.text}
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              Capture where the visit actually happened, or leave it blank and log
              the trip anyway.
            </p>
          )}

          {errors.latitude && (
            <p className="mt-1.5 text-xs font-medium text-red-600">{errors.latitude}</p>
          )}
          {errors.longitude && (
            <p className="mt-1.5 text-xs font-medium text-red-600">{errors.longitude}</p>
          )}
        </fieldset>

        <div className="mt-3">
          <label htmlFor="visit-notes" className="block text-sm font-medium text-slate-700">
            Notes
          </label>
          <textarea
            id="visit-notes"
            rows={3}
            className="field mt-1.5"
            placeholder="e.g. Nobody home, left a note for the owner."
            value={form.notes}
            onChange={update("notes")}
            aria-describedby="visit-notes-hint"
          />
          <p id="visit-notes-hint" className="mt-1.5 text-xs text-slate-500">
            What happened on the trip. Animal condition belongs in a monitoring
            record.
          </p>
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
