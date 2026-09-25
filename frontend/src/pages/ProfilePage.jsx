import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { profileApi } from "../api/profileApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { roleLabel } from "../config/roles";
import { useBarangays } from "../hooks/useBarangays";
import { Icon } from "../components/Icons";
import { InlineAlert } from "../components/InlineAlert";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { Skeleton, SkeletonDetail, SkeletonList } from "../components/Skeleton";
import { PasswordToggle, TextField } from "../components/TextField";

/**
 * My Profile — one page for every role.
 *
 * Common account section (name, email, avatar, username, member-since,
 * password) plus a role-specific section fed by GET /api/v1/profile:
 * farmers see their household location (editable via the same barangay
 * dropdown registration uses), technicians their assigned-farmer count with
 * a link to monitoring, doctors their clinical footprint. There is no
 * license/credential field in the data model, so none is shown.
 */
export function ProfilePage() {
  const { refreshUser } = useAuth();

  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);

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

      <AccountForm account={account} onSaved={(data) => {
        setProfile(data);
        refreshUser();
      }} />

      <RoleSection profile={profile} />

      <PasswordForm />
    </div>
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
 * The photo is a plain file picker: no GPS/timestamp overlay — that
 * geotag logic is for field-visit evidence, not portraits.
 */
function ProfileHeader({ account, onChange }) {
  const toast = useToast();
  const fileInput = useRef(null);
  const [busy, setBusy] = useState(false);
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

    setBusy(true);
    try {
      onChange(await profileApi.uploadAvatar(file));
      toast.success("Profile photo updated.");
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
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

  return (
    <section className="card p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="relative h-20 w-20 shrink-0">
          {account.avatar_url ? (
            <img
              src={account.avatar_url}
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
          <p className="eyebrow">{roleLabel(account.role)}</p>
          <h2 className="mt-0.5 truncate font-display text-xl font-bold text-slate-900">
            {account.name}
          </h2>
          <p className="truncate text-sm text-slate-500">
            {account.email} · Member since{" "}
            {new Date(account.created_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
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

/** Name + email editing — every role. */
function AccountForm({ account, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: account.name, email: account.email });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const dirty = form.name !== account.name || form.email !== account.email;

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
      onSaved(await profileApi.update({ name: form.name.trim(), email: form.email.trim() }));
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
    <section className="card p-6">
      <h3 className="font-display text-base font-bold text-slate-900">Account details</h3>
      <form onSubmit={handleSubmit} noValidate className="mt-4 grid gap-4 sm:grid-cols-2">
        <TextField
          id="profile-name"
          label="Full name"
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
          id="profile-username"
          label="Username"
          value={account.username ?? "—"}
          disabled
          hint="Usernames are permanent — they're how you sign in."
        />

        <div className="flex items-end sm:col-span-2">
          <SaveButton busy={saving} disabled={!dirty}>
            Save changes
          </SaveButton>
        </div>
      </form>
    </section>
  );
}

/** Role-specific section — fed entirely by the profile payload. */
function RoleSection({ profile }) {
  if (profile.farmer) return <FarmerSection farmer={profile.farmer} />;
  if (profile.technician) return <TechnicianSection technician={profile.technician} />;
  if (profile.doctor) return <DoctorSection doctor={profile.doctor} />;
  return null; // admin: nothing beyond the common sections
}

const LOCATION_SOURCE_LABELS = {
  gps: "GPS fix",
  map_pin: "Map pin",
  manual: "Chosen from list",
};

/** Farmer household location — editable barangay + read-only purok/coords. */
function FarmerSection({ farmer }) {
  const toast = useToast();
  const [barangays, barangaysStatus] = useBarangays();
  const [address, setAddress] = useState(farmer.beneficiaries[0]?.barangay?.name ?? "");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const primary = farmer.beneficiaries[0] ?? null;
  const selected = useMemo(
    () => barangays.find((barangay) => barangay.name === address) ?? null,
    [barangays, address],
  );
  const dirty = Boolean(address) && address !== primary?.barangay?.name;

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await profileApi.update({
        address,
        barangay_id: selected?.id ?? undefined,
      });
      toast.success("Barangay updated. Your monitoring records now point here.");
      window.location.reload(); // rare edit; a reload re-fetches everything cleanly
    } catch (err) {
      const fields = getFieldErrors(err);
      if (fields) setErrors(fields);
      else toast.error(getErrorMessage(err));
      setSaving(false);
    }
  }

  if (!primary) {
    return (
      <section className="card p-6">
        <h3 className="font-display text-base font-bold text-slate-900">My location</h3>
        <p className="mt-2 text-sm text-slate-500">
          No dispersal record is linked to your account yet — location details
          appear here once the CVO registers your animal.
        </p>
      </section>
    );
  }

  return (
    <section className="card p-6">
      <h3 className="font-display text-base font-bold text-slate-900">My location</h3>
      <p className="mt-1 text-sm text-slate-500">
        Where your farm is — used to pre-fill monitoring records and schedule
        visits.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="profile-barangay" className="block text-sm font-medium text-slate-700">
            Barangay
          </label>
          {barangaysStatus === "loading" ? (
            <Skeleton className="field mt-1.5 h-11" />
          ) : (
            <select
              id="profile-barangay"
              className="field mt-1.5"
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
                setErrors((prev) => ({ ...prev, address: undefined }));
              }}
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
            <p className="mt-1.5 text-xs font-medium text-red-600">{errors.address}</p>
          ) : (
            <p className="mt-1.5 text-xs text-slate-500">
              Same coverage list as registration.
            </p>
          )}
        </div>

        <TextField
          id="profile-purok"
          label="Purok / Sitio"
          value={primary.purok?.name ?? "Not set"}
          disabled
          hint="Ask the CVO office to update your purok if this is wrong."
        />

        <TextField
          id="profile-location-source"
          label="Location source"
          value={LOCATION_SOURCE_LABELS[primary.location_source] ?? "Chosen from list"}
          disabled
          hint="How the farm's coordinates were captured."
        />

        <TextField
          id="profile-coordinates"
          label="Coordinates"
          value={
            primary.latitude != null
              ? `${primary.latitude.toFixed(5)}, ${primary.longitude.toFixed(5)}`
              : "—"
          }
          disabled
        />

        <div className="flex items-end sm:col-span-2">
          <SaveButton busy={saving} disabled={!dirty}>
            Update barangay
          </SaveButton>
        </div>
      </form>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-sm">
        <p className="font-semibold text-slate-900">Dispersal record</p>
        <p className="mt-1 text-slate-600">
          {primary.animal_type} ({primary.sex}) ·{" "}
          {primary.dispersal_events_count > 0
            ? `${primary.dispersal_events_count} dispersal movement${primary.dispersal_events_count === 1 ? "" : "s"} recorded`
            : "No dispersal movements recorded yet"}
        </p>
      </div>
    </section>
  );
}

/** Technician: assignment count + link to their monitoring dashboard. */
function TechnicianSection({ technician }) {
  const count = technician.assigned_farmers;

  return (
    <section className="card p-6">
      <h3 className="font-display text-base font-bold text-slate-900">My assignments</h3>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">
          <span className="font-display text-2xl font-bold text-slate-900">{count}</span>{" "}
          farmer household{count === 1 ? "" : "s"} currently assigned to you.
        </p>
        <Link
          to="/dashboard/technician/monitoring"
          className="btn-secondary shrink-0 text-xs"
        >
          Open monitoring records
          <Icon name="arrow-right" className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  );
}

/** Doctor: the clinical footprint the system tracks (no license field exists). */
function DoctorSection({ doctor }) {
  return (
    <section className="card p-6">
      <h3 className="font-display text-base font-bold text-slate-900">Clinical activity</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <p className="font-display text-2xl font-bold text-slate-900">
            {doctor.health_records_count}
          </p>
          <p className="text-xs text-slate-500">Health records authored</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <p className="font-display text-2xl font-bold text-slate-900">
            {doctor.case_notes_count}
          </p>
          <p className="text-xs text-slate-500">Case notes written</p>
        </div>
      </div>
    </section>
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

  /** Mirrors Password::defaults() — min 8, mixed case, number, symbol. */
  function validate() {
    const next = {};

    if (!form.current_password) next.current_password = "Enter your current password.";

    if (!form.password) next.password = "Choose a new password.";
    else if (
      form.password.length < 8 ||
      !/[a-z]/.test(form.password) ||
      !/[A-Z]/.test(form.password) ||
      !/[0-9]/.test(form.password) ||
      !/[^A-Za-z0-9]/.test(form.password)
    )
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
    <section className="card p-6">
      <h3 className="font-display text-base font-bold text-slate-900">Change password</h3>
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
        <TextField
          id="profile-new-password"
          label="New password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={form.password}
          onChange={update("password")}
          error={errors.password}
          hint="At least 8 characters with upper and lower case, a number and a symbol."
        />
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
    </section>
  );
}
