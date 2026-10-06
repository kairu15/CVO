import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icons";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { InlineAlert } from "../components/InlineAlert";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { PasswordToggle, TextField } from "../components/TextField";
import { authApi } from "../api/authApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { site } from "../config/site";
import { useSiteConfig } from "../hooks/useSiteConfig";

/**
 * Password reset — the page the emailed link opens.
 *
 * The backend (PasswordResetController) emails a URL of the shape
 *   {FRONTEND_URL}/reset-password?token=…&email=…
 * so this screen is public and reads the token/email straight from the query
 * string. The token is single-use and time-limited (auth.passwords.users
 * .expire); a replayed or expired one comes back as a 422 on submit.
 *
 * A successful reset signs the account out everywhere server-side, so the only
 * sensible next step is back to the sign-in form.
 */
export default function ResetPasswordPage() {
  const { t } = useTranslation();
  // Office contact details from System Settings (public read path), so the
  // note quotes the number the office actually answers.
  const { contact } = useSiteConfig();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const token = params.get("token") ?? "";
  const email = params.get("email") ?? "";
  const linkUsable = Boolean(token && email);

  const [form, setForm] = useState({ password: "", password_confirmation: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Leave the success message visible for a beat before the redirect.
  useEffect(() => {
    if (!done) return undefined;

    const timer = setTimeout(() => navigate("/login", { replace: true }), 2500);

    return () => clearTimeout(timer);
  }, [done, navigate]);

  function update(field) {
    return (event) => {
      setForm((prev) => ({ ...prev, [field]: event.target.value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      setFormError(null);
    };
  }

  /** Mirrors the server's Password::defaults() policy before spending a call. */
  function validate() {
    const next = {};

    if (!form.password) next.password = t("register.errors.passwordRequired");
    else if (
      form.password.length < 8 ||
      !/[a-z]/.test(form.password) ||
      !/[A-Z]/.test(form.password) ||
      !/[0-9]/.test(form.password) ||
      !/[^A-Za-z0-9]/.test(form.password)
    )
      next.password = t("register.errors.passwordWeak");

    if (form.password_confirmation !== form.password)
      next.password_confirmation = t("register.errors.passwordMismatch");

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
      await authApi.resetPassword({ token, email, ...form });
      setDone(true);
    } catch (error) {
      const fields = getFieldErrors(error);

      // The broker reports a bad/expired token as a `token` error, which has
      // no field on screen — surface it as a form-level message instead.
      if (fields?.token) setFormError(fields.token);
      else if (fields) setErrors(fields);
      else setFormError(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand-200/50 blur-3xl" />
        <div className="absolute -right-20 bottom-0 h-96 w-96 rounded-full bg-earth-100/70 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6">
        <header className="flex shrink-0 items-center justify-between gap-4">
          <Link
            to="/"
            className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-700"
          >
            <Brand subtitle={`${site.city}, ${site.province}`} />
          </Link>

          <div className="flex shrink-0 items-center gap-2">
            <LanguageSwitcher />
            <Link
              to="/login"
              className="inline-flex shrink-0 items-center gap-2 rounded-pill px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
            >
              <Icon name="arrow-left" className="h-4 w-4" />
              <span className="hidden sm:inline">{t("resetPassword.backToLogin")}</span>
            </Link>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center py-8">
          <section className="card w-full max-w-md p-6 sm:p-8">
            <p className="eyebrow">{t("resetPassword.eyebrow")}</p>
            <h1 className="mt-2 font-display text-2xl font-bold text-slate-900">
              {t("resetPassword.title")}
            </h1>

            {!linkUsable ? (
              <div className="mt-4 space-y-4">
                <InlineAlert tone="error" message={t("resetPassword.invalidLinkTitle")} />
                <p className="text-sm text-slate-600">
                  {t("resetPassword.invalidLinkBody")}
                </p>
                <p className="text-xs text-slate-500">
                  {t("common.passwordResetPolicy", {
                    email: contact.email,
                    phone: contact.phone,
                  })}
                </p>
                <Link to="/login" className="btn-primary w-full">
                  {t("resetPassword.backToLogin")}
                </Link>
              </div>
            ) : done ? (
              <div className="mt-4">
                <InlineAlert tone="success" message={t("resetPassword.success")} />
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="mt-4">
                <p className="text-sm text-slate-500">
                  {t("resetPassword.intro", { email })}
                </p>

                {formError && (
                  <div className="mt-4">
                    <InlineAlert tone="error" message={formError} />
                  </div>
                )}

                <div className="mt-5 space-y-4">
                  <TextField
                    id="reset-password"
                    label={t("resetPassword.passwordLabel")}
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    value={form.password}
                    onChange={update("password")}
                    error={errors.password}
                    hint={t("register.passwordHint")}
                    trailing={
                      <PasswordToggle shown={show} onToggle={() => setShow((s) => !s)} />
                    }
                  />

                  <TextField
                    id="reset-password-confirmation"
                    label={t("resetPassword.confirmLabel")}
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    value={form.password_confirmation}
                    onChange={update("password_confirmation")}
                    error={errors.password_confirmation}
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary mt-6 w-full"
                >
                  {submitting ? (
                    <>
                      <ButtonSpinner />
                      {t("resetPassword.submitting")}
                    </>
                  ) : (
                    t("resetPassword.submit")
                  )}
                </button>
              </form>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
