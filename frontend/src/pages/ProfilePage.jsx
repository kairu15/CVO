import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { profileApi } from "../api/profileApi";
import { notificationsApi } from "../api/notificationsApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { roleLabel } from "../config/roles";
import { Icon } from "../components/Icons";
import { InlineAlert } from "../components/InlineAlert";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { Skeleton, SkeletonDetail, SkeletonList } from "../components/Skeleton";
import { PasswordToggle, TextField } from "../components/TextField";

/**
 * My Profile — the caller's own account, in three sections:
 * Personal information, Security, and Preferences.
 *
 * Role, permissions and account administration deliberately stay in the
 * Administrator module. This page may display the role and status, but it
 * never offers a control that can change them.
 */
export function ProfilePage() {
  const { refreshUser } = useAuth();

  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [security, setSecurity] = useState(null);
  const [securityError, setSecurityError] = useState(null);
  const [securityLoading, setSecurityLoading] = useState(true);

  function loadSecurity() {
    setSecurityLoading(true);
    setSecurityError(null);

    return profileApi
      .security()
      .then((data) => {
        setSecurity(data);
        return data;
      })
      .catch((err) => {
        setSecurityError(getErrorMessage(err));
        return null;
      })
      .finally(() => setSecurityLoading(false));
  }

  useEffect(() => {
    let cancelled = false;

    profileApi
      .get()
      .then((data) => {
        if (!cancelled) {
          setProfile(data);
          setStatus("ready");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(getErrorMessage(err));
          setStatus("error");
        }
      });

    profileApi
      .security()
      .then((data) => {
        if (!cancelled) setSecurity(data);
      })
      .catch((err) => {
        if (!cancelled) setSecurityError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setSecurityLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return (
      <div className="space-y-6">
        <section className="card p-6">
          <SkeletonDetail />
        </section>
        <section className="card overflow-hidden p-6">
          <SkeletonList rows={3} rowClassName="h-11" />
        </section>
      </div>
    );
  }

  if (status === "error") {
    return (
      <section className="card p-6">
        <InlineAlert tone="error" message={`Couldn't load your profile — ${error}`} />
      </section>
    );
  }

  const account = profile.user;

  return (
    <div className="space-y-6">
      <ProfileHeader account={account} onChange={setProfile} />

      <nav
        aria-label="Profile sections"
        className="card flex gap-1 overflow-x-auto p-1.5"
      >
        <SectionLink href="#personal-information" icon="user" label="Personal information" />
        <SectionLink href="#security" icon="shield" label="Security" />
        <SectionLink href="#preferences" icon="bell" label="Preferences" />
      </nav>

      <section id="personal-information" className="card scroll-mt-24 p-6">
        <SectionHeading
          icon="user"
          title="Personal information"
          description="Keep your contact details current so the office can reach you. Your role and permissions are managed by an administrator."
        />

        <AccountForm
          account={account}
          onSaved={(data) => {
            setProfile(data);
            refreshUser();
          }}
        />

        <AccountSummary account={account} />
        <RoleSection profile={profile} />
      </section>

      <section id="security" className="card scroll-mt-24 p-6">
        <SectionHeading
          icon="shield"
          title="Security"
          description="Change your password, review recent sign-ins, and sign out devices you no longer use."
        />

        <SecuritySummary
          security={security}
          loading={securityLoading}
          error={securityError}
          onRetry={loadSecurity}
        />

        <div className="mt-6 border-t border-slate-100 pt-6 dark:border-slate-200/60">
          <PasswordForm />
        </div>

        <div className="mt-6 border-t border-slate-100 pt-6 dark:border-slate-200/60">
          <SessionsSection
            security={security}
            loading={securityLoading}
            error={securityError}
            onRefresh={loadSecurity}
          />
        </div>
      </section>

      <section id="preferences" className="card scroll-mt-24 p-6">
        <SectionHeading
          icon="bell"
          title="Preferences"
          description="Choose which notification categories you receive. These preferences apply to your account only."
        />
        <NotificationPreferences />
      </section>
    </div>
  );
}

function SectionHeading({ icon, title, description }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-100 dark:text-brand-800">
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <div>
        <h2 className="font-display text-base font-bold text-slate-900">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function SectionLink({ href, icon, label }) {
  return (
    <a
      href={href}
      className="inline-flex shrink-0 items-center gap-2 rounded-pill px-3.5 py-2 text-xs font-semibold text-slate-600 transition hover:bg-brand-50 hover:text-brand-800 dark:hover:bg-brand-100/40"
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
      {label}
    </a>
  );
}

/** Two initials for the avatar fallback, same as the header chip. */
function initialsOf(name) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}

function formatDateTime(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

/** Shared button that disables itself and spins while its request runs. */
function SaveButton({ busy, children, ...props }) {
  return (
    <button type="submit" disabled={busy} className="btn-primary" {...props}>
      {busy ? (
        <>
          <ButtonSpinner /> Saving…
        </>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * Avatar (upload/remove with a confirmation) + identity readouts.
 * The selected image is previewed while the upload runs, then replaced by the
 * server's stored URL.
 */
function ProfileHeader({ account, onChange }) {
  const toast = useToast();
  const fileInput = useRef(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-choosing the same file
    if (!file) return;

    // Match the server's rules before spending the upload.
    const okType = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
    if (!okType || file.size > 2 * 1024 * 1024) {
      toast.error("Choose a JPEG, PNG or WebP image up to 2 MB.");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setBusy(true);
    try {
      onChange(await profileApi.uploadAvatar(file));
      toast.success("Profile photo updated.");
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      URL.revokeObjectURL(objectUrl);
      setPreview(null);
      setBusy(false);
    }
  }

  async function handleRemove() {
    setConfirmingRemove(false);
    setBusy(true);
    try {
      onChange(await profileApi.removeAvatar());
      toast.success("Profile photo removed.");
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const avatar = preview ?? account.avatar_url;
  const isActive = account.status !== "deactivated";

  return (
    <section className="card p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="relative h-20 w-20 shrink-0">
          {avatar ? (
            <img
              src={avatar}
              alt=""
              className="h-20 w-20 rounded-full object-cover ring-1 ring-slate-200"
            />
          ) : (
            <span className="grid h-20 w-20 place-items-center rounded-full bg-brand-100 font-display text-xl font-bold text-brand-800">
              {initialsOf(account.name)}
            </span>
          )}
          {busy && (
            <span className="absolute inset-0 grid place-items-center rounded-full bg-white/70">
              <ButtonSpinner className="border-brand-300 border-t-brand-700" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="eyebrow">{roleLabel(account.role)}</p>
            <span
              className={`rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${
                isActive
                  ? "bg-brand-50 text-brand-800 dark:bg-brand-100 dark:text-brand-800"
                  : "bg-red-50 text-red-700 dark:bg-red-100 dark:text-red-700"
              }`}
            >
              {isActive ? "Active" : "Deactivated"}
            </span>
          </div>
          <h1 className="mt-0.5 truncate font-display text-xl font-bold text-slate-900">
            {account.name}
          </h1>
          <p className="truncate text-sm text-slate-500">{account.email}</p>
          <p className="mt-1 text-xs text-slate-500">
            Last sign-in: {formatDateTime(account.last_login_at)}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFile}
              className="hidden"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              className="btn-secondary text-xs"
            >
              <Icon name="user" className="h-4 w-4" />
              {account.avatar_url ? "Change photo" : "Upload photo"}
            </button>
            {account.avatar_url && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingRemove(true)}
                className="rounded-pill px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmingRemove && (
        <ConfirmInline
          title="Remove your profile photo?"
          description="Your account will fall back to initials. You can upload a new photo any time."
          confirmLabel="Remove photo"
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={handleRemove}
        />
      )}
    </section>
  );
}

/**
 * Small inline confirmation card — a full modal for one row would be heavy,
 * but the destructive remove still demands an explicit two-step confirm.
 */
function ConfirmInline({ title, description, confirmLabel, onCancel, onConfirm }) {
  return (
    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="font-display text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-xs text-slate-600">{description}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onConfirm} className="btn-primary bg-red-600 text-xs hover:bg-red-700">
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Name, email and personal contact details — every role. */
function AccountForm({ account, onSaved }) {
  const toast = useToast();
  const initial = useMemo(
    () => ({
      name: account.name ?? "",
      email: account.email ?? "",
      phone: account.phone ?? "",
      address: account.address ?? "",
    }),
    [account.name, account.email, account.phone, account.address],
  );
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const dirty = Object.keys(initial).some((field) => form[field] !== initial[field]);

  function update(field) {
    return (event) => {
      setForm((prev) => ({ ...prev, [field]: event.target.value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
      };
      const saved = await profileApi.update(payload);
      onSaved(saved);
      setForm({
        name: saved.user.name ?? "",
        email: saved.user.email ?? "",
        phone: saved.user.phone ?? "",
        address: saved.user.address ?? "",
      });
      toast.success("Profile updated.");
    } catch (err) {
      const fields = getFieldErrors(err);
      if (fields) setErrors(fields);
      else toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-5 grid gap-4 sm:grid-cols-2">
      <TextField
        id="profile-name"
        label="Full name"
        autoComplete="name"
        value={form.name}
        onChange={update("name")}
        error={errors.name}
      />
      <TextField
        id="profile-email"
        label="Email address"
        type="email"
        autoComplete="email"
        value={form.email}
        onChange={update("email")}
        error={errors.email}
      />
      <TextField
        id="profile-phone"
        label="Contact number"
        type="tel"
        autoComplete="tel"
        value={form.phone}
        onChange={update("phone")}
        error={errors.phone}
        hint="Optional. Include the country code if applicable."
      />
      <TextField
        id="profile-address"
        label="Address"
        autoComplete="street-address"
        value={form.address}
        onChange={update("address")}
        error={errors.address}
        hint="Optional personal address, not a household program record."
      />

      <div className="flex items-end sm:col-span-2">
        <SaveButton busy={saving} disabled={!dirty}>
          Save changes
        </SaveButton>
      </div>
    </form>
  );
}

/** Read-only account facts. Role and permissions are never editable here. */
function AccountSummary({ account }) {
  const rows = [
    { label: "Username", value: account.username ?? "—" },
    { label: "Role", value: roleLabel(account.role) },
    { label: "Account status", value: account.status === "deactivated" ? "Deactivated" : "Active" },
    { label: "Member since", value: formatDate(account.created_at) },
  ];

  return (
    <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-200/60">
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Account information
      </h3>
      <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-slate-500">{row.label}</dt>
            <dd className="text-right font-medium text-slate-800">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 flex items-start gap-2 text-[11px] text-slate-500">
        <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Role assignments and permissions are controlled by an administrator. Usernames are permanent.
      </p>
    </div>
  );
}

/** Role-specific work summary — read-only, never a permission control. */
function RoleSection({ profile }) {
  if (profile.technician) return <TechnicianSection technician={profile.technician} />;
  if (profile.clinical) return <ClinicalSection clinical={profile.clinical} />;
  return null;
}

function TechnicianSection({ technician }) {
  const count = technician.assigned_farmers;

  return (
    <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-200/60">
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Work overview</h3>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">
          <span className="font-display text-2xl font-bold text-slate-900">{count}</span>{" "}
          farmer household{count === 1 ? "" : "s"} currently assigned to you.
        </p>
        <Link
          to="/dashboard/technician/monitoring"
          className="btn-secondary w-fit shrink-0 text-xs"
        >
          Open monitoring records
          <Icon name="arrow-right" className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

function ClinicalSection({ clinical }) {
  return (
    <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-200/60">
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Work overview</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <p className="font-display text-2xl font-bold text-slate-900">
            {clinical.health_records_count}
          </p>
          <p className="text-xs text-slate-500">Health records authored</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <p className="font-display text-2xl font-bold text-slate-900">
            {clinical.case_notes_count}
          </p>
          <p className="text-xs text-slate-500">Case notes written</p>
        </div>
      </div>
    </div>
  );
}

/** Last sign-in, session count and account status. */
function SecuritySummary({ security, loading, error, onRetry }) {
  if (loading) {
    return (
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <Skeleton key={item} className="block h-24 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-5 space-y-2">
        <InlineAlert tone="error" message={`Couldn't load security information — ${error}`} />
        <button type="button" onClick={onRetry} className="btn-secondary text-xs">
          Try again
        </button>
      </div>
    );
  }

  const sessions = security?.sessions ?? [];
  const lastSignIn = security?.last_login_at;

  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      <SecurityFact icon="clock" label="Last sign-in" value={formatDateTime(lastSignIn)} />
      <SecurityFact
        icon="globe"
        label="Active sessions"
        value={`${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`}
      />
      <SecurityFact
        icon="shield"
        label="Account status"
        value={security?.status === "deactivated" ? "Deactivated" : "Active"}
      />
    </div>
  );
}

function SecurityFact({ icon, label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-200/60 dark:bg-slate-100/40">
      <div className="flex items-center gap-2 text-slate-500">
        <Icon name={icon} className="h-4 w-4" />
        <span className="text-[11px] font-semibold tracking-wide uppercase">{label}</span>
      </div>
      <p className="mt-1.5 text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
}

/** Password strength checks that mirror the server's password rules. */
const PASSWORD_CHECKS = [
  { key: "length", label: "At least 8 characters", test: (value) => value.length >= 8 },
  { key: "lower", label: "Lowercase letter", test: (value) => /[a-z]/.test(value) },
  { key: "upper", label: "Uppercase letter", test: (value) => /[A-Z]/.test(value) },
  { key: "number", label: "Number", test: (value) => /[0-9]/.test(value) },
  { key: "symbol", label: "Symbol", test: (value) => /[^A-Za-z0-9]/.test(value) },
];

function passwordStrength(password) {
  const passed = PASSWORD_CHECKS.filter((check) => check.test(password)).length;
  if (!password) return { passed: 0, label: "Enter a password", tone: "bg-slate-200" };
  if (passed <= 2) return { passed, label: "Weak", tone: "bg-red-500" };
  if (passed === 3) return { passed, label: "Fair", tone: "bg-amber-500" };
  if (passed === 4) return { passed, label: "Good", tone: "bg-brand-500" };
  return { passed, label: "Strong", tone: "bg-brand-700" };
}

function PasswordStrength({ password }) {
  const strength = passwordStrength(password);
  const percent = (strength.passed / PASSWORD_CHECKS.length) * 100;

  return (
    <div className="mt-2" aria-live="polite">
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-200/60">
        <div
          className={`h-full rounded-full transition-all ${strength.tone}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-500">
          Password strength: <span className="text-slate-700">{strength.label}</span>
        </span>
        <span className="text-[11px] text-slate-500">
          {strength.passed}/{PASSWORD_CHECKS.length} requirements
        </span>
      </div>
      <ul className="mt-2 grid gap-1 text-[11px] text-slate-500 sm:grid-cols-2">
        {PASSWORD_CHECKS.map((check) => {
          const met = check.test(password);
          return (
            <li key={check.key} className="flex items-center gap-1.5">
              <Icon
                name={met ? "check" : "close"}
                className={`h-3 w-3 ${met ? "text-brand-700" : "text-slate-300"}`}
              />
              {check.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Password change — current password required, registration rules enforced. */
function PasswordForm() {
  const toast = useToast();
  const [form, setForm] = useState({
    current_password: "",
    password: "",
    password_confirmation: "",
  });
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  function update(field) {
    return (event) => {
      setForm((prev) => ({ ...prev, [field]: event.target.value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  function validate() {
    const next = {};

    if (!form.current_password) next.current_password = "Enter your current password.";

    if (!form.password) next.password = "Choose a new password.";
    else if (PASSWORD_CHECKS.some((check) => !check.test(form.password)))
      next.password =
        "Use at least 8 characters with upper and lower case, a number and a symbol.";

    if (form.password_confirmation !== form.password)
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

    setSaving(true);
    try {
      await profileApi.changePassword(form);
      toast.success("Password changed.");
      setForm({ current_password: "", password: "", password_confirmation: "" });
    } catch (err) {
      const fields = getFieldErrors(err);
      if (fields) setErrors(fields);
      else toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h3 className="font-display text-sm font-bold text-slate-900">Change password</h3>
      <p className="mt-1 text-xs text-slate-500">
        Enter your current password to confirm the change. Other signed-in devices stay signed in.
      </p>
      <form onSubmit={handleSubmit} noValidate className="mt-4 grid gap-4 sm:grid-cols-2">
        <TextField
          id="profile-current-password"
          label="Current password"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          value={form.current_password}
          onChange={update("current_password")}
          error={errors.current_password}
          trailing={<PasswordToggle shown={show} onToggle={() => setShow((s) => !s)} />}
        />
        <div>
          <TextField
            id="profile-new-password"
            label="New password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={form.password}
            onChange={update("password")}
            error={errors.password}
          />
          <PasswordStrength password={form.password} />
        </div>
        <TextField
          id="profile-confirm-password"
          label="Confirm new password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={form.password_confirmation}
          onChange={update("password_confirmation")}
          error={errors.password_confirmation}
        />

        <div className="flex items-end sm:col-span-2">
          <SaveButton busy={saving}>Change password</SaveButton>
        </div>
      </form>
    </div>
  );
}

/** Active browser/mobile sessions plus recent account activity. */
function SessionsSection({ security, loading, error, onRefresh }) {
  const { logoutLocal } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirmingOthers, setConfirmingOthers] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const sessions = security?.sessions ?? [];
  const activity = security?.recent_activity ?? [];
  const otherSessions = sessions.filter((session) => !session.current);

  async function revokeOthers() {
    setBusy(true);
    try {
      await profileApi.revokeOtherSessions();
      await onRefresh();
      toast.success("Other sessions signed out.");
      setConfirmingOthers(false);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogoutAll() {
    setBusy(true);
    try {
      await profileApi.logoutAll();
      toast.success("Signed out of every device.");
      logoutLocal();
      navigate("/login", { replace: true });
    } catch (err) {
      toast.error(getErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-bold text-slate-900">Active sessions</h3>
          <p className="mt-1 text-xs text-slate-500">
            Signed-in browsers and mobile devices on your account.
          </p>
        </div>
        {!loading && !error && sessions.length > 0 && (
          <span className="rounded-pill bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
            {sessions.length} active
          </span>
        )}
      </div>

      {loading ? (
        <SkeletonList rows={2} rowClassName="h-12" className="mt-3" />
      ) : error ? null : sessions.length === 0 ? (
        <p className="mt-3 rounded-xl border border-slate-100 px-4 py-3 text-xs text-slate-500">
          No active sessions were reported. If you are signed in on this device, it may use a session type that is not
          listed here.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-200/60 dark:border-slate-200/60">
          {sessions.map((session) => (
            <li key={session.key} className="flex items-start gap-3 px-4 py-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
                <Icon name={session.kind === "mobile" ? "phone" : "globe"} className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-slate-800">{session.device}</p>
                  {session.current && (
                    <span className="rounded-pill bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-800">
                      This device
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {session.ip_address ? `${session.ip_address} · ` : ""}
                  Last active {formatDateTime(session.last_active)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {otherSessions.length > 0 && !error && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setConfirmingOthers(true)}
            disabled={busy}
            className="btn-secondary text-xs"
          >
            <Icon name="logout" className="h-4 w-4" />
            Sign out other sessions
          </button>
        </div>
      )}

      {confirmingOthers && (
        <ConfirmInline
          title="Sign out other sessions?"
          description="Every browser and mobile device except this one will be signed out. This device stays signed in."
          confirmLabel={busy ? "Signing out…" : "Sign out other sessions"}
          onCancel={() => setConfirmingOthers(false)}
          onConfirm={revokeOthers}
        />
      )}

      <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-200/60">
        <h3 className="font-display text-sm font-bold text-slate-900">Recent account activity</h3>
        {activity.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No recent security activity recorded.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {activity.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-4 text-xs">
                <span className="flex items-start gap-2 text-slate-700">
                  <Icon name="activity" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  {entry.label}
                </span>
                <span className="text-right text-[11px] text-slate-500">
                  {formatDateTime(entry.created_at)}
                  {entry.ip_address ? ` · ${entry.ip_address}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 rounded-xl border border-red-200 bg-red-50/60 p-4">
        <h3 className="font-display text-sm font-bold text-slate-900">Sign out everywhere</h3>
        <p className="mt-1 text-xs text-slate-600">
          Lost a device, or think someone else is signed in as you? This signs you out of every browser and phone on
          your account — including this one.
        </p>
        <button
          type="button"
          onClick={() => setConfirmingAll(true)}
          disabled={busy}
          className="btn-secondary mt-3 text-xs"
        >
          <Icon name="logout" className="h-4 w-4" />
          Log out of all devices
        </button>

        {confirmingAll && (
          <ConfirmInline
            title="Log out of all devices?"
            description="Every phone, browser and tablet signed in as you will be signed out immediately, including this one. You'll need to sign in again everywhere."
            confirmLabel={busy ? "Signing out…" : "Log out everywhere"}
            onCancel={() => setConfirmingAll(false)}
            onConfirm={handleLogoutAll}
          />
        )}
      </div>
    </div>
  );
}

/** Notification category switches, loaded from the existing preferences API. */
function NotificationPreferences() {
  const toast = useToast();
  const [preferences, setPreferences] = useState({});
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    notificationsApi
      .preferences()
      .then((data) => {
        if (!active) return;
        setPreferences(data.preferences ?? {});
        setCategories(data.categories ?? []);
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);

    try {
      const data = await notificationsApi.updatePreferences(preferences);
      setPreferences(data.preferences ?? preferences);
      if (data.categories?.length) setCategories(data.categories);
      toast.success("Notification preferences saved.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <SkeletonList rows={4} rowClassName="h-10" className="mt-5" />;
  }

  if (error && categories.length === 0) {
    return (
      <div className="mt-5">
        <InlineAlert tone="error" message={error} />
      </div>
    );
  }

  return (
    <div className="mt-5">
      {error && <InlineAlert tone="error" message={error} onDismiss={() => setError(null)} />}

      <ul className="grid gap-2 sm:grid-cols-2">
        {categories.map((category) => (
          <li
            key={category.key}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-200/60"
          >
            <label htmlFor={`profile-category-${category.key}`} className="text-sm font-medium text-slate-700">
              {category.label}
            </label>
            <input
              id={`profile-category-${category.key}`}
              type="checkbox"
              checked={preferences[category.key] ?? true}
              onChange={(event) =>
                setPreferences((current) => ({
                  ...current,
                  [category.key]: event.target.checked,
                }))
              }
              className="h-4 w-4 accent-brand-700"
            />
          </li>
        ))}
      </ul>

      {categories.length === 0 ? (
        <p className="text-xs text-slate-500">No notification categories are available.</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-primary px-4 py-2 text-xs disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save preferences"}
          </button>
          <p className="text-[11px] text-slate-500">
            Security and account records remain in the audit trail even when their notification category is off.
          </p>
        </div>
      )}
    </div>
  );
}
