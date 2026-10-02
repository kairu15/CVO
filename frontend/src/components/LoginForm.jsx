import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { authApi } from "../api/authApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { site } from "../config/site";
import { takeSessionNotice } from "../lib/sessionNotice";
import {
  readRememberedIdentifier,
  rememberIdentifier,
} from "../lib/rememberedLogin";
import { ButtonSpinner } from "./LoadingSpinner";
import { InlineAlert } from "./InlineAlert";
import { PasswordToggle, TextField } from "./TextField";

/** Notice code → translation key, shown once above the form. */
const NOTICE_KEYS = {
  expired: "session.expired",
  inactivity: "session.inactivity",
};

/**
 * @param {object} props
 * @param {string} [props.idPrefix] namespace for element ids — the sign-up form
 *   shares the page with this one on desktop, so ids must not collide.
 */
export function LoginForm({ idPrefix = "login" }) {
  const { t } = useTranslation();
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // Route state prefill: the register form hands over the just-registered
  // email so the farmer doesn't retype it. Falls back to the redirect-target
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
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // "Forgot password?" — request a reset link by email.
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetStatus, setResetStatus] = useState("idle"); // idle | sending | sent
  const [resetError, setResetError] = useState(null);

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
      next.identifier = t("login.errors.identifier");
    }
    if (!form.password) {
      next.password = t("login.errors.password");
    }
    return next;
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

    const invalid = validate();
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
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
      if (fields) setErrors(fields);
      else toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full">
      <h2 className="font-display text-2xl font-bold text-slate-900">
        {t("login.heading")}
      </h2>
      <p className="mt-1.5 text-sm text-slate-500">
        {t("login.subtitle", { office: site.office })}
      </p>

      {notice && NOTICE_KEYS[notice] && (
        <div className="mt-4">
          <InlineAlert tone="info" message={t(NOTICE_KEYS[notice])} />
        </div>
      )}

      <div className="mt-6 space-y-4">
        <TextField
          id={`${idPrefix}-identifier`}
          label={t("login.identifierLabel")}
          type="text"
          autoComplete="username"
          placeholder={t("login.identifierPlaceholder")}
          value={form.identifier}
          onChange={update("identifier")}
          error={errors.identifier}
        />

        <TextField
          id={`${idPrefix}-password`}
          label={t("login.passwordLabel")}
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          placeholder={t("login.passwordPlaceholder")}
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

      <label
        htmlFor={`${idPrefix}-remember`}
        className="mt-4 flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-600"
      >
        <input
          id={`${idPrefix}-remember`}
          type="checkbox"
          checked={form.remember}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, remember: event.target.checked }))
          }
          className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-2 focus:ring-brand-700"
        />
        {t("login.remember")}
      </label>

      <div className="mt-4 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={toggleReset}
          aria-expanded={resetOpen}
          className="text-xs font-semibold text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
        >
          {t("login.forgot")}
        </button>

        {resetOpen && (
          <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-3">
            {resetStatus === "sent" ? (
              <InlineAlert tone="success" message={t("login.resetSent")} />
            ) : (
              <>
                <p className="text-xs font-semibold text-brand-900">
                  {t("login.resetTitle")}
                </p>
                <p className="mt-1 text-[11px] leading-snug text-brand-900/80">
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
                    {resetStatus === "sending"
                      ? t("login.resetSubmitting")
                      : t("login.resetSubmit")}
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
                email: site.email,
                phone: site.phone,
              })}
            </p>
          </div>
        )}
      </div>

      <button type="submit" disabled={submitting} className="btn-primary mt-6 w-full">
        {submitting ? (
          <>
            <ButtonSpinner />
            {t("login.submitting")}
          </>
        ) : (
          t("login.heading")
        )}
      </button>
    </form>
  );
}
