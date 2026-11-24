import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icons";
import { InlineAlert } from "../components/InlineAlert";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { PasswordToggle, TextField } from "../components/TextField";
import { authApi } from "../api/authApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { site } from "../config/site";
import { useSiteConfig } from "../hooks/useSiteConfig";

/**
 * Password reset — two paths share this public screen:
 *
 *   - /reset-password?email=... : the normal six-digit email OTP flow.
 *   - /reset-password?token=...&email=... : an administrator's one-time
 *     account-setup invite, completed through Laravel's password broker.
 *
 * The OTP is never stored in the URL. It is typed (or pasted) into a numeric
 * field, sent once, and the server stores only its hash. A successful reset
 * signs the account out everywhere and redirects to sign in.
 */
export default function ResetPasswordPage() {
  const { t } = useTranslation();
  // Office contact details from System Settings (public read path), so the
  // note quotes the number the office actually answers.
  const { contact } = useSiteConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const token = params.get("token") ?? "";
  const emailParam = params.get("email") ?? "";
  const tokenMode = Boolean(token && emailParam);
  const pageUsable = tokenMode || Boolean(emailParam);

  const [email, setEmail] = useState(emailParam);
  const [otp, setOtp] = useState("");
  const [form, setForm] = useState({ password: "", password_confirmation: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // The login screen hands off with this state after sending the first code;
  // a direct visit simply starts with no confirmation banner.
  const [codeSent, setCodeSent] = useState(Boolean(location.state?.resetSent));
  // Arriving from the login hand-off, the server's 60-second resend guard has
  // just started. A direct OTP visit starts the countdown too, which avoids
  // hammering the endpoint before the first code can have arrived.
  const [countdown, setCountdown] = useState(tokenMode ? 0 : 60);
  const [resending, setResending] = useState(false);

  // Leave the success message visible for a beat before the redirect.
  useEffect(() => {
    if (!done) return undefined;

    const timer = setTimeout(() => navigate("/login", { replace: true }), 2500);

    return () => clearTimeout(timer);
  }, [done, navigate]);

  useEffect(() => {
    if (countdown <= 0) return undefined;

    const timer = setTimeout(() => setCountdown((seconds) => Math.max(0, seconds - 1)), 1000);

    return () => clearTimeout(timer);
  }, [countdown]);

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

    if (!email.trim()) next.email = t("resetPassword.errors.emailRequired");

    if (!tokenMode && !/^\d{6}$/.test(otp)) {
      next.otp = t("resetPassword.errors.codeRequired");
    }

    if (!form.password) next.password = t("resetPassword.errors.passwordRequired");
    else if (
      form.password.length < 8 ||
      !/[a-z]/.test(form.password) ||
      !/[A-Z]/.test(form.password) ||
      !/[0-9]/.test(form.password) ||
      !/[^A-Za-z0-9]/.test(form.password)
    )
      next.password = t("resetPassword.errors.passwordWeak");

    if (form.password_confirmation !== form.password)
      next.password_confirmation = t("resetPassword.errors.passwordMismatch");

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
      const payload = {
        email: email.trim(),
        password: form.password,
        password_confirmation: form.password_confirmation,
      };

      if (tokenMode) payload.token = token;
      else payload.otp = otp;

      await authApi.resetPassword(payload);
      setDone(true);
    } catch (error) {
      const fields = getFieldErrors(error);

      // A bad/expired invite token has no input on screen; surface it above
      // the form. A bad/expired OTP belongs on the code field.
      if (fields?.token) setFormError(fields.token);
      else if (fields) setErrors(fields);
      else setFormError(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (tokenMode || countdown > 0 || resending) return;

    const target = email.trim();
    if (!target) {
      setErrors((prev) => ({ ...prev, email: t("resetPassword.errors.emailRequired") }));
      return;
    }

    setResending(true);
    setFormError(null);

    try {
      await authApi.forgotPassword(target);
      setCodeSent(true);
      setCountdown(60);
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setResending(false);
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

            {!pageUsable ? (
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
              <div className="mt-4" aria-live="polite">
                <InlineAlert tone="success" message={t("resetPassword.success")} />
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="mt-4">
                <p className="text-sm text-slate-500">
                  {tokenMode
                    ? t("resetPassword.intro", { email })
                    : t("resetPassword.otpIntro", { email })}
                </p>

                {codeSent && (
                  <div className="mt-4" aria-live="polite">
                    <InlineAlert tone="info" message={t("resetPassword.codeSent")} />
                  </div>
                )}

                {formError && (
                  <div className="mt-4" aria-live="assertive">
                    <InlineAlert tone="error" message={formError} />
                  </div>
                )}

                <div className="mt-5 space-y-4">
                  <TextField
                    id="reset-email"
                    label={t("resetPassword.emailLabel")}
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setErrors((prev) => ({ ...prev, email: undefined }));
                      setFormError(null);
                    }}
                    error={errors.email}
                    readOnly={tokenMode}
                    hint={
                      tokenMode
                        ? t("resetPassword.tokenEmailHint", { email: emailParam })
                        : undefined
                    }
                  />

                  {!tokenMode && (
                    <TextField
                      id="reset-otp"
                      label={t("resetPassword.otpLabel")}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder={t("resetPassword.otpPlaceholder")}
                      value={otp}
                      onChange={(event) => {
                        // Paste-friendly and digits-only: strip separators and
                        // cap at the server's six digits.
                        setOtp(event.target.value.replace(/\D/g, "").slice(0, 6));
                        setErrors((prev) => ({ ...prev, otp: undefined }));
                        setFormError(null);
                      }}
                      error={errors.otp}
                      hint={t("resetPassword.otpHint")}
                    />
                  )}

                  <TextField
                    id="reset-password"
                    label={t("resetPassword.passwordLabel")}
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    value={form.password}
                    onChange={update("password")}
                    error={errors.password}
                    hint={t("resetPassword.passwordHint")}
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

                {!tokenMode && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={countdown > 0 || resending}
                      className="btn-secondary !px-3.5 !py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {resending ? (
                        <>
                          <ButtonSpinner />
                          {t("resetPassword.resending")}
                        </>
                      ) : countdown > 0 ? (
                        t("resetPassword.resendIn", { seconds: countdown })
                      ) : (
                        <>
                          <Icon name="refresh" className="h-3.5 w-3.5" />
                          {t("resetPassword.resend")}
                        </>
                      )}
                    </button>
                  </div>
                )}

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
