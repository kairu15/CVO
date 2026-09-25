import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { getFieldErrors } from "../api/client";
import { ButtonSpinner } from "./LoadingSpinner";
import { Skeleton } from "./Skeleton";
import { PasswordToggle, TextField } from "./TextField";
import { useBarangays } from "../hooks/useBarangays";
import { site } from "../config/site";

const USERNAME_PATTERN = /^[a-z0-9_-]+$/;

/**
 * Public registration.
 *
 * Self-registration can only ever produce a farmer — the role field is locked
 * and the API ignores any role sent with the payload, so staff accounts stay
 * under the administrator's control.
 *
 * The location is a single barangay dropdown (not free text): the server
 * resolves the chosen barangay name to its structured id. Purok, GPS and map
 * capture are not part of registration — the API and database still accept
 * them, so they can be reintroduced when the CVO has verified purok data.
 */
/**
 * @param {object} props
 * @param {string} [props.idPrefix] namespace for element ids — the sign-in form
 *   shares the page with this one on desktop, so ids must not collide.
 */
export function RegisterForm({ idPrefix = "register" }) {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [barangays, barangaysStatus] = useBarangays();

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
    animal_type: "",
    sex: "F",
  });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Success feedback before the redirect. The banner renders only after a
   * real 2xx from the API — never optimistically — and the timer is cleaned
   * up on unmount so a fast farmer (or a strict-mode double-mount) can't
   * trigger a redirect from a dead component.
   */
  const [succeeded, setSucceeded] = useState(false);
  const redirectTimer = useRef(null);
  const REDIRECT_DELAY_MS = 1800;

  const selectedBarangay = useMemo(
    () => barangays.find((barangay) => barangay.name === form.address) ?? null,
    [barangays, form.address],
  );

  function update(field) {
    return (event) => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  // Clear the pending redirect when the form unmounts (mode switch,
  // desktop/mobile panel swap) so no timer fires into a dead component.
  useEffect(() => {
    return () => window.clearTimeout(redirectTimer.current);
  }, []);

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

    return next;
  }

  async function handleSubmit(event) {
    event.preventDefault();

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
        animal_type: form.animal_type.trim(),
      });

      // 2xx received — success is real, never optimistic. The toast is
      // global, so it stays visible across the redirect to sign-in.
      setSucceeded(true);
      toast.success("Account created successfully. Redirecting you to sign in…");
      redirectTimer.current = window.setTimeout(() => {
        // Hand the identifier to the sign-in form via route state so the
        // farmer doesn't retype it. /login's GuestRoute renders LoginForm,
        // which reads location.state?.prefill.
        navigate("/login", {
          replace: true,
          state: { prefill: form.email.trim() },
        });
      }, REDIRECT_DELAY_MS);
    } catch (error) {
      const fields = getFieldErrors(error);
      if (fields) {
        setErrors(fields);
      } else {
        // No field-level guidance from the API — global toast.
        toast.error(getErrorMessage(error));
      }

      // Standard practice on a failed attempt: drop the passwords but keep
      // every other field, so the farmer only fixes what the API flagged.
      setForm((prev) => ({ ...prev, password: "", password_confirmation: "" }));
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
        For farmers and beneficiaries of the {site.office} dispersal program.
      </p>

      <div className="mt-5 space-y-3">
        <TextField
          id={`${idPrefix}-name`}
          label="Full name"
          type="text"
          autoComplete="name"
          placeholder="Enter your full name"
          value={form.name}
          onChange={update("name")}
          error={errors.name}
        />

        <TextField
          id={`${idPrefix}-email`}
          label="Email address"
          type="email"
          autoComplete="email"
          placeholder="Enter your email address"
          value={form.email}
          onChange={update("email")}
          error={errors.email}
        />

        <TextField
          id={`${idPrefix}-username`}
          label="Username"
          type="text"
          autoComplete="username"
          placeholder="Enter your username"
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
          placeholder="Enter your password"
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
          monitoring form and are captured only here.
        </p>

        <div className="space-y-3">
          <TextField
            id={`${idPrefix}-name_of_farmer`}
            label="Name of farmer"
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
            {barangaysStatus === "loading" ? (
              // Skeleton while the coverage list is being fetched — mirrors
              // the select's footprint so the swap doesn't reflow.
              <Skeleton className="field mt-1.5 h-11" />
            ) : (
              <select
                id={`${idPrefix}-address`}
                name="address"
                className="field mt-1.5"
                value={form.address}
                onChange={update("address")}
              >
                <option value="">Select barangay…</option>
                {barangays.map((barangay) => (
                  <option key={barangay.id ?? barangay.name} value={barangay.name}>
                    {barangay.name}
                  </option>
                ))}
              </select>
            )}
            {errors.address ? (
              <p className="mt-1.5 text-xs font-medium text-red-600">
                {errors.address}
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-slate-500">
                Select the barangay where the farm is located.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor={`${idPrefix}-animal_type`}
                className="block text-sm font-medium text-slate-700"
              >
                Type of animal dispersed
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
      </fieldset>

      <button
        type="submit"
        disabled={submitting || succeeded}
        className="btn-primary mt-5 w-full"
      >
        {submitting ? (
          <>
            <ButtonSpinner />
            Creating your account…
          </>
        ) : (
          "Create account"
        )}
      </button>
    </form>
  );
}
