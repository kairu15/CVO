import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "./Modal";
import { ConfirmDialog } from "./ConfirmDialog";
import { InlineAlert } from "./InlineAlert";
import { TextField } from "./TextField";
import { ButtonSpinner } from "./LoadingSpinner";
import { AnimalTypeClassificationSelect } from "./AnimalTypeClassificationSelect";
import { DispersalMap } from "./DispersalMap";
import { Icon } from "./Icons";
import { useAnimalTypeGroups } from "../hooks/useAnimalTypes";
import { useBarangays } from "../hooks/useBarangays";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { animalOwnershipApi, isStaleOwnershipConflict } from "../api/animalOwnershipApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { enqueue, isNetworkError } from "../lib/offlineQueue";
import { useNotifyOfflineSaved, useOptionalOfflineQueue } from "../context/OfflineQueueContext";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";

/**
 * ONE dialog for every ownership action, opened from everywhere.
 *
 * The brief's rule: a dispersal is recorded through a single component with a
 * `mode`, so the beneficiaries page, the animal detail / map pin popup and the
 * monitoring records row all present the identical form and cannot drift.
 *
 *   disperse      create an animal and record its first event (from CVO)
 *   re-disperse   move the SAME animal to a new owner
 *   pass-on       create an offspring (linked to the parent) and hand it on
 *   return        hand the animal back to CVO
 *
 * The server is authoritative: this form validates for convenience and renders
 * whatever the API rejects (422 field errors by name, 409 as a "the chain
 * changed" notice). A handover made offline is queued with the `base_event_id`
 * it was recorded against, so a stale replay surfaces as a conflict rather
 * than silently overwriting someone else's change.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {"disperse"|"re-disperse"|"pass-on"|"return"} [props.mode]
 * @param {object|null} [props.beneficiary] preselected household: the RECIPIENT
 *   on `disperse`, the current holder on the others (used to resolve the animal)
 * @param {object|null} [props.animal] preselected animal, when the caller has one
 * @param {() => void} props.onClose
 * @param {(result: object) => void} [props.onSaved]
 */
const MODES = {
  disperse: {
    title: "Disperse animal",
    verb: "Disperse",
    noun: "dispersal",
    needsAnimal: false,
    needsTarget: true,
    intro: "Record an animal leaving CVO to a beneficiary. This is the first node of its flight path.",
  },
  "re-disperse": {
    title: "Re-disperse animal",
    verb: "Re-disperse",
    noun: "re-dispersal",
    needsAnimal: true,
    needsTarget: true,
    intro: "Hand the SAME animal to a new owner. Every handover is an event, so the path keeps its full history.",
  },
  "pass-on": {
    title: "Pass on offspring",
    verb: "Pass on",
    noun: "pass-on",
    needsAnimal: true,
    needsTarget: true,
    intro: "Record an offspring of this animal being passed on to another household.",
  },
  return: {
    title: "Return animal to CVO",
    verb: "Return",
    noun: "return",
    needsAnimal: true,
    needsTarget: false,
    intro: "Record the animal coming back to CVO from its current owner.",
  },
};

/** Today in LOCAL time — a UTC date would be yesterday in Manila after 4pm. */
function todayLocal() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** The label a queued item (and its toast) shows. */
function animalLabel(animal) {
  if (!animal) return "animal";
  return animal.ear_tag_number ? `animal ${animal.ear_tag_number}` : `animal #${animal.id}`;
}

