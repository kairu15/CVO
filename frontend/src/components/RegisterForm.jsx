import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { ButtonSpinner } from "./LoadingSpinner";
import { PasswordToggle, TextField } from "./TextField";

const USERNAME_PATTERN = /^[a-z0-9_-]+$/;

/**
 * Public registration.
 *
 * Self-registration can only ever produce a farmer — the role field is locked
 * and the API ignores any role sent with the payload, so staff accounts stay
 * under the administrator's control.
 */
/**
 * @param {object} props
 * @param {string} [props.idPrefix] namespace for element ids — the sign-in form
 *   shares the page with this one on desktop, so ids must not collide.
 */
export function RegisterForm({ idPrefix = "register" }) {
  const { register } = useAuth();
  const navigate = useNavigate();

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
    address: "",
    animal_type: "",
    sex: "F",
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function update(field) {
    return (event) => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
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
        address: form.address.trim(),
        animal_type: form.animal_type.trim(),
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

            <TextField
              id={`${idPrefix}-address`}
              label="Address (barangay / sitio)"
              type="text"
              autoComplete="street-address"
              placeholder="e.g. Banay Banay"
              value={form.address}
              onChange={update("address")}
              error={errors.address}
            />

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
