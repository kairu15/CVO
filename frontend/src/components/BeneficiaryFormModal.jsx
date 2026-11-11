import { useEffect, useMemo, useState } from "react";
import { beneficiariesApi, fetchPuroks } from "../api/beneficiariesApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useNotifyOfflineSaved } from "../context/OfflineQueueContext";
import { useBarangays } from "../hooks/useBarangays";
import { useAnimalTypeGroups } from "../hooks/useAnimalTypes";
import { enqueue, isNetworkError } from "../lib/offlineQueue";
import { Modal } from "./Modal";
import { ButtonSpinner } from "./LoadingSpinner";
import { InlineAlert } from "./InlineAlert";
import { TextField } from "./TextField";
import { CoordinatePicker } from "./CoordinatePicker";
import { AnimalTypeClassificationSelect } from "./AnimalTypeClassificationSelect";

/**
 * Shown only while the master list is still loading (or unreachable), so the
 * form never renders an empty species dropdown and the admin can still enrol
 * a household. The server resolves these names against the master list on
 * save; they are a floor, not the vocabulary.
 */
const FALLBACK_ANIMAL_TYPES = ["Carabao", "Cattle", "Goat", "Swine", "Boar"];

const EMPTY_FORM = {
  name_of_farmer: "",
  rsbsa_number: "",
  ear_tag_number: "",
  animal_type: "",
  classification_id: "",
  sex: "F",
  address: "",
  purok_id: "",
  // Tri-state MOA: "" = not yet recorded, "true" = signed, "false" = not.
  moa_signed: "",
};

/** Coarse connectivity check — see useOnlineStatus. */
const isOnline = () =>
  typeof navigator === "undefined" ? true : navigator.onLine !== false;

/**
 * Admin enrolment form — the Beneficiaries screen's "Add" and "Edit" dialog.
 *
 * A beneficiary here is a PROGRAM RECORD, not an account: no email, no
 * password, no verification, no pending state. An administrator entering the
 * household is asserting it is a real enrolled beneficiary, so the record is
 * trusted immediately and the linked monitoring record is created server-side
 * on save.
 *
 * Location is the same cascade the old public form used: barangay (coverage
 * list) → purok (that barangay's sitios) → optional map/GPS fine-tune. The
 * purok is dropped whenever the barangay changes, because a purok only makes
 * sense inside its own barangay.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {object|null} [props.beneficiary] existing record to edit
 * @param {() => void} props.onClose
 * @param {() => void} [props.onSaved]
 */
