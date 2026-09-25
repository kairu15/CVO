import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { findNearestBarangay, findNearestPurok } from "../api/beneficiariesApi";
import { ButtonSpinner } from "./LoadingSpinner";
import { Icon } from "./Icons";
import { PasswordToggle, TextField } from "./TextField";
import { RegisterLocationMap } from "./RegisterLocationMap";
import { useBarangays } from "../hooks/useBarangays";
import { useGeolocation } from "../hooks/useGeolocation";
import { usePuroks } from "../hooks/usePuroks";

const USERNAME_PATTERN = /^[a-z0-9_-]+$/;

/**
 * Public registration.
 *
 * Self-registration can only ever produce a farmer — the role field is locked
 * and the API ignores any role sent with the payload, so staff accounts stay
 * under the administrator's control.
 *
 * The address is a barangay dropdown (not free text, not coordinates): the
 * server resolves the chosen barangay name to a map pin automatically. The
 * optional map section only exists to fine-tune the pin to the exact farm
 * spot or capture a GPS fix.
 */
/**
 * @param {object} props
 * @param {string} [props.idPrefix] namespace for element ids — the sign-in form
 *   shares the page with this one on desktop, so ids must not collide.
 */
export function RegisterForm({ idPrefix = "register" }) {
  const { register } = useAuth();
  const navigate = useNavigate();
  const barangays = useBarangays();

  const [form, setForm] = useState({
    name: "",
    email: "",
    username: "",
    password: "",
    password_confirmation: "",

    // Dispersal details — become the beneficiary record that monitoring
    // auto-fills from. Optional: an account can be created without an animal
    // and the details added later by staff.
    name_of_farmer: "",
    address: "", // a barangay name from the coverage list
    purok_id: "", // id within the chosen barangay — cleared when the barangay changes
    animal_type: "",
    sex: "F",
    pin: null, // [lat, lng] — the farmer's ACTUAL spot: a GPS fix, a placed/dragged marker
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // GPS / map-pin auto-detection state. Suggestions are exactly that — the
  // farmer confirms or overrides them; nothing is ever auto-submitted.
  const [pinAccuracy, setPinAccuracy] = useState(null); // metres, GPS fix only
  const [pinFromGps, setPinFromGps] = useState(false);
  const [locationSource, setLocationSource] = useState("manual"); // gps | map_pin | manual
  const [barangaySuggestion, setBarangaySuggestion] = useState(null); // { id, name, distance_km, accuracy }
  const [purokSuggestion, setPurokSuggestion] = useState(null); // { id, name, distance_km }
  const [gpsNote, setGpsNote] = useState(null); // farmer-readable GPS outcome message

  // Derived cascade state — the select values drive the purok fetch and the
  // live map. Kept after the state declarations above (they read `form`).
  const selectedBarangay = useMemo(
    () => barangays.find((barangay) => barangay.name === form.address) ?? null,
    [barangays, form.address],
  );
  const { puroks, loading: puroksLoading } = usePuroks(selectedBarangay?.id ?? null);
  const selectedPurok = useMemo(
    () => puroks.find((purok) => String(purok.id) === String(form.purok_id)) ?? null,
    [puroks, form.purok_id],
  );

  const { locate, locating: locatingGps, error: gpsError } = useGeolocation();

  function update(field) {
    return (event) => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  /**
   * Barangay change: reset the purok with it, so a purok from the previous
   * barangay can never ride along under the new one (the cascade stays
   * consistent even before validation runs). Any pending detected-
   * purok suggestion dies with its parent barangay, and a manual pick
   * re-labels the location source.
   */
  function handleBarangayChange(event) {
    const { value } = event.target;
    setForm((prev) => ({ ...prev, address: value, purok_id: "" }));
    setErrors((prev) => ({ ...prev, address: undefined, purok_id: undefined }));
    setPurokSuggestion(null);
    setLocationSource("manual");
  }

  /**
   * GPS fix → nearest-centroid barangay suggestion. NEVER auto-selects:
   * the match is an approximation (center points, not boundaries — see
   * App\Support\Geo on the server), so the farmer confirms it first.
   */
  function handleUseMyLocation() {
    locate(({ latitude, longitude, accuracy }) => {
      setGpsNote(null);
      setBarangaySuggestion(null);
      setPinAccuracy(accuracy);
      setPinFromGps(true);
      setForm((prev) => ({ ...prev, pin: [latitude, longitude] }));
      setLocationSource("gps");

      findNearestBarangay(latitude, longitude)
        .then((match) => {
          if (!match) {
            setGpsNote(
              "We got your position, but it's outside the covered barangays — pick your barangay from the list.",
            );
            return;
          }
          setBarangaySuggestion({ ...match, accuracy });
        })
        .catch(() => {
          setGpsNote("Could not match your position to a barangay — pick from the list instead.");
        });
    });
  }

  /**
   * Confirm (or dismiss) the GPS-detected barangay. Confirming selects it
   * through the same path as a manual pick — the map pans, the purok list
   * loads — and the source stays "gps" only because the point came from GPS.
   */
  function acceptBarangaySuggestion() {
    if (!barangaySuggestion) return;

    const match = barangays.find((b) => b.id === barangaySuggestion.id);
    setBarangaySuggestion(null);

    if (!match) return;

    // Re-confirming the barangay that is already chosen keeps its purok; a
    // genuinely new barangay always resets the purok with it.
    setForm((prev) => ({
      ...prev,
      address: match.name,
      purok_id: prev.address === match.name ? prev.purok_id : "",
    }));
    setErrors((prev) => ({ ...prev, address: undefined, purok_id: undefined }));

    // The GPS point may already resolve to a purok of the confirmed
    // barangay — suggest it the same way, confirm-or-change.
    if (form.pin) {
      findNearestPurok(match.id, form.pin[0], form.pin[1])
        .then((purokMatch) => {
          if (purokMatch) setPurokSuggestion(purokMatch);
        })
        .catch(() => {
          // No purok coordinates yet — the select stays as-is.
        });
    }
  }

  function dismissBarangaySuggestion() {
    setBarangaySuggestion(null);
  }

  /**
   * Pin moved (drag, map click, or fresh GPS fix): re-match the nearest
   * purok within the chosen barangay. Barangays without purok coordinates
   * (the current "No puroks listed yet" state) simply answer null and the
   * field stays untouched — the auto-fill degrades gracefully as the real
   * purok data is added later.
   */
  function handlePinMove([lat, lng]) {
    setForm((prev) => ({ ...prev, pin: [lat, lng] }));
    setPinFromGps(false);
    setPinAccuracy(null);
    setLocationSource("map_pin");
    setPurokSuggestion(null);

    if (!selectedBarangay?.id) return;

    findNearestPurok(selectedBarangay.id, lat, lng)
      .then((match) => {
        if (match) setPurokSuggestion(match);
      })
      .catch(() => {
        // No purok suggestion is a fine outcome — leave the select alone.
      });
  }

  function acceptPurokSuggestion() {
    if (!purokSuggestion) return;
    setForm((prev) => ({ ...prev, purok_id: String(purokSuggestion.id) }));
    setPurokSuggestion(null);
  }

  function dismissPurokSuggestion() {
    setPurokSuggestion(null);
  }

  /** Mirrors the rules in App\Http\Requests\RegisterRequest. */
  function validate() {
    const next = {};

    if (!form.name.trim()) next.name = "Enter your full name.";

    if (!form.email.trim()) next.email = "Enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      next.email = "Enter a valid email address.";

    const username = form.username.trim();
    if (!username) next.username = "Choose a username.";
    else if (username.length < 3 || username.length > 30)
      next.username = "Use between 3 and 30 characters.";
    else if (!USERNAME_PATTERN.test(username))
      next.username = "Use lowercase letters, numbers, dashes or underscores only.";

    if (!form.password) next.password = "Choose a password.";
    else if (
      form.password.length < 8 ||
      !/[a-z]/.test(form.password) ||
      !/[A-Z]/.test(form.password) ||
      !/[0-9]/.test(form.password) ||
      !/[^A-Za-z0-9]/.test(form.password)
    )
      next.password =
        "Use at least 8 characters with upper and lower case, a number and a symbol.";

    if (!form.password_confirmation)
      next.password_confirmation = "Re-enter your password.";
    else if (form.password_confirmation !== form.password)
      next.password_confirmation = "Passwords do not match.";

    // A farmer's location must resolve to a specific purok for dispersal
    // tracking — a barangay alone is not enough once puroks are offered.
    if (form.address && !form.purok_id)
      next.purok_id = "Choose the purok/sitio of the farm.";

    if (form.pin && !form.address)
      next.address = "Choose the barangay your pin falls in.";

    return next;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);

    const invalid = validate();
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      return;
    }

    setSubmitting(true);
    try {
      await register({
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
        username: form.username.trim(),
        name_of_farmer: form.name_of_farmer.trim(),
        address: form.address,
        barangay_id: selectedBarangay?.id ?? undefined,
        purok_id: form.purok_id ? Number(form.purok_id) : undefined,
        animal_type: form.animal_type.trim(),
        // The geo-tag the rest of the system depends on: the farmer's actual
        // spot — a GPS fix, a placed/dragged pin — not just the barangay name.
        latitude: form.pin?.[0],
        longitude: form.pin?.[1],
        // How the location was captured, for later data-quality review.
        location_source: locationSource,
        pin: undefined,
      });
      navigate("/dashboard", { replace: true });
    } catch (error) {
      const fields = getFieldErrors(error);
      if (fields) setErrors(fields);
      else setFormError(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full">
      <h2 className="font-display text-2xl font-bold text-slate-900">
        Create your account
      </h2>
      <p className="mt-1.5 text-sm text-slate-500">
        For farmers and beneficiaries of the dispersal program.
      </p>

      {formError && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
        >
          {formError}
        </div>
      )}

      <div className="mt-5 space-y-3">
        <TextField
          id={`${idPrefix}-name`}
          label="Full name"
          type="text"
          autoComplete="name"
          placeholder="Juan Dela Cruz"
          value={form.name}
          onChange={update("name")}
          error={errors.name}
        />

        <TextField
          id={`${idPrefix}-email`}
          label="Email address"
          type="email"
          autoComplete="email"
          placeholder="juan@example.com"
          value={form.email}
          onChange={update("email")}
          error={errors.email}
        />

        <TextField
          id={`${idPrefix}-username`}
          label="Username"
          type="text"
          autoComplete="username"
          placeholder="juan_dela"
          value={form.username}
          onChange={update("username")}
          error={errors.username}
          hint="Lowercase letters, numbers, dashes or underscores."
        />

        <TextField
          id={`${idPrefix}-password`}
          label="Password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          placeholder="Create a password"
          value={form.password}
          onChange={update("password")}
          error={errors.password}
          hint="At least 8 characters with upper and lower case, a number and a symbol."
          trailing={
            <PasswordToggle
              shown={showPassword}
              onToggle={() => setShowPassword((shown) => !shown)}
            />
          }
        />

        <TextField
          id={`${idPrefix}-password_confirmation`}
          label="Confirm password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          placeholder="Re-enter your password"
          value={form.password_confirmation}
          onChange={update("password_confirmation")}
          error={errors.password_confirmation}
        />

        <div>
          <label
            htmlFor={`${idPrefix}-role`}
            className="block text-sm font-medium text-slate-700"
          >
            Role
          </label>
          <select
            id={`${idPrefix}-role`}
            name="role"
            defaultValue="farmer"
            disabled
            className="field mt-1.5"
          >
            <option value="farmer">Farmer / Beneficiary</option>
          </select>
          <p className="mt-1.5 text-xs text-slate-500">
            Staff accounts (Administrator, Veterinarian, Field Technician) are
            created by the CVO administrator.
          </p>
        </div>
      </div>

      <fieldset className="mt-5 rounded-xl border border-brand-200 bg-brand-50/50 p-4">
        <legend className="px-1.5 text-xs font-semibold tracking-wide text-brand-800 uppercase">
          Dispersal details (optional)
        </legend>
        <p className="mb-3 text-xs text-slate-500">
          Register the animal you received. These details pre-fill every
          monitoring form, so they are only ever captured here.
        </p>

        <div className="space-y-3">
          <TextField
            id={`${idPrefix}-name_of_farmer`}
            label="Name of Farmer"
            type="text"
            placeholder="Leave empty to use your full name"
            value={form.name_of_farmer}
            onChange={update("name_of_farmer")}
            error={errors.name_of_farmer}
          />

          <div>
            <label
              htmlFor={`${idPrefix}-address`}
              className="block text-sm font-medium text-slate-700"
            >
              Barangay
            </label>
            <select
              id={`${idPrefix}-address`}
              name="address"
              className="field mt-1.5"
              value={form.address}
              onChange={handleBarangayChange}
            >
              <option value="">Select barangay…</option>
              {barangays.map((barangay) => (
                <option key={barangay.id ?? barangay.name} value={barangay.name}>
                  {barangay.name}
                </option>
              ))}
            </select>
            {errors.address ? (
              <p className="mt-1.5 text-xs font-medium text-red-600">
                {errors.address}
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-slate-500">
                The map pans to the barangay as soon as it is chosen.
              </p>
            )}

            {/* GPS auto-detect: a suggestion the farmer confirms — never a
                silent auto-select. The dropdown stays the always-valid path
                when permission is denied or geolocation is unavailable. */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                className="btn-secondary !px-3.5 !py-1.5 text-xs"
                onClick={handleUseMyLocation}
                disabled={locatingGps}
              >
                <Icon name="locate-fixed" className="h-4 w-4" />
                {locatingGps
                  ? "Locating…"
                  : pinFromGps
                    ? "Re-check my location"
                    : "Use my location"}
              </button>
              <span className="text-xs text-slate-500">
                Detects your barangay from GPS — you confirm it.
              </span>
            </div>

            {gpsNote ? (
              <p
                role="status"
                className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
              >
                {gpsNote}
              </p>
            ) : (
              gpsError && (
                // Hook-level failures (permission denied, insecure context,
                // timeout) surface inline — the dropdown stays the always-
                // valid path and nothing fails silently.
                <p
                  role="alert"
                  className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                >
                  {gpsError}
                </p>
              )
            )}

            {barangaySuggestion && (
              <div
                role="status"
                className="mt-2 rounded-lg border border-brand-200 bg-white px-3 py-2.5 text-xs text-slate-600"
              >
                <p>
                  <span className="font-semibold text-brand-800">
                    Detected: {barangaySuggestion.name}
                  </span>{" "}
                  — {barangaySuggestion.distance_km} km from its center point
                  {barangaySuggestion.accuracy
                    ? `, GPS fix ±${Math.round(barangaySuggestion.accuracy)} m`
                    : ""}
                  . Is this correct?
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary !px-3 !py-1 text-xs"
                    onClick={acceptBarangaySuggestion}
                  >
                    <Icon name="check" className="h-3.5 w-3.5" />
                    Yes, use it
                  </button>
                  <button
                    type="button"
                    className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
                    onClick={dismissBarangaySuggestion}
                  >
                    No — I'll pick it myself
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor={`${idPrefix}-purok`}
              className="block text-sm font-medium text-slate-700"
            >
              Purok / Sitio
            </label>
            <select
              id={`${idPrefix}-purok`}
              name="purok_id"
              className="field mt-1.5"
              value={form.purok_id}
              onChange={update("purok_id")}
              disabled={!form.address || puroks.length === 0}
            >
              <option value="">
                {!form.address
                  ? "Select a barangay first…"
                  : puroksLoading
                    ? "Loading puroks…"
                    : puroks.length === 0
                      ? "No puroks listed yet"
                      : "Select purok/sitio…"}
              </option>
              {puroks.map((purok) => (
                <option key={purok.id} value={purok.id}>
                  {purok.name}
                  {purok.is_placeholder ? " (to be confirmed)" : ""}
                </option>
              ))}
            </select>
            {errors.purok_id ? (
              <p className="mt-1.5 text-xs font-medium text-red-600">
                {errors.purok_id}
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-slate-500">
                {puroks.some((purok) => purok.is_placeholder)
                  ? "Some purok names are placeholders until the CVO confirms the official list."
                  : "The finest location grain — what dispersal tracking resolves against."}
              </p>
            )}

            {purokSuggestion && (
              <div
                role="status"
                className="mt-2 rounded-lg border border-brand-200 bg-white px-3 py-2.5 text-xs text-slate-600"
              >
                <p>
                  <span className="font-semibold text-brand-800">
                    Detected: {purokSuggestion.name}
                  </span>{" "}
                  — {purokSuggestion.distance_km} km from the pin. Confirm or
                  change it.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary !px-3 !py-1 text-xs"
                    onClick={acceptPurokSuggestion}
                  >
                    <Icon name="check" className="h-3.5 w-3.5" />
                    Use this purok
                  </button>
                  <button
                    type="button"
                    className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
                    onClick={dismissPurokSuggestion}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor={`${idPrefix}-animal_type`}
                className="block text-sm font-medium text-slate-700"
              >
                Type of Animal dispersed
              </label>
              <select
                id={`${idPrefix}-animal_type`}
                className="field mt-1.5"
                value={form.animal_type}
                onChange={update("animal_type")}
              >
                <option value="">Select animal…</option>
                <option>Carabao</option>
                <option>Cattle</option>
                <option>Goat</option>
                <option>Swine</option>
                <option>Boar</option>
              </select>
              {errors.animal_type && (
                <p className="mt-1.5 text-xs font-medium text-red-600">{errors.animal_type}</p>
              )}
            </div>

            <div>
              <label
                htmlFor={`${idPrefix}-sex`}
                className="block text-sm font-medium text-slate-700"
              >
                Sex of animal
              </label>
              <select
                id={`${idPrefix}-sex`}
                className="field mt-1.5"
                value={form.sex}
                onChange={update("sex")}
              >
                <option value="F">Female (F)</option>
                <option value="M">Male (M)</option>
              </select>
            </div>
          </div>
        </div>

        {form.address ? (
          <div className="mt-4">
            <RegisterLocationMap
              barangays={barangays}
              barangay={selectedBarangay}
              purok={selectedPurok}
              pin={form.pin}
              accuracy={pinAccuracy}
              onPinMove={handlePinMove}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Drag the marker or click the map to pin the exact farm spot — the
              purok is re-detected from the pin when the barangay lists purok
              coordinates.
            </p>
          </div>
        ) : (
          <p className="mt-4 text-xs text-slate-500">
            Pick a barangay above to see it on the map and pin the exact spot.
          </p>
        )}
      </fieldset>

      <button type="submit" disabled={submitting} className="btn-primary mt-5 w-full">
        {submitting ? (
          <>
            <ButtonSpinner />
            Creating account…
          </>
        ) : (
          "Create account"
        )}
      </button>
    </form>
  );
}