export function DispersalDialog({
  open,
  mode = "disperse",
  beneficiary = null,
  animal = null,
  onClose,
  onSaved,
}) {
  const toast = useToast();
  const { user } = useAuth();
  const { groups: animalTypeGroups } = useAnimalTypeGroups();
  const [barangays] = useBarangays();
  const notifyOfflineSaved = useNotifyOfflineSaved();
  const offlineQueue = useOptionalOfflineQueue();

  const [activeMode, setActiveMode] = useState(mode);
  const config = MODES[activeMode] ?? MODES.disperse;
  const needsAnimal = config.needsAnimal;

  const [targets, setTargets] = useState([]);
  const [targetQuery, setTargetQuery] = useState("");
  const [targetId, setTargetId] = useState("");

  const [resolvedAnimal, setResolvedAnimal] = useState(animal);
  const [animalLoading, setAnimalLoading] = useState(false);
  const [animalError, setAnimalError] = useState(null);
  const [latestEventId, setLatestEventId] = useState(null);
  const [currentOwner, setCurrentOwner] = useState(null);

  const [form, setForm] = useState(() => emptyForm());
  const [locationTouched, setLocationTouched] = useState(false);
  const [locating, setLocating] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Inline "Add new beneficiary" — the spec's searchable select with inline
  // registration, kept inside the dialog so a field handover is one action.
  const [showNewBeneficiary, setShowNewBeneficiary] = useState(false);
  const [newBeneficiary, setNewBeneficiary] = useState(() => emptyNewBeneficiary());
  const [newBeneficiaryErrors, setNewBeneficiaryErrors] = useState({});
  const [savingNewBeneficiary, setSavingNewBeneficiary] = useState(false);

  function emptyForm() {
    return {
      date: todayLocal(),
      remarks: "",
      earTag: "",
      sex: "F",
      typeValue: "",
      typeId: null,
      classificationId: "",
      latitude: null,
      longitude: null,
      source: null,
      accuracyM: null,
    };
  }

  function emptyNewBeneficiary() {
    return { name: "", address: "", typeValue: "", typeId: null, classificationId: "", sex: "F" };
  }

  /* ------------------------------------------------------------------ *
   |  Reset + load on open                                               |
   * ------------------------------------------------------------------ */

  const reset = useCallback(() => {
    setActiveMode(mode);
    setTargetId(!MODES[mode]?.needsAnimal && beneficiary ? String(beneficiary.id) : "");
    setTargetQuery("");
    setResolvedAnimal(animal ?? null);
    setAnimalError(null);
    setLatestEventId(null);
    setCurrentOwner(null);
    setForm(emptyForm());
    setLocationTouched(false);
    setFormErrors({});
    setError(null);
    setNotice(null);
    setShowNewBeneficiary(false);
    setNewBeneficiary(emptyNewBeneficiary());
    setNewBeneficiaryErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset must not re-fire when the caller hands back an equal-but-new prop object
  }, [mode, animal, beneficiary]);

  useEffect(() => {
    if (!open) return;
    reset();
  }, [open, reset]);

  // The beneficiary list for the searchable recipient select (role-scoped
  // server-side: a technician only ever sees their assigned households).
  useEffect(() => {
    if (!open || !config.needsTarget) return undefined;

    let cancelled = false;

    beneficiariesApi
      .list({ per_page: 500 })
      .then((rows) => {
        if (!cancelled) setTargets(rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setTargets([]);
      });

    return () => {
      cancelled = true;
    };
  }, [open, config.needsTarget]);

  // Resolve the animal an action applies to: the caller may hand one over, or
  // only the household — in which case we ask which animals it holds.
  useEffect(() => {
    if (!open || !needsAnimal) return undefined;

    let cancelled = false;

    async function resolve() {
      setAnimalLoading(true);
      setAnimalError(null);

      try {
        let found = animal ?? null;

        if (!found && beneficiary?.id) {
          const rows = await animalOwnershipApi.beneficiaryAnimals(beneficiary.id);
          found = rows.find((row) => row.status === "active") ?? rows[0] ?? null;
        }

        if (cancelled) return;
        setResolvedAnimal(found);
        if (!found) {
          setAnimalError("No animal is on record for this household yet.");
        }
      } catch (err) {
        if (!cancelled) setAnimalError(getErrorMessage(err));
      } finally {
        if (!cancelled) setAnimalLoading(false);
      }
    }

    resolve();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the identity of what the caller opened, not on object equality
  }, [open, activeMode, needsAnimal, animal, beneficiary?.id]);

  // The chain supplies `latest_event_id` (the concurrency token) and the
  // current owner the dialog summarises.
  const loadChain = useCallback(async () => {
    if (!resolvedAnimal?.id) return;

    try {
      const chain = await animalOwnershipApi.ownershipChain(resolvedAnimal.id);
      setLatestEventId(chain?.latest_event_id ?? null);
      setCurrentOwner(chain?.current_owner ?? null);
    } catch {
      setLatestEventId(null);
      setCurrentOwner(null);
    }
  }, [resolvedAnimal?.id]);

  useEffect(() => {
    if (!open || !resolvedAnimal?.id) return;
    loadChain();
  }, [open, resolvedAnimal?.id, loadChain]);

  // Default the handover location to the new owner's geotag (the brief's rule)
  // until the user moves it — then their choice wins.
  useEffect(() => {
    if (!open || !config.needsTarget || locationTouched) return;

    const target = targets.find((row) => String(row.id) === String(targetId));
    if (!target) return;

    setForm((prev) => ({
      ...prev,
      latitude: target.latitude ?? null,
      longitude: target.longitude ?? null,
      source: target.latitude != null && target.longitude != null ? "owner_geotag" : null,
    }));
  }, [open, config.needsTarget, locationTouched, targetId, targets]);

  const filteredTargets = useMemo(() => {
    const term = targetQuery.trim().toLowerCase();
    if (!term) return targets;

    return targets.filter((row) =>
      [row.name_of_farmer, row.address, row.rsbsa_number]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term)),
    );
  }, [targets, targetQuery]);

  const dirty =
    Boolean(open) &&
    (Boolean(targetId) ||
      Boolean(form.earTag) ||
      Boolean(form.remarks) ||
      Boolean(form.typeValue) ||
      form.latitude !== null);

  useUnsavedChangesGuard({ when: dirty && !submitting });

  function requestClose() {
    if (dirty && !submitting) {
      setConfirmDiscard(true);
      return;
    }
    onClose?.();
  }

  /* ------------------------------------------------------------------ *
   |  Field helpers                                                      |
   * ------------------------------------------------------------------ */

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function chooseTarget(id) {
    setTargetId(id);
    setLocationTouched(false);
    setFormErrors((prev) => ({ ...prev, to_beneficiary_id: undefined }));
  }

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setNotice("Geolocation is not available in this browser.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((prev) => ({
          ...prev,
          latitude: Number(position.coords.latitude.toFixed(7)),
          longitude: Number(position.coords.longitude.toFixed(7)),
          accuracyM: position.coords.accuracy ?? null,
          source: "device_gps",
        }));
        setLocationTouched(true);
        setNotice("Handover location set to your current GPS position.");
        setLocating(false);
      },
      () => {
        setNotice("Could not get your location — tap the map instead.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  /* ------------------------------------------------------------------ *
   |  Inline beneficiary creation                                        |
   * ------------------------------------------------------------------ */

  async function saveNewBeneficiary(event) {
    event.preventDefault();
    setNewBeneficiaryErrors({});

    const next = {};
    if (!newBeneficiary.name.trim()) next.name_of_farmer = "Enter the farmer's name.";
    if (!newBeneficiary.address) next.address = "Choose a barangay.";
    if (!newBeneficiary.typeId && !newBeneficiary.typeValue) next.animal_type = "Choose an animal type.";

    if (Object.keys(next).length > 0) {
      setNewBeneficiaryErrors(next);
      return;
    }

    setSavingNewBeneficiary(true);

    try {
      const created = await beneficiariesApi.create({
        name_of_farmer: newBeneficiary.name.trim(),
        address: newBeneficiary.address,
        animal_type: newBeneficiary.typeValue || undefined,
        animal_type_id: newBeneficiary.typeId ?? undefined,
        classification_id: newBeneficiary.classificationId ? Number(newBeneficiary.classificationId) : undefined,
        sex: newBeneficiary.sex || undefined,
      });

      setTargets((prev) => [created, ...prev]);
      setShowNewBeneficiary(false);
      setNewBeneficiary(emptyNewBeneficiary());
      chooseTarget(String(created.id));
      toast.success(`${created.name_of_farmer} added and selected.`);
    } catch (err) {
      const fields = getFieldErrors(err);

      if (fields) {
        setNewBeneficiaryErrors(fields);
      } else {
        setNewBeneficiaryErrors({ form: getErrorMessage(err) });
      }
    } finally {
      setSavingNewBeneficiary(false);
    }
  }

  /* ------------------------------------------------------------------ *
   |  Submit                                                             |
   * ------------------------------------------------------------------ */

  /** Convenience checks only — the server's rules are authoritative. */
  function validate() {
    const next = {};

    if (config.needsTarget && !targetId) {
      next.to_beneficiary_id = "Choose the beneficiary who will receive the animal.";
    }
    if (activeMode === "disperse" && !form.typeId) {
      next.animal_type_id = "Choose the animal type.";
    }
    if (form.date && form.date > todayLocal()) {
      next.event_date = "The date cannot be in the future.";
    }

    return next;
  }

  function locationPayload() {
    if (form.latitude === null || form.longitude === null) return {};

    return {
      latitude: form.latitude,
      longitude: form.longitude,
      location_source: form.source ?? "manual_pin",
      ...(form.accuracyM != null ? { accuracy_m: form.accuracyM } : {}),
    };
  }

  async function dispatch(action, animalId, payload) {
    if (action === "disperse") return animalOwnershipApi.disperse(payload);
    if (action === "redisperse") return animalOwnershipApi.redisperse(animalId, payload);
    if (action === "pass-on") return animalOwnershipApi.passOn(animalId, payload);
    return animalOwnershipApi.returnToCvo(animalId, payload);
  }

  async function submit(event) {
    event.preventDefault();
    setFormErrors({});
    setError(null);
    setNotice(null);

    const clientErrors = validate();
    if (Object.keys(clientErrors).length > 0) {
      setFormErrors(clientErrors);
      return;
    }

    let action = "disperse";
    let animalId = null;
    let payload;

    const shared = {
      event_date: form.date || undefined,
      remarks: form.remarks.trim() || undefined,
      ...locationPayload(),
    };

    if (activeMode === "disperse") {
      payload = {
        to_beneficiary_id: Number(targetId),
        animal_type_id: form.typeId,
        ...(form.classificationId ? { classification_id: Number(form.classificationId) } : {}),
        ...(form.typeValue ? { animal_type: form.typeValue } : {}),
        ...(form.earTag.trim() ? { ear_tag_number: form.earTag.trim() } : {}),
        ...(form.sex ? { sex: form.sex } : {}),
        ...shared,
      };
    } else if (activeMode === "re-disperse") {
      action = "redisperse";
      animalId = resolvedAnimal.id;
      payload = { to_beneficiary_id: Number(targetId), base_event_id: latestEventId, ...shared };
    } else if (activeMode === "pass-on") {
      action = "pass-on";
      animalId = resolvedAnimal.id;
      payload = {
        to_beneficiary_id: Number(targetId),
        ...(latestEventId != null ? { base_event_id: latestEventId } : {}),
        ...(form.earTag.trim() ? { ear_tag_number: form.earTag.trim() } : {}),
        ...(form.typeId ? { animal_type_id: form.typeId } : {}),
        ...(form.classificationId ? { classification_id: Number(form.classificationId) } : {}),
        ...(form.typeValue ? { animal_type: form.typeValue } : {}),
        ...(form.sex ? { sex: form.sex } : {}),
        ...shared,
      };
    } else {
      action = "return";
      animalId = resolvedAnimal.id;
      payload = { base_event_id: latestEventId, ...shared };
    }

    setSubmitting(true);

    try {
      const result = await dispatch(action, animalId, payload);
      toast.success(`${config.verb} recorded.`);
      onSaved?.(result);
      onClose?.();
    } catch (err) {
      if (isStaleOwnershipConflict(err)) {
        // The chain moved while this form was open: re-read it and ask the
        // user to review rather than appending to a state they never saw.
        setNotice(
          "Someone changed this animal's ownership chain while this form was open. It has been refreshed — check the current owner and try again.",
        );
        await loadChain();
      } else if (isNetworkError(err)) {
        await queueOffline(action, animalId, payload);
      } else {
        const fields = getFieldErrors(err);

        if (fields) {
          setFormErrors(fields);
          setError("Some fields need attention before this can be saved.");
        } else {
          setError(getErrorMessage(err));
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  /** Offline: keep the handover on the device, token and all. */
  async function queueOffline(action, animalId, payload) {
    const label = `${config.verb} — ${animalLabel(resolvedAnimal)}`;

    try {
      await enqueue({
        kind: "animal-ownership",
        mode: "update",
        payload: { action, animalId, payload },
        serverId: animalId,
        label,
        userId: user?.id ?? null,
      });

      notifyOfflineSaved({ noun: config.noun, label });
      onClose?.();
    } catch {
      setError(
        "Couldn't reach the server, and this change couldn't be saved on this device. Try again when you have a connection.",
      );
    }
  }

  /* ------------------------------------------------------------------ *
   |  Render                                                             |
   * ------------------------------------------------------------------ */

  const hasCoordinates = form.latitude !== null && form.longitude !== null;
  const showTypeFields = activeMode === "disperse" || activeMode === "pass-on";
  const blockedByAnimal = needsAnimal && !animalLoading && !resolvedAnimal;

  return (
    <>
      <Modal open={open} title={config.title} onClose={requestClose}>
        <p className="-mt-2 text-sm text-slate-600">{config.intro}</p>

        {offlineQueue && !offlineQueue.online && (
          <div className="mt-3">
            <InlineAlert
              tone="info"
              message={
                needsAnimal
                  ? "You're offline. This handover will be saved on this device and synced when you're back online — if the chain changes first, you'll be asked to review it."
                  : "You're offline. This dispersal will be saved on this device and synced when you're back online."
              }
            />
          </div>
        )}

        {notice && (
          <div className="mt-3">
            <InlineAlert tone="info" message={notice} onDismiss={() => setNotice(null)} autoDismiss={8000} />
          </div>
        )}

        {error && (
          <div className="mt-3">
            <InlineAlert message={error} onDismiss={() => setError(null)} />
          </div>
        )}

        {/* The animal an ownership action applies to. */}
        {needsAnimal && (
          <div className="mt-4 rounded-xl border border-slate-200 p-3.5">
            {animalLoading ? (
              <p className="text-sm text-slate-500">Checking this household's animal…</p>
            ) : resolvedAnimal ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Animal
                  </p>
                  <p className="text-sm font-semibold text-slate-900">
                    {resolvedAnimal.ear_tag_number || `#${resolvedAnimal.id}`} ·{" "}
                    {resolvedAnimal.animal_type_name || resolvedAnimal.animal_type || "Unspecified"}
                    {resolvedAnimal.animal_classification ? ` (${resolvedAnimal.animal_classification})` : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    Currently with{" "}
                    {currentOwner
                      ? `${currentOwner.label}${currentOwner.barangay ? ` · ${currentOwner.barangay}` : ""}`
                      : "—"}
                  </p>
                </div>
                <span className="rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
                  {resolvedAnimal.status}
                </span>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  {animalError ?? "No animal could be loaded for this household."}
                </p>
                <button
                  type="button"
                  className="btn-secondary !px-3.5 !py-1.5 text-xs"
                  onClick={() => {
                    setActiveMode("disperse");
                    setResolvedAnimal(null);
                    setAnimalError(null);
                  }}
                >
                  <Icon name="plus" className="h-3.5 w-3.5" />
                  Disperse a new animal instead
                </button>
              </div>
            )}
          </div>
        )}

        {blockedByAnimal ? null : (
          <form onSubmit={submit} className="mt-4 space-y-4">
            {config.needsTarget && (
              <div className="rounded-xl border border-slate-200 p-3.5">
                <label htmlFor="dispersal-target-search" className="block text-sm font-medium text-slate-700">
                  {activeMode === "disperse" ? "Disperse to" : "New owner"}
                </label>
                <input
                  id="dispersal-target-search"
                  type="search"
                  value={targetQuery}
                  onChange={(event) => setTargetQuery(event.target.value)}
                  placeholder="Search name, barangay or RSBSA #…"
                  className="field mt-1.5"
                  aria-describedby="dispersal-target-hint"
                />

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    id="dispersal-target"
                    className={`field w-full sm:w-80 ${formErrors.to_beneficiary_id ? "field-invalid" : ""}`}
                    value={targetId}
                    onChange={(event) => chooseTarget(event.target.value)}
                    aria-label="Beneficiary receiving the animal"
                  >
                    <option value="">Select beneficiary…</option>
                    {filteredTargets.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name_of_farmer} — {row.address}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="btn-secondary !px-3.5 !py-1.5 text-xs"
                    onClick={() => setShowNewBeneficiary((prev) => !prev)}
                    aria-expanded={showNewBeneficiary}
                  >
                    <Icon name="plus" className="h-3.5 w-3.5" />
                    Add new beneficiary
                  </button>
                </div>

                {filteredTargets.length === 0 && targets.length > 0 && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    No beneficiary matches “{targetQuery}”. Add one below.
                  </p>
                )}
                <p id="dispersal-target-hint" className="mt-1.5 text-xs text-slate-500">
                  {targets.length} household{targets.length === 1 ? "" : "s"} you can hand animals to.
                </p>

                {formErrors.to_beneficiary_id && (
                  <p className="mt-1.5 text-xs font-medium text-red-600">
                    {formErrors.to_beneficiary_id}
                  </p>
                )}

                {showNewBeneficiary && (
                  <div className="mt-3 space-y-3 rounded-xl border border-brand-200 bg-brand-50/50 p-3.5">
                    <p className="text-xs font-semibold tracking-wide text-brand-800 uppercase">
                      New beneficiary
                    </p>

                    <TextField
                      id="new-beneficiary-name"
                      label="Name of farmer"
                      value={newBeneficiary.name}
                      onChange={(event) =>
                        setNewBeneficiary((prev) => ({ ...prev, name: event.target.value }))
                      }
                      error={newBeneficiaryErrors.name_of_farmer}
                    />

                    <div>
                      <label htmlFor="new-beneficiary-address" className="block text-sm font-medium text-slate-700">
                        Barangay
                      </label>
                      <select
                        id="new-beneficiary-address"
                        className="field mt-1.5"
                        value={newBeneficiary.address}
                        onChange={(event) =>
                          setNewBeneficiary((prev) => ({ ...prev, address: event.target.value }))
                        }
                      >
                        <option value="">Select barangay…</option>
                        {barangays.map((barangay) => (
                          <option key={barangay.name} value={barangay.name}>
                            {barangay.name}
                          </option>
                        ))}
                      </select>
                      {newBeneficiaryErrors.address && (
                        <p className="mt-1.5 text-xs font-medium text-red-600">
                          {newBeneficiaryErrors.address}
                        </p>
                      )}
                    </div>

                    <AnimalTypeClassificationSelect
                      groups={animalTypeGroups}
                      typeValue={newBeneficiary.typeValue}
                      classificationValue={newBeneficiary.classificationId}
                      onChange={({ animalType, animalTypeId, classificationId }) =>
                        setNewBeneficiary((prev) => ({
                          ...prev,
                          typeValue: animalType,
                          typeId: animalTypeId,
                          classificationId,
                        }))
                      }
                      typeId="new-beneficiary-type"
                      classificationId="new-beneficiary-classification"
                      typeError={newBeneficiaryErrors.animal_type}
                    />

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <label htmlFor="new-beneficiary-sex" className="text-sm font-medium text-slate-700">
                          Sex
                        </label>
                        <select
                          id="new-beneficiary-sex"
                          className="field w-24"
                          value={newBeneficiary.sex}
                          onChange={(event) =>
                            setNewBeneficiary((prev) => ({ ...prev, sex: event.target.value }))
                          }
                        >
                          <option value="F">Female</option>
                          <option value="M">Male</option>
                        </select>
                      </div>

                      <button
                        type="button"
                        className="btn-primary !px-3.5 !py-1.5 text-xs"
                        onClick={saveNewBeneficiary}
                        disabled={savingNewBeneficiary}
                      >
                        {savingNewBeneficiary ? (
                          <>
                            <ButtonSpinner />
                            Saving…
                          </>
                        ) : (
                          "Save beneficiary"
                        )}
                      </button>
                    </div>

                    {newBeneficiaryErrors.form && (
                      <p className="text-xs font-medium text-red-600">{newBeneficiaryErrors.form}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {showTypeFields && (
              <AnimalTypeClassificationSelect
                groups={animalTypeGroups}
                typeValue={form.typeValue}
                classificationValue={form.classificationId}
                onChange={({ animalType, animalTypeId, classificationId }) => {
                  setForm((prev) => ({
                    ...prev,
                    typeValue: animalType,
                    typeId: animalTypeId,
                    classificationId,
                  }));
                  setFormErrors((prev) => ({ ...prev, animal_type_id: undefined }));
                }}
                typeLabel={activeMode === "pass-on" ? "Offspring type (optional)" : "Animal type"}
                classificationLabel="Classification"
                typeError={formErrors.animal_type_id}
                classificationError={formErrors.classification_id}
              />
            )}

            {showTypeFields && (
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  id="dispersal-ear-tag"
                  label="Ear tag number"
                  value={form.earTag}
                  onChange={(event) => setField("earTag", event.target.value)}
                  error={formErrors.ear_tag_number}
                  hint="The number printed on the animal's tag."
                />
                <div>
                  <label htmlFor="dispersal-sex" className="block text-sm font-medium text-slate-700">
                    Sex
                  </label>
                  <select
                    id="dispersal-sex"
                    className="field mt-1.5"
                    value={form.sex}
                    onChange={(event) => setField("sex", event.target.value)}
                  >
                    <option value="F">Female</option>
                    <option value="M">Male</option>
                  </select>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="dispersal-date"
                label="Date of handover"
                type="date"
                value={form.date}
                max={todayLocal()}
                onChange={(event) => setField("date", event.target.value)}
                error={formErrors.event_date}
                hint="Backdating is allowed up to the office's limit."
              />
              <TextField
                id="dispersal-remarks"
                label="Remarks (optional)"
                value={form.remarks}
                onChange={(event) => setField("remarks", event.target.value)}
                error={formErrors.remarks}
              />
            </div>

            {/* Handover location. The map is a convenience over the coordinates;
                the text below is its alternative, so the section is usable
                without seeing the map at all. */}
            <fieldset className="rounded-xl border border-brand-200 bg-brand-50/50 p-3.5">
              <legend className="px-1.5 text-xs font-semibold tracking-wide text-brand-800 uppercase">
                Handover location
              </legend>
              <p className="mb-3 text-xs text-slate-500">
                Defaults to the new owner's registered pin. Drag on the map to
                place it exactly, or use your current location in the field.
              </p>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary !px-3.5 !py-1.5 text-xs"
                  onClick={useMyLocation}
                  disabled={locating}
                >
                  <Icon name="locate-fixed" className="h-4 w-4" />
                  {locating ? "Locating…" : "Use my current location"}
                </button>
                {hasCoordinates && (
                  <button
                    type="button"
                    className="btn-secondary !px-3.5 !py-1.5 text-xs"
                    onClick={() => {
                      setForm((prev) => ({ ...prev, latitude: null, longitude: null, source: null }));
                      setLocationTouched(true);
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>

              <DispersalMap
                beneficiaries={[]}
                loading={false}
                onPick={([lat, lng]) => {
                  setForm((prev) => ({ ...prev, latitude: lat, longitude: lng, source: "manual_pin" }));
                  setLocationTouched(true);
                }}
                center={hasCoordinates ? [form.latitude, form.longitude] : undefined}
                selected={hasCoordinates ? [form.latitude, form.longitude] : null}
              />

              <p className="mt-3 text-xs text-slate-600" role="status">
                {hasCoordinates
                  ? `Handover location: ${form.latitude}, ${form.longitude}${
                      form.source ? ` (${form.source.replace("_", " ")})` : ""
                    }.`
                  : "No handover location recorded — the path will fall back to the owner's pin or the barangay centre."}
              </p>
            </fieldset>

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" className="btn-secondary" onClick={requestClose}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={submitting} aria-busy={submitting}>
                {submitting ? (
                  <>
                    <ButtonSpinner />
                    Saving…
                  </>
                ) : (
                  config.verb
                )}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDiscard}
        message={`This ${config.noun} hasn't been recorded yet. Closing the form discards what you've entered.`}
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose?.();
        }}
      />
    </>
  );
}
