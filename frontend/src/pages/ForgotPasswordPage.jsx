import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icons";
import { InlineAlert } from "../components/InlineAlert";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { TextField } from "../components/TextField";
import { authApi } from "../api/authApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { site } from "../config/site";

/**
 * Step 1 of password recovery: ask for the account email.
 *
 * The response is deliberately generic — the screen never says whether the
 * address exists. On success it moves to the code screen, which is where the
 * six-digit OTP is entered and verified server-side.
 */
export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    const target = email.trim();

    if (!target) {
      setError(t("forgotPassword.errors.emailRequired"));
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setError(t("forgotPassword.errors.emailInvalid"));
      return;
    }

    setSubmitting(true);
    setError(null);
    setFormError(null);

    try {
      await authApi.forgotPassword(target);
      navigate(`/reset-password?email=${encodeURIComponent(target)}`, {
        state: { resetSent: true },
      });
    } catch (requestError) {
      const fields = getFieldErrors(requestError);

      if (fields?.email) setError(fields.email);
      else setFormError(getErrorMessage(requestError));
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

          <Link
            to="/login"
            className="inline-flex shrink-0 items-center gap-2 rounded-pill px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            <Icon name="arrow-left" className="h-4 w-4" />
            <span className="hidden sm:inline">{t("forgotPassword.backToLogin")}</span>
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center py-8">
          <section className="card w-full max-w-md p-6 sm:p-8">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-200 dark:bg-brand-100 dark:ring-brand-200/60">
              <Icon name="lock" className="h-5 w-5" />
            </span>

            <p className="eyebrow mt-4">{t("forgotPassword.eyebrow")}</p>
            <h1 className="mt-1 font-display text-2xl font-bold text-slate-900">
              {t("forgotPassword.title")}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              {t("forgotPassword.subtitle")}
            </p>

            {formError && (
              <div className="mt-4" aria-live="assertive">
                <InlineAlert tone="error" message={formError} />
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="mt-5">
              <TextField
                id="forgot-email"
                label={t("forgotPassword.emailLabel")}
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={t("forgotPassword.emailPlaceholder")}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError(null);
                  setFormError(null);
                }}
                error={error}
                hint={t("forgotPassword.emailHint")}
                autoFocus
              />

              <button
                type="submit"
                disabled={submitting}
                aria-busy={submitting}
                className="btn-primary mt-5 w-full py-3"
              >
                {submitting ? (
                  <>
                    <ButtonSpinner />
                    {t("forgotPassword.submitting")}
                  </>
                ) : (
                  t("forgotPassword.submit")
                )}
              </button>
            </form>

            <p className="mt-5 text-center text-xs text-slate-400">
              {t("forgotPassword.noEmailNote")}
            </p>

            <Link
              to="/login"
              className="mt-4 flex items-center justify-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
            >
              <Icon name="arrow-left" className="h-4 w-4" />
              {t("forgotPassword.backToLogin")}
            </Link>
          </section>
        </main>
      </div>
    </div>
  );
}
