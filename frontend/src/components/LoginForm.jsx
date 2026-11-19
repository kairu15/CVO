import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { authApi } from "../api/authApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { site } from "../config/site";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { takeSessionNotice } from "../lib/sessionNotice";
import {
  readRememberedIdentifier,
  rememberIdentifier,
} from "../lib/rememberedLogin";
import { ButtonSpinner } from "./LoadingSpinner";
import { InlineAlert } from "./InlineAlert";
import { Icon } from "./Icons";
import { PasswordToggle, TextField } from "./TextField";

/** Notice code → translation key, shown once above the form. */
const NOTICE_KEYS = {
  expired: "session.expired",
  inactivity: "session.inactivity",
};

/**
 * @param {object} props
 * @param {string} [props.idPrefix] namespace for element ids, so an embedding
 *   page can mount more than one auth surface without duplicate ids.
 */
export function LoginForm({ idPrefix = "login" }) {
  const { t } = useTranslation();
  // The office's own contact details (System Settings), so the reset note
  // quotes the phone number the office actually answers.
  const { contact } = useSiteConfig();
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // Route state prefill: a hand-off (e.g. the account-setup link) can pass
  // the email in so it isn't retyped. Falls back to the redirect-target
  // capture used by ProtectedRoute.
  const [form, setForm] = useState(() => {
    // "Remember me" from a previous visit: pre-fill the identifier and reflect
    // that choice in the checkbox, so the user does not retype it.
    const remembered = readRememberedIdentifier();

    return {
      identifier: location.state?.prefill ?? remembered,
      password: "",
      remember: Boolean(remembered),
    };
  });

  // Why the last session ended (expired / inactivity), claimed once so the
  // redirect is explained instead of silently dropping the user here.
  const [notice] = useState(() => takeSessionNotice());
  const [errors, setErrors] = useState({});
  // Authentication failures that are not tied to one field (network, 429,
  // server error) stay on the page instead of a toast the user can miss.
  const [formError, setFormError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Bumped after a failed attempt so the focus effect runs once per submit
  // (not on every keystroke that clears a field error).
  const [focusRequest, setFocusRequest] = useState(0);
  const formRef = useRef(null);

  // "Forgot password?" — request a reset link by email.
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetStatus, setResetStatus] = useState("idle"); // idle | sending | sent
  const [resetError, setResetError] = useState(null);

  // Move focus to the first invalid field after validation or a 422, so a
  // keyboard/screen-reader user lands on the field that needs attention.
  useEffect(() => {
    if (focusRequest === 0) return;
    formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  function update(field) {
    return (event) => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      setFormError(null);
    };
  }

  function validate() {
    const next = {};
    if (!form.identifier.trim()) {
      next.identifier = t("login.errors.identifier");
    }
    if (!form.password) {
      next.password = t("login.errors.password");
    }
    return next;
  }

  /** Warn about Caps Lock rather than letting it cause a failed sign-in. */
  function trackCapsLock(event) {
    if (typeof event.getModifierState === "function") {
      setCapsLock(event.getModifierState("CapsLock"));
    }
  }

  function toggleReset() {
    // Offer the identifier as the reset address when it already looks like one.
    if (!resetOpen && !resetEmail && form.identifier.includes("@")) {
      setResetEmail(form.identifier.trim());
    }

    setResetOpen((open) => !open);
  }

  async function handleResetRequest() {
    const email = resetEmail.trim();

    if (!email) {
      setResetError(t("login.resetEmailRequired"));
      return;
    }

    setResetStatus("sending");
    setResetError(null);

    try {
      await authApi.forgotPassword(email);
      setResetStatus("sent");
    } catch (error) {
      setResetStatus("idle");
      setResetError(getErrorMessage(error));
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setFormError(null);

    const invalid = validate();
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      setFocusRequest((count) => count + 1);
      return;
    }

    setSubmitting(true);
    try {
      await login(form.identifier.trim(), form.password, form.remember);
      // Persist (or clear) the identifier per the checkbox: this is the
      // "remember me" the user actually sees next time, on top of the
      // server-side recaller that keeps the session alive.
      rememberIdentifier(form.remember ? form.identifier.trim() : "");
      // Global toast survives the navigation, so the confirmation is still
      // on screen when the dashboard renders.
      toast.success(t("login.success"));
      // /dashboard resolves to the signed-in user's own role dashboard.
      navigate(location.state?.from?.pathname ?? "/dashboard", { replace: true });
    } catch (error) {
      const fields = getFieldErrors(error);
      if (fields) {
        setErrors(fields);
        setFocusRequest((count) => count + 1);
      } else {
        setFormError(getErrorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="w-full">
      <h1 className="font-display text-[1.65rem] leading-tight font-bold text-slate-900 sm:text-3xl">
        {t("login.welcome")}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">
        {t("login.subtitle", { office: site.office })}
      </p>

      {notice && NOTICE_KEYS[notice] && (
        <div className="mt-5">
          <InlineAlert tone="info" message={t(NOTICE_KEYS[notice])} />
        </div>
      )}

      <div className="mt-6 space-y-4">
        <TextField
          id={`${idPrefix}-identifier`}
          label={t("login.identifierLabel")}
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t("login.identifierPlaceholder")}
          value={form.identifier}
          onChange={update("identifier")}
          error={errors.identifier}
        />

        <div>
          <TextField
            id={`${idPrefix}-password`}
            label={t("login.passwordLabel")}
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder={t("login.passwordPlaceholder")}
            value={form.password}
            onChange={update("password")}
            onKeyDown={trackCapsLock}
            onKeyUp={trackCapsLock}
            onBlur={() => setCapsLock(false)}
            error={errors.password}
            trailing={
              <PasswordToggle
                shown={showPassword}
                onToggle={() => setShowPassword((shown) => !shown)}
                label={
                  showPassword
                    ? t("login.hidePassword")
                    : t("login.showPassword")
                }
              />
            }
          />

          {capsLock && !errors.password && (
            <p
              role="status"
              className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-800"
            >
              <Icon name="alert-circle" className="h-3.5 w-3.5 shrink-0" />
              {t("login.capsLock")}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label
          htmlFor={`${idPrefix}-remember`}
          className="flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-500"
        >
          <input
            id={`${idPrefix}-remember`}
            type="checkbox"
            checked={form.remember}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, remember: event.target.checked }))
            }
            className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-2 focus:ring-brand-700 dark:border-slate-400"
          />
          {t("login.remember")}
        </label>

        <button
          type="button"
          onClick={toggleReset}
          aria-expanded={resetOpen}
          className="rounded text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
        >
          {t("login.forgot")}
        </button>
      </div>

      {resetOpen && (
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3.5 dark:border-brand-200/60 dark:bg-brand-100">
          {resetStatus === "sent" ? (
            <InlineAlert tone="success" message={t("login.resetSent")} />
          ) : (
            <>
              <p className="text-sm font-semibold text-brand-900">
                {t("login.resetTitle")}
              </p>
              <p className="mt-1 text-xs leading-snug text-brand-900/80">
                {t("login.resetIntro")}
              </p>

              <div className="mt-3">
                <TextField
                  id={`${idPrefix}-reset-email`}
                  label={t("login.resetEmailLabel")}
                  type="email"
                  autoComplete="email"
                  placeholder={t("login.identifierPlaceholder")}
                  value={resetEmail}
                  onChange={(event) => {
                    setResetEmail(event.target.value);
                    setResetError(null);
                  }}
                  // The reset panel sits inside the sign-in form, so Enter
                  // must send THIS request, not submit the login form.
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleResetRequest();
                    }
                  }}
                  error={resetError}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetRequest}
                  disabled={resetStatus === "sending"}
                  className="btn-primary text-xs"
                >
                  {resetStatus === "sending" ? (
                    <>
                      <ButtonSpinner />
                      {t("login.resetSubmitting")}
                    </>
                  ) : (
                    t("login.resetSubmit")
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setResetOpen(false)}
                  className="btn-secondary text-xs"
                >
                  {t("login.resetCancel")}
                </button>
              </div>
            </>
          )}

          {/* Kept as a fallback path for accounts whose email cannot
              receive the link (office-managed resets). */}
          <p className="mt-3 text-[11px] leading-snug text-brand-900/70">
            {t("common.passwordResetPolicy", {
              email: contact.email,
              phone: contact.phone,
            })}
          </p>
        </div>
      )}

      {formError && (
        <div className="mt-4">
          <InlineAlert
            tone="error"
            message={formError}
            onDismiss={() => setFormError(null)}
          />
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting}
        className="btn-primary mt-5 w-full py-3"
      >
        {submitting ? (
          <>
            <ButtonSpinner />
            {t("login.submitting")}
          </>
        ) : (
          <>
            {t("login.heading")}
            <Icon name="arrow-right" className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}