export function BeneficiaryFormModal({ open, beneficiary = null, onClose, onSaved }) {
  const editing = Boolean(beneficiary);
  const toast = useToast();
  const { user } = useAuth();
  const notifyOfflineSaved = useNotifyOfflineSaved();
  const [barangays, barangaysStatus] = useBarangays();
  const { groups: animalTypeGroups } = useAnimalTypeGroups();

  const [form, setForm] = useState(EMPTY_FORM);
  const [puroks, setPuroks] = useState([]);
  const [coords, setCoords] = useState(null);
  // Edit mode seeds the saved pin: auto-resolving the barangay would move it
  // to the barangay center the moment the dialog opens. It turns back on as
  // soon as the admin picks a different barangay.
  const [autoResolvePin, setAutoResolvePin] = useState(!editing);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  // Households the server says already look like this one (same RSBSA, or the
  // same farmer in the same barangay). Shown before the record is created.
  const [duplicates, setDuplicates] = useState(null);

  // Seed once per open/record. Keyed on the record's ID, not the object: the
  // parent polls its list and hands us a fresh object with the same data, and
  // re-seeding on that would wipe whatever the admin has typed.
  const editingId = beneficiary?.id ?? null;

  useEffect(() => {
    if (!open) return;

    setForm(
      editing
        ? {
            name_of_farmer: beneficiary.name_of_farmer ?? "",
            rsbsa_number: beneficiary.rsbsa_number ?? "",
            ear_tag_number: beneficiary.ear_tag_number ?? "",
            animal_type: beneficiary.animal_type ?? "",
            classification_id:
              beneficiary.classification_id != null
                ? String(beneficiary.classification_id)
                : "",
            sex: beneficiary.sex ?? "F",
            address: beneficiary.address ?? "",
            purok_id: beneficiary.purok_id != null ? String(beneficiary.purok_id) : "",
            moa_signed:
              beneficiary.moa_signed === null || beneficiary.moa_signed === undefined
                ? ""
                : String(beneficiary.moa_signed),
          }
        : EMPTY_FORM,
    );
    setCoords(
      editing && beneficiary.latitude != null && beneficiary.longitude != null
        ? [beneficiary.latitude, beneficiary.longitude]
        : null,
    );
    setAutoResolvePin(!editing);
    setErrors({});
    setDuplicates(null);
    setPuroks([]);
    // Only a different record or a fresh open re-seeds — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, editingId]);

  const selectedBarangay = useMemo(
    () => barangays.find((barangay) => barangay.name === form.address) ?? null,
    [barangays, form.address],
  );

  // The purok list for the chosen barangay. The fallback static barangay list
  // carries no ids, so there is nothing to fetch then (field stays optional).
  useEffect(() => {
    let cancelled = false;

    if (!selectedBarangay?.id) {
      setPuroks([]);
      return undefined;
    }

    fetchPuroks(selectedBarangay.id)
      .then((list) => {
        if (!cancelled) setPuroks(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setPuroks([]);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedBarangay?.id]);

  function update(field) {
    return (event) => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  function chooseBarangay(event) {
    const address = event.target.value;
    // A purok belongs to exactly one barangay — keeping the old selection
    // would submit a mismatched pair (the API rejects it).
    setForm((prev) => ({ ...prev, address, purok_id: "" }));
    setCoords(null);
    setAutoResolvePin(true);
    setErrors((prev) => ({ ...prev, address: undefined, purok_id: undefined }));
  }

  function validate() {
    const next = {};
    if (!form.name_of_farmer.trim()) next.name_of_farmer = "Enter the farmer's full name.";
    if (!form.address) next.address = "Choose the barangay.";
    if (!form.animal_type) next.animal_type = "Choose the animal type.";
    return next;
  }

  function payload() {
    return {
      name_of_farmer: form.name_of_farmer.trim(),
      rsbsa_number: form.rsbsa_number.trim() || null,
      ear_tag_number: form.ear_tag_number.trim() || null,
      animal_type: form.animal_type,
      // Only sent when one was chosen: an unclassified animal is a real case
      // (not every historical record has one), and sending `null` on every
      // save would make an untouched cascade look like a deliberate clear.
      ...(form.classification_id !== ""
        ? { classification_id: Number(form.classification_id) }
        : {}),
      sex: form.sex,
      address: form.address,
      purok_id: form.purok_id === "" ? null : Number(form.purok_id),
      moa_signed: form.moa_signed === "" ? null : form.moa_signed === "true",
      latitude: coords?.[0] ?? null,
      longitude: coords?.[1] ?? null,
      location_source: coords ? "map_pin" : "manual",
    };
  }

  async function save({ confirmDuplicate = false, addAnother = false } = {}) {
    setSaving(true);
    const data = payload();

    try {
      if (editing) {
        if (!isOnline()) {
          toast.error("Reconnect to save changes to an existing beneficiary.");
          return;
        }

        await beneficiariesApi.update(beneficiary.id, data);
        toast.success("Beneficiary updated.");
      } else {
        // Field staff may enrol a household with no signal; the offline queue
        // already knows how to replay a beneficiary create.
        if (!isOnline()) {
          await enqueue({
            kind: "beneficiary",
            mode: "create",
            label: `Beneficiary — ${data.name_of_farmer}`,
            payload: data,
            userId: user?.id ?? null,
          });
          notifyOfflineSaved({ noun: "beneficiary", label: data.name_of_farmer });
          onSaved?.();
          onClose();
          return;
        }

        try {
          await beneficiariesApi.create(
            confirmDuplicate ? { ...data, confirm_duplicate: true } : data,
          );
        } catch (createError) {
          // 409 carries the households that already look like this one. Show
          // them instead of either refusing a legitimate second animal or
          // silently creating a duplicate.
          if (createError?.response?.status === 409) {
            setDuplicates(createError.response?.data?.duplicates ?? []);
            return;
          }

          if (!isNetworkError(createError)) throw createError;

          await enqueue({
            kind: "beneficiary",
            mode: "create",
            label: `Beneficiary — ${data.name_of_farmer}`,
            payload: data,
            userId: user?.id ?? null,
          });
          notifyOfflineSaved({ noun: "beneficiary", label: data.name_of_farmer });
          onSaved?.();
          onClose();
          return;
        }

        setDuplicates(null);
        toast.success("Beneficiary added — monitoring record created.");

        // Batch enrolment: keep the barangay, purok, animal and pin so the
        // next household in the same area is a few fields away.
        if (addAnother) {
          setForm((previous) => ({
            ...previous,
            name_of_farmer: "",
            rsbsa_number: "",
            ear_tag_number: "",
            sex: "F",
            moa_signed: "",
          }));
          setCoords(null);
          setAutoResolvePin(true);
          onSaved?.();
          return;
        }
      }

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

  function handleSubmit(event) {
    event.preventDefault();

    const invalid = validate();
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      return;
    }

    // The pressed submit button decides: one-off save, or keep the dialog open
    // for the next household (see save's addAnother branch).
    save({
      addAnother: event.nativeEvent?.submitter?.value === "addAnother",
    });
  }

  return (
    <Modal
      open={open}
      title={editing ? "Edit beneficiary" : "Add beneficiary"}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} noValidate>
        <p className="text-xs text-slate-500">
          {editing
            ? "Correct the household record. Monitoring history stays linked to this beneficiary."
            : "This creates the household record and its first monitoring record. No account, password or approval step — the record is trusted as entered."}
        </p>

        {barangaysStatus === "fallback" && (
          <div className="mt-3">
            <InlineAlert
              tone="info"
              message="Barangay list is unavailable right now — purok selection needs the server."
            />
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <TextField
            id="beneficiary-name"
            label="Name of farmer"
            value={form.name_of_farmer}
            onChange={update("name_of_farmer")}
            error={errors.name_of_farmer}
          />
          <TextField
            id="beneficiary-rsbsa"
            label="RSBSA number (optional)"
            value={form.rsbsa_number}
            onChange={update("rsbsa_number")}
            error={errors.rsbsa_number}
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="beneficiary-barangay" className="block text-sm font-medium text-slate-700">
              Barangay
            </label>
            <select
              id="beneficiary-barangay"
              className="field mt-1.5"
              value={form.address}
              onChange={chooseBarangay}
            >
              <option value="">Select barangay…</option>
              {barangays.map((barangay) => (
                <option key={barangay.name} value={barangay.name}>
                  {barangay.name}
                </option>
              ))}
            </select>
            {errors.address && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{errors.address}</p>
            )}
          </div>

          <div>
            <label htmlFor="beneficiary-purok" className="block text-sm font-medium text-slate-700">
              Purok / Sitio (optional)
            </label>
            <select
              id="beneficiary-purok"
              className="field mt-1.5"
              value={form.purok_id}
              onChange={update("purok_id")}
              disabled={puroks.length === 0}
            >
              <option value="">
                {puroks.length === 0 ? "No purok list for this barangay" : "Select purok…"}
              </option>
              {puroks.map((purok) => (
                <option key={purok.id} value={purok.id}>
                  {purok.name}
                </option>
              ))}
            </select>
            {errors.purok_id && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{errors.purok_id}</p>
            )}
          </div>
        </div>

        {/* The master list's two levels: type (grouped by main category) →
            classification. The classification is disabled until a type is
            picked and resets whenever the type changes. */}
        <div className="mt-3">
          <AnimalTypeClassificationSelect
            groups={animalTypeGroups}
            extraTypes={animalTypeGroups.length === 0 ? FALLBACK_ANIMAL_TYPES : []}
            typeValue={form.animal_type}
            classificationValue={form.classification_id}
            onChange={({ animalType, classificationId }) => {
              setForm((prev) => ({
                ...prev,
                animal_type: animalType,
                classification_id: classificationId,
              }));
              setErrors((prev) => ({
                ...prev,
                animal_type: undefined,
                classification_id: undefined,
              }));
            }}
            typeLabel="Type of animal"
            typeId="beneficiary-animal"
            classificationId="beneficiary-classification"
            typeError={errors.animal_type}
            classificationError={errors.classification_id}
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="beneficiary-sex" className="block text-sm font-medium text-slate-700">
              Sex
            </label>
            <select
              id="beneficiary-sex"
              className="field mt-1.5"
              value={form.sex}
              onChange={update("sex")}
            >
              <option value="F">Female</option>
              <option value="M">Male</option>
            </select>
            {errors.sex && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{errors.sex}</p>
            )}
          </div>

          <TextField
            id="beneficiary-ear-tag"
            label="Ear tag number (optional)"
            value={form.ear_tag_number}
            onChange={update("ear_tag_number")}
            error={errors.ear_tag_number}
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="beneficiary-moa" className="block text-sm font-medium text-slate-700">
              MOA status
            </label>
            <select
              id="beneficiary-moa"
              className="field mt-1.5"
              value={form.moa_signed}
              onChange={update("moa_signed")}
            >
              <option value="">Not recorded yet</option>
              <option value="true">Signed</option>
              <option value="false">Not signed</option>
            </select>
            {errors.moa_signed && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{errors.moa_signed}</p>
            )}
          </div>
        </div>

        {form.address && (
          <div className="mt-4">
            <CoordinatePicker
              value={coords}
              onChange={setCoords}
              address={form.address}
              autoResolve={autoResolvePin}
            />
          </div>
        )}

        {duplicates && duplicates.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
            <p className="text-sm font-semibold text-amber-900">
              A similar beneficiary may already exist
            </p>
            <p className="mt-1 text-xs text-amber-800">
              Check these records before adding another household for the same
              farmer or RSBSA number.
            </p>
            <ul className="mt-2 space-y-1 text-xs text-amber-900">
              {duplicates.map((duplicate) => (
                <li key={duplicate.id}>
                  <strong>{duplicate.name_of_farmer}</strong> — {duplicate.address}
                  {duplicate.rsbsa_number ? ` · ${duplicate.rsbsa_number}` : ""}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn-secondary !px-3.5 !py-1.5 text-xs"
                onClick={() => setDuplicates(null)}
              >
                Go back
              </button>
              <button
                type="button"
                className="btn-primary !px-3.5 !py-1.5 text-xs"
                disabled={saving}
                onClick={() => save({ confirmDuplicate: true })}
              >
                Save anyway
              </button>
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {!editing && (
            <button
              type="submit"
              name="intent"
              value="addAnother"
              className="btn-secondary"
              disabled={saving}
            >
              Save &amp; add another
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? (
              <>
                <ButtonSpinner />
                Saving…
              </>
            ) : editing ? (
              "Save changes"
            ) : (
              "Add beneficiary"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
