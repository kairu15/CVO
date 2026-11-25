import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icons";
import { InlineAlert } from "../components/InlineAlert";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { OtpInput } from "../components/OtpInput";
import { PasswordStrength } from "../components/PasswordStrength";
import { PasswordToggle, TextField } from "../components/TextField";
import { authApi } from "../api/authApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { site } from "../config/site";
import { useSiteConfig } from "../hooks/useSiteConfig";

/** Server-side code lifetime; the countdown mirrors it, it does not enforce it. */
const OTP_TTL_SECONDS = 10 * 60;
const RESEND_SECONDS = 60;

function formatSeconds(total) {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Password reset — the code and password steps of the normal recovery flow:
 *
 *   /reset-password?email=... : enter the emailed six-digit code, then choose
 *                               a new password. The API returns a short-lived,
 *                               single-use ticket after verification; the
 *                               password form holds it in memory (never in the
 *                               URL) and sends it with the new password.
 *   /reset-password?token=...&email=... : an administrator's one-time
 *                               account-setup invite, completed through
 *                               Laravel's password broker.
 *
 * The OTP itself is hashed at rest, is never returned by the API, and is
 * consumed by the verification request. A successful reset signs the account
 * out everywhere and redirects to sign in.
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
  const [step, setStep] = useState(tokenMode ? "password" : "verify");
  const [otp, setOtp] = useState("");
  const [resetTicket, setResetTicket] = useState("");
  const [form, setForm] = useState({ password: "", password_confirmation: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [show, setShow] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // The login screen hands off with this state after sending the first code.
  const [codeSent, setCodeSent] = useState(Boolean(location.state?.resetSent));

  // Two clocks on the code step: how long the code remains valid, and how long
  // until another one may be requested (the server's 60-second resend guard).
  const [expiresIn, setExpiresIn] = useState(tokenMode ? 0 : OTP_TTL_SECONDS);
  const [resendIn, setResendIn] = useState(tokenMode ? 0 : RESEND_SECONDS);
  const [resending, setResending] = useState(false);

  const codeExpired = !tokenMode && expiresIn <= 0;
  const expiryLabel = useMemo(() => formatSeconds(expiresIn), [expiresIn]);

  // Leave the success message visible for a beat before the redirect.
  useEffect(() => {
    if (!done) return undefined;

    const timer = setTimeout(() => navigate("/login", { replace: true }), 2500);

    return () => clearTimeout(timer);
  }, [done, navigate]);

  // One clock for both countdowns; stops entirely once the password form is
  // shown (the ticket has its own, shorter server-side lifetime).
  useEffect(() => {
    if (step !== "verify" || tokenMode) return undefined;

    const timer = setInterval(() => {
      setExpiresIn((seconds) => Math.max(0, seconds - 1));
      setResendIn((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [step, tokenMode]);

  function update(field) {
    return (event) => {
      setForm((prev) => ({ ...prev, [field]: event.target.value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      setFormError(null);
    };
  }

  /** Mirrors the server's Password::defaults() policy before spending a call. */
  function validatePassword() {
    const next = {};

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

  async function handleVerify(event) {
    event.preventDefault();

    if (!/^\d{6}$/.test(otp)) {
      setErrors({ otp: t("resetPassword.errors.codeRequired") });
      return;
    }

    if (codeExpired) {
      setFormError(t("resetPassword.codeExpired"));
      return;
    }

    setVerifying(true);
    setErrors({});
    setFormError(null);

    try {
      const data = await authApi.verifyResetCode({
        email: email.trim(),
        otp,
      });

      // The ticket is the proof of verification. Kept in component state only:
      // refreshing (or sharing) the URL can never carry a usable credential.
      setResetTicket(data?.reset_token ?? "");
      setStep("password");
    } catch (error) {
      const fields = getFieldErrors(error);

      if (fields?.otp) setErrors({ otp: fields.otp });
      else if (fields?.email) setFormError(fields.email);
      else setFormError(getErrorMessage(error));
    } finally {
      setVerifying(false);
    }
  }

  async function handleReset(event) {
    event.preventDefault();

    const invalid = validatePassword();
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      return;
    }

    setSubmitting(true);
    setErrors({});
    setFormError(null);

    try {
      const payload = {
        email: email.trim(),
        password: form.password,
        password_confirmation: form.password_confirmation,
      };

      if (tokenMode) payload.token = token;
      else payload.reset_token = resetTicket;

      await authApi.resetPassword(payload);
      setDone(true);
    } catch (error) {
      const fields = getFieldErrors(error);

      if (fields?.reset_token) {
        // The ticket expired or was already used: send the user back to the
        // code step instead of leaving a password form that cannot succeed.
        setStep("verify");
        setResetTicket("");
        setExpiresIn(0);
        setFormError(fields.reset_token);
      } else if (fields?.token) {
        setFormError(fields.token);
      } else if (fields) {
        setErrors(fields);
      } else {
        setFormError(getErrorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (tokenMode || resendIn > 0 || resending) return;

    const target = email.trim();
    if (!target) {
      setFormError(t("resetPassword.errors.emailRequired"));
      return;
    }

    setResending(true);
    setFormError(null);

    try {
      await authApi.forgotPassword(target);
      // A new code replaces the old one server-side; reset the local clocks
      // and clear any half-typed code.
      setOtp("");
      setErrors({});
      setCodeSent(true);
      setExpiresIn(OTP_TTL_SECONDS);
      setResendIn(RESEND_SECONDS);
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
            {!pageUsable ? (
              <>
                <p className="eyebrow">{t("resetPassword.eyebrow")}</p>
                <h1 className="mt-2 font-display text-2xl font-bold text-slate-900">
                  {t("resetPassword.invalidLinkTitle")}
                </h1>
                <div className="mt-4 space-y-4">
                  <p className="text-sm text-slate-600">{t("resetPassword.invalidLinkBody")}</p>
                  <p className="text-xs text-slate-500">
                    {t("common.passwordResetPolicy", {
                      email: contact.email,
                      phone: contact.phone,
                    })}
                  </p>
                  <Link to="/forgot-password" className="btn-primary w-full">
                    {t("resetPassword.requestNewCode")}
                  </Link>
                </div>
              </>
            ) : done ? (
              <>
                <p className="eyebrow">{t("resetPassword.eyebrow")}</p>
                <h1 className="mt-2 font-display text-2xl font-bold text-slate-900">
                  {t("resetPassword.doneTitle")}
                </h1>
                <div className="mt-4" aria-live="polite">
                  <InlineAlert tone="success" message={t("resetPassword.success")} />
                </div>
              </>
            ) : step === "verify" ? (
              <>
                <p className="eyebrow">{t("resetPassword.eyebrow")}</p>
                <h1 className="mt-2 font-display text-2xl font-bold text-slate-900">
                  {t("resetPassword.verifyTitle")}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  {t("resetPassword.verifyIntro", { email })}
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

                <form onSubmit={handleVerify} noValidate className="mt-5">
                  <OtpInput
                    id="reset-otp"
                    label={t("resetPassword.otpLabel")}
                    value={otp}
                    onChange={(next) => {
                      setOtp(next);
                      setErrors((prev) => ({ ...prev, otp: undefined }));
                      setFormError(null);
                    }}
                    error={errors.otp}
                    disabled={verifying}
                    autoFocus
                  />

                  <div
                    className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs"
                    aria-live="polite"
                  >
                    {codeExpired ? (
                      <span className="font-medium text-red-600">
                        {t("resetPassword.codeExpired")}
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        {t("resetPassword.expiryIn", { time: expiryLabel })}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={resendIn > 0 || resending || verifying}
                      className="rounded font-semibold text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
                    >
                      {resending
                        ? t("resetPassword.resending")
                        : resendIn > 0
                          ? t("resetPassword.resendIn", { seconds: resendIn })
                          : t("resetPassword.resend")}
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={verifying || otp.length !== 6 || codeExpired}
                    aria-busy={verifying}
                    className="btn-primary mt-5 w-full py-3"
                  >
                    {verifying ? (
                      <>
                        <ButtonSpinner />
                        {t("resetPassword.verifying")}
                      </>
                    ) : (
                      t("resetPassword.verifySubmit")
                    )}
                  </button>
                </form>

                <Link
                  to="/forgot-password"
                  className="mt-5 flex items-center justify-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
                >
                  <Icon name="arrow-left" className="h-4 w-4" />
                  {t("resetPassword.differentEmail")}
                </Link>
              </>
            ) : (
              <>
                <p className="eyebrow">{t("resetPassword.eyebrow")}</p>
                <h1 className="mt-2 font-display text-2xl font-bold text-slate-900">
                  {t("resetPassword.title")}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  {tokenMode
                    ? t("resetPassword.intro", { email })
                    : t("resetPassword.verifiedIntro", { email })}
                </p>

                {formError && (
                  <div className="mt-4" aria-live="assertive">
                    <InlineAlert tone="error" message={formError} />
                  </div>
                )}

                <form onSubmit={handleReset} noValidate className="mt-5">
                  <div className="space-y-4">
                    <TextField
                      id="reset-password"
                      label={t("resetPassword.passwordLabel")}
                      type={show ? "text" : "password"}
                      autoComplete="new-password"
                      value={form.password}
                      onChange={update("password")}
                      error={errors.password}
                      trailing={
                        <PasswordToggle shown={show} onToggle={() => setShow((value) => !value)} />
                      }
                    />

                    <PasswordStrength password={form.password} />

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
                    aria-busy={submitting}
                    className="btn-primary mt-6 w-full py-3"
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

                <Link
                  to="/login"
                  className="mt-5 flex items-center justify-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
                >
                  <Icon name="arrow-left" className="h-4 w-4" />
                  {t("resetPassword.backToLogin")}
                </Link>
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
