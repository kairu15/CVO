import { useEffect, useMemo, useRef, useState } from "react";
import { fieldVisitsApi } from "../api/fieldVisitsApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { captureGeotag } from "../lib/geotagPhoto";
import { enqueue, isNetworkError } from "../lib/offlineQueue";
import { Modal } from "./Modal";
import { ButtonSpinner } from "./LoadingSpinner";
import { TextField } from "./TextField";
import { Icon } from "./Icons";
import { VoiceInputButton } from "./VoiceInputButton";

/** `routine-monitoring` → `Routine monitoring`. */
export const purposeLabel = (value) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/-/g, " ") : "—";

const EMPTY_FORM = {
  visited_on: "",
  purpose: "",
  notes: "",
};

/** Coarse connectivity check — see useOnlineStatus. */
const isOnline = () =>
  typeof navigator === "undefined" ? true : navigator.onLine !== false;

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
  const { user } = useAuth();
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // Geotagged photo evidence. Required for new visits (per-product decision,
  // 2026-09); existing visits are grandfathered and editing never forces a
  // retroactive photo. A retake replaces the capture — never appends.
  const cameraInputRef = useRef(null);
  const [capturing, setCapturing] = useState(false); // GPS + composition
  const [capture, setCapture] = useState(null); // { meta, photo } | null
  const [captureNote, setCaptureNote] = useState(null); // farmer-readable outcome
  // A visit whose photo upload failed stays logged — remembered so resubmitting
  // retries the upload on this visit instead of logging a duplicate trip.
  const [createdVisit, setCreatedVisit] = useState(null);

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
    setCapture(null);
    setCaptureNote(null);
    setCreatedVisit(null);
  }, [open, visit, beneficiaries]);

  function update(field) {
    return (event) => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  /**
   * Take Photo: the device camera app supplies the image; at the same moment
   * we take the GPS fix and derive the clock metadata, then compose the
   * metadata panel onto the left side of the photo. HTTPS note: camera input
   * and geolocation need a secure context (https or localhost) — same as the
   * GPS feature; use the dev tunnel for phone testing.
   */
  async function handleCapture(event) {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again re-fires change.
    event.target.value = "";
    if (!file) return;

    setCapturing(true);
    setCaptureNote(null);
    setErrors((prev) => ({ ...prev, photo: undefined }));

    try {
      const result = await captureGeotag(file);
      setCapture(result);

      if (result.meta.latitude === null) {
        setCaptureNote({
          tone: "warn",
          text: "Photo captured, but no GPS fix was available — it will be marked as having no location data.",
        });
      }
    } catch {
      setCaptureNote({
        tone: "error",
        text: "Could not process that photo. Try taking it again.",
      });
    } finally {
      setCapturing(false);
    }
  }

  function discardCapture() {
    // A retake replaces: previous capture and metadata are dropped entirely.
    setCapture(null);
    setCaptureNote(null);
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

  /**
   * Keep the submission on the device instead of sending it. Used when the
   * device is offline, or when the request never reached the server. The
   * composited photo blob rides along in IndexedDB so the evidence is not lost.
   */
  /** The photo blob + its structured metadata, as the queue stores them. */
  function queuedPhoto() {
    return capture
      ? { blob: capture.photo.blob, meta: { ...capture.meta, gps_timestamp: undefined } }
      : null;
  }

  async function queueVisit(createPayload) {
    await enqueue({
      kind: "field-visit",
      mode: "create",
      label: `Field visit — ${beneficiary?.name_of_farmer ?? "beneficiary"}`,
      payload: createPayload,
      userId: user?.id ?? null,
      photo: queuedPhoto(),
    });

    toast.success("Saved on this device — it will sync when you're back online.");
    onSaved?.();
    onClose();
  }

  /**
   * Queue an EDIT of an existing visit. Unlike a create, this can overwrite a
   * record someone else changed while the technician was offline — the queue
   * checks that at sync time and asks before overwriting.
   */
  async function queueVisitEdit(payload) {
    await enqueue({
      kind: "field-visit",
      mode: "update",
      serverId: visit.id,
      label: `Field visit edit — ${beneficiary?.name_of_farmer ?? "beneficiary"}`,
      payload,
      userId: user?.id ?? null,
      photo: queuedPhoto(),
    });

    toast.success("Saved on this device — it will sync when you're back online.");
    onSaved?.();
    onClose();
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
    if (!editing && !capture) {
      // Field evidence is mandatory on new visits.
      setErrors((prev) => ({ ...prev, photo: "Take the geotagged photo before logging the visit." }));
      return;
    }

    setSaving(true);
    try {
      // The photo carries its own GPS fix taken at the shutter moment; when
      // the technician didn't separately capture a position, that fix is the
      // on-site location.
      const photoCoords =
        capture?.meta?.latitude != null && capture?.meta?.longitude != null
          ? [capture.meta.latitude, capture.meta.longitude]
          : null;
      const fix = coords ?? photoCoords;

      // Sent as a pair or not at all — the API rejects a half-captured fix.
      const payload = {
        visited_on: form.visited_on,
        purpose: form.purpose,
        notes: form.notes.trim() || null,
        latitude: fix?.[0] ?? null,
        longitude: fix?.[1] ?? null,
      };

      if (editing) {
        // Offline: queue the whole edit (data + any new photo) and let the
        // queue replay it — and flag a conflict if the visit changed on the
        // server in the meantime.
        if (!isOnline()) {
          await queueVisitEdit(payload);
          return;
        }

        try {
          await fieldVisitsApi.update(visit.id, payload);

          // A capture taken while editing attaches (or replaces) the photo —
          // also the recovery path for a visit whose original upload failed.
          if (capture) {
            await fieldVisitsApi.uploadPhoto(visit.id, capture.photo.blob, {
              ...capture.meta,
              gps_timestamp: undefined, // derived server-side from the columns
            });
          }
        } catch (editError) {
          // The edit never reached the server — queue it rather than losing it.
          if (isNetworkError(editError)) {
            await queueVisitEdit(payload);
            return;
          }
          throw editError;
        }

        toast.success("Field visit updated.");
        onSaved?.();
        onClose();
      } else {
        const createPayload = {
          ...payload,
          beneficiary_id: Number(beneficiaryId),
          has_photo: true,
        };

        // No connection: save the whole submission (data + photo) on the
        // device and let the queue replay it on reconnect.
        if (!isOnline()) {
          await queueVisit(createPayload);
          return;
        }

        let target = null;
        try {
          target = createdVisit
            ? null // upload retry — the visit already exists
            : await fieldVisitsApi.create(createPayload);
        } catch (createError) {
          // The request never reached the server (offline, API down): queue it
          // rather than surfacing a dead-end error.
          if (isNetworkError(createError)) {
            await queueVisit(createPayload);
            return;
          }
          throw createError;
        }

        if (target) setCreatedVisit(target);

        const visitId = (target ?? createdVisit).id;

        try {
          // The structured metadata uploads with the composited image — the
          // backend stores it as real columns, queryable without OCR.
          await fieldVisitsApi.uploadPhoto(visitId, capture.photo.blob, {
            ...capture.meta,
            gps_timestamp: undefined, // derived server-side from the columns
          });
        } catch (uploadError) {
          // The visit already exists — queue only the photo, so the retry
          // reuses this visit instead of logging a duplicate trip.
          if (isNetworkError(uploadError)) {
            await enqueue({
              kind: "field-visit",
              label: `Photo — ${beneficiary?.name_of_farmer ?? "field visit"}`,
              payload: null,
              serverId: visitId,
              userId: user?.id ?? null,
              photo: {
                blob: capture.photo.blob,
                meta: { ...capture.meta, gps_timestamp: undefined },
              },
            });
            toast.success("Visit logged; the photo will upload when you're back online.");
            onSaved?.();
            onClose();
            return;
          }

          toast.error(
            'The visit was logged, but the photo upload failed — press "Log field visit" again to retry.',
          );
          onSaved?.();
          return;
        }

        toast.success("Field visit recorded.");
        onSaved?.();
        onClose();
      }
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
              Capture where the visit actually happened — taking the photo below
              records your position here too.
            </p>
          )}

          {errors.latitude && (
            <p className="mt-1.5 text-xs font-medium text-red-600">{errors.latitude}</p>
          )}
          {errors.longitude && (
            <p className="mt-1.5 text-xs font-medium text-red-600">{errors.longitude}</p>
          )}
        </fieldset>

        {/* Geotagged photo evidence — required on new visits. */}
        <fieldset className="mt-4 rounded-xl border border-slate-200 p-4">
          <legend className="px-1.5 text-xs font-semibold tracking-wide text-slate-600 uppercase">
            Photo evidence {editing ? "" : "(required)"}
          </legend>

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleCapture}
            aria-label="Take photo with camera"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary !px-3.5 !py-1.5 text-xs"
              onClick={() => cameraInputRef.current?.click()}
              disabled={capturing}
            >
              <Icon name="map-pin" className="h-4 w-4" />
              {capturing
                ? "Processing…"
                : capture
                  ? "Retake photo"
                  : editing && visit?.has_photo
                    ? "Replace photo"
                    : "Take photo"}
            </button>
            {capture && (
              <button
                type="button"
                onClick={discardCapture}
                className="rounded-pill px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100"
              >
                Discard
              </button>
            )}
          </div>

          {capture && (
            <div className="mt-3 flex items-start gap-3">
              <img
                src={capture.photo.dataUrl}
                alt="Captured visit photo with location panel"
                className="h-28 w-auto max-w-[55%] rounded-lg border border-slate-200"
              />
              <dl className="text-[11px] leading-relaxed text-slate-600">
                <div>
                  <dt className="inline text-slate-500">Captured: </dt>
                  <dd className="inline font-semibold text-slate-900">
                    {capture.meta.capture_date} {capture.meta.capture_time} ({capture.meta.timezone_offset})
                  </dd>
                </div>
                <div>
                  <dt className="inline text-slate-500">Location: </dt>
                  <dd className="inline font-semibold text-slate-900">
                    {capture.meta.latitude !== null
                      ? `${capture.meta.latitude.toFixed(5)}, ${capture.meta.longitude.toFixed(5)}`
                      : "No GPS fix"}
                  </dd>
                </div>
                {capture.meta.address && (
                  <div>
                    <dt className="inline text-slate-500">Address: </dt>
                    <dd className="inline font-semibold text-slate-900">{capture.meta.address}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {captureNote ? (
            <p
              className={`mt-2 text-xs ${
                captureNote.tone === "error" ? "text-red-700" : "text-amber-700"
              }`}
            >
              {captureNote.text}
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              The photo gets a timestamp and GPS panel burned into its left side;
              its fix and clock fill the visit's location and timestamp.
              {editing
                ? visit?.has_photo
                  ? " Taking one replaces the current photo."
                  : " This visit has no photo yet — take one to attach it."
                : " Every new visit needs one."}
            </p>
          )}

          {errors.photo && (
            <p className="mt-1.5 text-xs font-medium text-red-600">{errors.photo}</p>
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

          {/* Voice dictation appends to the note; it never saves the visit. */}
          <VoiceInputButton
            hintId="visit-notes-voice-hint"
            onTranscript={(text) =>
              setForm((prev) => ({
                ...prev,
                notes: prev.notes ? `${prev.notes.trim()} ${text}` : text,
              }))
            }
          />
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
              "Log field visit"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
