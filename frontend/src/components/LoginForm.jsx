import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { site } from "../config/site";
import { ButtonSpinner } from "./LoadingSpinner";
import { PasswordToggle, TextField } from "./TextField";

/**
 * @param {object} props
 * @param {string} [props.idPrefix] namespace for element ids — the sign-up form
 *   shares the page with this one on desktop, so ids must not collide.
 */
export function LoginForm({ idPrefix = "login" }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ identifier: "", password: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showResetNote, setShowResetNote] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function update(field) {
    return (event) => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  function validate() {
    const next = {};
    if (!form.identifier.trim()) {
      next.identifier = "Enter your username or email address.";
    }
    if (!form.password) {
      next.password = "Enter your password.";
    }
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
      await login(form.identifier.trim(), form.password);
      // /dashboard resolves to the signed-in user's own role dashboard.
      navigate(location.state?.from?.pathname ?? "/dashboard", { replace: true });
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
        Welcome back
      </h2>
      <p className="mt-1.5 text-sm text-slate-500">
        Sign in with the account issued by the {site.office}.
      </p>

      {formError && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
        >
          {formError}
        </div>
      )}

      <div className="mt-6 space-y-4">
        <TextField
          id={`${idPrefix}-identifier`}
          label="Username or email"
          type="text"
          autoComplete="username"
          placeholder="juan_dela or juan@example.com"
          value={form.identifier}
          onChange={update("identifier")}
          error={errors.identifier}
        />

        <TextField
          id={`${idPrefix}-password`}
          label="Password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          placeholder="Enter your password"
          value={form.password}
          onChange={update("password")}
          error={errors.password}
          trailing={
            <PasswordToggle
              shown={showPassword}
              onToggle={() => setShowPassword((shown) => !shown)}
            />
          }
        />
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowResetNote((shown) => !shown)}
          className="text-xs font-semibold text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
        >
          Forgot password?
        </button>
      </div>

      {showResetNote && (
        <p className="mt-3 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-xs text-brand-900">
          Password resets are handled by the CVO administrator for security
          reasons. Contact {site.email} or call {site.phone} to request a new
          password.
        </p>
      )}

      <button type="submit" disabled={submitting} className="btn-primary mt-6 w-full">
        {submitting ? (
          <>
            <ButtonSpinner />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </button>
    </form>
  );
}
