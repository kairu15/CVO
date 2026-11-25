import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { adminApi } from "../api/adminApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { PaginationFooter } from "../components/PaginationFooter";
import { SelectAllCheckbox } from "../components/SelectAllCheckbox";
import { BulkActionBar } from "../components/BulkActionBar";
import { Icon } from "../components/Icons";
import { SearchField } from "../components/SearchField";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useRowSelection } from "../hooks/useRowSelection";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ROLE_KEYS, STAFF_ROLE_KEYS, roleLabel } from "../config/roles";

/**
 * Admin "User Management" screen — the account lifecycle, not just roles.
 *
 * Lists every account (search + role + status filters, all
 * server-side so the table can paginate) and offers the write actions the API
 * exposes: create a staff account (with a password now, or an emailed setup
 * link the new staff member completes themselves), edit name/email/role,
 * deactivate (singly or in bulk), reactivate, and inspect one account's
 * activity trail (last sign-in, creator, role changes — the append-only audit
 * log read back, not a second store).
 *
 * Rules mirrored from the server rather than invented here, each stated in
 * the UI so the reason is visible instead of arriving as a 422:
 *   - an administrator cannot change their own role,
 *   - an administrator cannot deactivate their own account (its bulk
 *     checkbox is disabled too — the server skips it and reports the miss),
 *   - a new account cannot sign in until its email address is verified; a
 *     passwordless account then sets its own password from the one-time link.
 * In all cases the server is the authority; the disabled control only saves
 * the round trip.
 *
 * Deactivation is the soft delete the rest of the system uses, so it is
 * reversible and never destroys the rows that reference the account.
 */

/** Badge tones per role, so the roles are distinguishable at a glance. */
const ROLE_TONES = {
  admin: "bg-brand-100 text-brand-900",
  technician: "bg-amber-50 text-amber-800",
  farmer: "bg-slate-100 text-slate-600",
};

/** Which account states the table is showing — maps to the API's `status`. */
const STATUS_FILTERS = [
  { key: "all", label: "All statuses" },
  { key: "active", label: "Active only" },
  { key: "deactivated", label: "Deactivated only" },
];

/** One sortable table heading; `aria-sort` carries the state. */
function SortableHeader({ label, sortKey, sort, onSort, className = "" }) {
  const active = sort.key === sortKey;

  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-4 py-2.5 font-semibold ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase transition hover:text-brand-800 ${
          active ? "text-brand-800" : ""
        }`}
      >
        {label}
        <span aria-hidden="true" className="text-[9px]">
          {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

const EMPTY_CREATE = {
  name: "",
  email: "",
  role: "technician",
};

/** Mirrors the server's `email:rfc` rule closely enough to save a round trip. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The account-state label the table and the activity modal show. Email
 * verification is a separate axis from disabled/enabled, so a disabled
 * account is "Disabled" regardless of whether its address was verified.
 */
function verificationLabel(row) {
  if (!row) return "—";
  if (row.status === "deactivated") return "Disabled";
  if (row.verification_status === "pending") return "Pending verification";
  if (row.verification_status === "expired") return "Verification expired";
  return "Active / Verified";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Never"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Compact "2 h ago" for the table; the exact timestamp rides in a title. */
function relativeTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;

  return formatDate(value);
}

/** Human copy for the audit actions the activity modal shows. */
const ACTIVITY_LABELS = {
  login: "Signed in",
  logout: "Signed out",
  logout_all: "Signed out everywhere",
  failed_login: "Failed sign-in attempt",
  token_issued: "Signed in (mobile token)",
  password_changed: "Changed their password",
  password_reset_requested: "Requested a password reset",
  password_reset_completed: "Completed a password reset",
  user_created: "Account created",
  user_invited: "Account created — setup link sent",
  user_updated: "Account details edited",
  role_changed: "Role changed",
  user_deactivated: "Account deactivated",
  user_reactivated: "Account reactivated",
  user_deleted: "Account permanently deleted",
  setup_link_resent: "Setup link re-sent",
  verification_email_sent: "Verification email sent",
  email_verified: "Email address verified",
  sessions_revoked: "Signed out of every device",
};

export default function UserManagementPage() {
  const toast = useToast();
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRole = searchParams.get("role");
  const requestedPresence = searchParams.get("presence");

  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState(null);
  // Server-computed page-independent figures ("N online") — the count follows
  // the other filters but never the presence filter itself.
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState(() =>
    requestedRole && ROLE_KEYS.includes(requestedRole) ? requestedRole : "all",
  );
  const [statusFilter, setStatusFilter] = useState("all");
  const [presenceFilter, setPresenceFilter] = useState(() =>
    requestedPresence === "online" || requestedPresence === "offline" ? requestedPresence : "all",
  );
  const [neverSignedIn, setNeverSignedIn] = useState(false);
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [perPage, setPerPage] = useState(50);
  const debouncedSearch = useDebouncedValue(search, 300);

  // Account being edited / created, plus the field errors the server returned.
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", role: "" });
  const [editErrors, setEditErrors] = useState({});

  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE);
  const [createErrors, setCreateErrors] = useState({});
  // Invite mode (default): no password is typed here — the new staff member
  // sets their own via a one-time link. Flipping to "password now" keeps the
  // old flow available for a shared-desk setup.
  const [inviteMode, setInviteMode] = useState(true);
  const [created, setCreated] = useState(null); // {name, setup_url} after a setup link
  // The result of creating an account: the verification email is the
  // deliverable now, so this replaces the old "setup link ready" dialog on
  // the create path. `sent === false` means the account exists but Gmail
  // refused the message; the admin can retry from here or from the row.
  const [verificationNotice, setVerificationNotice] = useState(null);

  /** Account awaiting deactivation confirmation — null when no dialog is up. */
  const [confirming, setConfirming] = useState(null);

  // Permanent deletion: the row awaiting confirmation, the email the admin
  // must retype to unlock the button, and the server's refusal when the
  // account still holds records.
  const [deleting, setDeleting] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // Bulk selection over the CURRENT page's active accounts.
  const { selected, toggle, toggleAll, clear } = useRowSelection();
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReactivateConfirming, setBulkReactivateConfirming] = useState(false);
  const [bulkReactivating, setBulkReactivating] = useState(false);

  // A role change to administrator is the one edit that widens an account's
  // power to everything; confirm it before the request leaves the page.
  const [confirmRoleChange, setConfirmRoleChange] = useState(false);

  // Security actions in the activity modal, each with its own in-flight key.
  const [securityBusy, setSecurityBusy] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  // Per-account activity modal.
  const [activity, setActivity] = useState(null); // {user, activity}
  const [activityLoading, setActivityLoading] = useState(false);

  const [saving, setSaving] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const rows = await adminApi.listUsersPage({
        per_page: perPage,
        page,
        role: roleFilter === "all" ? undefined : roleFilter,
        search: debouncedSearch || undefined,
        // `all` keeps deactivated accounts visible so they can be brought
        // back; the API's own default is `active` for the picker endpoints.
        status: statusFilter,
        never_signed_in: neverSignedIn || undefined,
        // Presence is its own axis; `all` is expressed by omitting it.
        presence: presenceFilter === "all" ? undefined : presenceFilter,
        sort: sort.key,
        dir: sort.dir,
      });

      setUsers(rows?.data ?? []);
      setMeta(rows?.meta ?? null);
      setSummary(rows?.summary ?? null);
    } catch (err) {
      if (!quiet) setError(getErrorMessage(err));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [roleFilter, statusFilter, presenceFilter, debouncedSearch, page, neverSignedIn, perPage, sort]);

  useEffect(() => {
    load();
  }, [load]);

  // Deep links from the role cards (and from any shared investigation) keep
  // the role filter in the URL, so the view survives a reload and can be
  // bookmarked.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);

    if (roleFilter === "all") next.delete("role");
    else next.set("role", roleFilter);

    if (presenceFilter === "all") next.delete("presence");
    else next.set("presence", presenceFilter);

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [roleFilter, presenceFilter, searchParams, setSearchParams]);

  // Quietly re-fetch so accounts registered or changed elsewhere appear live.
  // Paused while one account's activity drawer is open: a background refresh
  // must not swap the rows under the drawer the admin is reading.
  useAutoRefresh(load, { enabled: activity === null });

  /** Accounts currently signed in, per the server (0 until the first load). */
  const onlineCount = summary?.online ?? 0;

  const counts = useMemo(() => {
    const tally = Object.fromEntries(ROLE_KEYS.map((key) => [key, 0]));
    for (const row of users) {
      if (row.role in tally) tally[row.role] += 1;
    }
    return tally;
  }, [users]);

  /** Every row except yourself is selectable; the two bulk actions then act
   * on the active or deactivated subset of the selection. */
  const selectableIds = useMemo(
    () => users.filter((row) => row.id !== currentUser?.id).map((row) => row.id),
    [users, currentUser?.id],
  );

  const selectedActive = useMemo(
    () => users.filter((row) => row.status === "active" && selected.has(row.id)).map((row) => row.id),
    [users, selected],
  );

  const selectedDeactivated = useMemo(
    () =>
      users
        .filter((row) => row.status === "deactivated" && selected.has(row.id))
        .map((row) => row.id),
    [users, selected],
  );

  /** The account being edited is the signed-in administrator's own. */
  const editingSelf = editing !== null && editing.id === currentUser?.id;

  /** Retyping the exact email is what unlocks the permanent-delete button. */
  const deleteConfirmed =
    deleting !== null &&
    deleteConfirmText.trim().toLowerCase() ===
      (deleting.email ?? "").trim().toLowerCase();

  /** True once the edit form holds something the account does not already. */
  const editDirty =
    editing !== null &&
    (editForm.name !== editing.name ||
      editForm.email !== editing.email ||
      editForm.role !== editing.role);

  function openEditor(row) {
    setEditing(row);
    setEditForm({ name: row.name, email: row.email, role: row.role });
    setEditErrors({});
  }

  function openCreate() {
    setCreating(true);
    setCreateForm(EMPTY_CREATE);
    setCreateErrors({});
    setInviteMode(true);
  }

  async function openActivity(row) {
    setActivity({ user: row, activity: [] });
    setActivityLoading(true);

    try {
      const data = await adminApi.userActivity(row.id);
      setActivity(data);
    } catch (err) {
      toast.error(getErrorMessage(err));
      setActivity(null);
    } finally {
      setActivityLoading(false);
    }
  }

  /**
   * Shared shape for the create/edit failures: field-level messages go
   * against their inputs, anything else (403, network) becomes a toast.
   */
  function reportFailure(err, setFieldErrors) {
    const fields = getFieldErrors(err);

    if (fields) {
      setFieldErrors(fields);
      return;
    }

    toast.error(getErrorMessage(err));
  }

  function saveEdit() {
    if (!editing || !editDirty) return;

    // Promoting to administrator grants every capability — ask first. Any
    // other role change is saveable directly.
    if (!editingSelf && editForm.role === "admin" && editing.role !== "admin") {
      setConfirmRoleChange(true);
      return;
    }

    commitEdit();
  }

  async function commitEdit() {
    if (!editing || !editDirty) return;

    setSaving(true);
    setEditErrors({});

    try {
      const updated = await adminApi.updateUser(editing.id, {
        name: editForm.name,
        email: editForm.email,
        role: editForm.role,
      });

      setEditing(null);
      await load();

      const roleChanged = updated?.role && updated.role !== editing.role;
      // Changing the address clears verification and sends a fresh link; say
      // so, otherwise "updated" hides why the account is pending again.
      const emailChanged = updated?.email && updated.email !== editing.email;
      const notes = [];

      if (roleChanged) notes.push(`now ${roleLabel(updated.role)}`);
      if (emailChanged) notes.push(`verification email sent to ${updated.email}`);

      toast.success(
        notes.length > 0
          ? `${updated?.name ?? editForm.name} saved — ${notes.join(", ")}.`
          : `${updated?.name ?? editForm.name} updated.`,
      );
    } catch (err) {
      reportFailure(err, setEditErrors);
    } finally {
      setSaving(false);
    }
  }

  async function saveCreate() {
    const name = createForm.name.trim();
    const email = createForm.email.trim();
    const nextErrors = {};

    // The same two rules the server enforces, checked first so the admin sees
    // the problem against the field instead of as a 422 round trip.
    if (!name) nextErrors.name = "Enter the staff member's full name.";
    if (!email) nextErrors.email = "Enter the staff member's email address.";
    else if (!EMAIL_PATTERN.test(email)) {
      nextErrors.email = "Enter a complete email address, for example name@gmail.com.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setCreateErrors(nextErrors);
      return;
    }

    setSaving(true);
    setCreateErrors({});

    try {
      const payload = { ...createForm, name, email };

      if (inviteMode) {
        delete payload.password;
        delete payload.password_confirmation;
      } else {
        payload.password = createForm.password;
        payload.password_confirmation = createForm.password_confirmation;
      }

      const result = await adminApi.createUser(payload);

      setCreating(false);
      await load();

      // The account is pending verification in both modes. The notice says
      // whether the mail actually left, because that is the one thing the
      // admin needs to act on.
      setVerificationNotice({
        id: result?.id ?? null,
        name: result?.name ?? name,
        email: result?.email ?? email,
        sent: result?.verification?.email_sent !== false,
        expiresInHours: result?.verification?.expires_in_hours ?? 24,
      });
    } catch (err) {
      reportFailure(err, setCreateErrors);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Re-issue a pending account's verification link. The server rotates the
   * token, so the email that was already sent stops working — the admin never
   * ends up with two valid links.
   */
  async function resendVerification(row) {
    setSecurityBusy(`verification-${row.id}`);

    try {
      const result = await adminApi.resendVerificationEmail(row.id);
      const sent = result?.email_sent !== false;

      await load();

      setVerificationNotice((current) =>
        current && current.id === row.id
          ? { ...current, sent, expiresInHours: result?.expires_in_hours ?? current.expiresInHours }
          : current,
      );

      if (sent) {
        toast.success(`A new verification email was sent to ${row.email}.`);
      } else {
        toast.error("The verification email could not be sent. Check the mail configuration and try again.");
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSecurityBusy(null);
    }
  }

  async function deactivate(row) {
    setSaving(true);

    try {
      const updated = await adminApi.deactivateUser(row.id);

      setConfirming(null);
      await load();

      toast.success(
        `${updated?.name ?? row.name} has been deactivated and signed out everywhere.`,
      );
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function deactivateBulk() {
    setBulkBusy(true);

    try {
      const result = await adminApi.bulkDeactivateUsers([...selected]);

      setBulkConfirming(false);
      clear();
      await load();

      const skipped = result?.failed_ids?.length ?? 0;

      toast.success(
        skipped > 0
          ? `${result.updated} account${result.updated === 1 ? "" : "s"} deactivated — ${skipped} skipped (your own account cannot be deactivated here).`
          : `${result?.updated ?? 0} account${result?.updated === 1 ? "" : "s"} deactivated and signed out everywhere.`,
      );
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBulkBusy(false);
    }
  }

  async function reactivate(row) {
    setSaving(true);

    try {
      const updated = await adminApi.reactivateUser(row.id);

      await load();

      toast.success(`${updated?.name ?? row.name} can sign in again.`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function reactivateBulk() {
    setBulkReactivating(true);

    try {
      const result = await adminApi.bulkReactivateUsers(selectedDeactivated);

      setBulkReactivateConfirming(false);
      clear();
      await load();

      const skipped = result?.failed_ids?.length ?? 0;

      toast.success(
        skipped > 0
          ? `${result.updated} account${result.updated === 1 ? "" : "s"} reactivated — ${skipped} skipped.`
          : `${result?.updated ?? 0} account${result?.updated === 1 ? "" : "s"} can sign in again.`,
      );
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBulkReactivating(false);
    }
  }

  /** Re-issue the setup link for an invited account that has never signed in. */
  async function sendSetupLink(row) {
    setSecurityBusy(`setup-${row.id}`);

    try {
      const setupUrl = await adminApi.resendSetupLink(row.id);
      setCreated({ name: row.name, setup_url: setupUrl, resent: true });
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSecurityBusy(null);
    }
  }

  /** Email a reset link; the admin never types or sees the password. */
  async function sendPasswordReset(row) {
    setSecurityBusy(`reset-${row.id}`);

    try {
      const result = await adminApi.sendPasswordReset(row.id);
      toast.success(result?.message ?? `A password reset link was sent to ${row.email}.`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSecurityBusy(null);
    }
  }

  /** End every session without deactivating — the lost-device response. */
  async function revokeSessions(row) {
    setSecurityBusy(`revoke-${row.id}`);

    try {
      await adminApi.revokeSessions(row.id);
      setConfirmRevoke(false);
      setActivity(null);
      toast.success(`${row.name} has been signed out of every device.`);
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSecurityBusy(null);
    }
  }

  function openDelete(row) {
    setDeleting(row);
    setDeleteConfirmText("");
    setDeleteError(null);
  }

  /**
   * Irreversible: remove the account outright. The server is the guard — it
   * refuses an account that still holds records — so a refusal is shown in
   * the dialog rather than assumed impossible here.
   */
  async function purgeAccount() {
    if (!deleting || !deleteConfirmed) return;

    setDeleteBusy(true);
    setDeleteError(null);

    try {
      const name = deleting.name;

      await adminApi.permanentlyDeleteUser(deleting.id);

      setDeleting(null);
      clear();
      await load();

      toast.success(`${name} has been permanently deleted.`);
    } catch (err) {
      setDeleteError(getErrorMessage(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  function toggleSort(key) {
    setSort((current) => {
      if (current.key === key) {
        return { key, dir: current.dir === "desc" ? "asc" : "desc" };
      }
      return { key, dir: key === "name" ? "asc" : "desc" };
    });
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Account Administration</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              User Management
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Every staff account in the program is created here, and
              deactivating an account keeps its records while blocking sign-in.
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
            <SearchField
              id="account-search"
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              label={null}
              placeholder="Search name, username or email…"
              ariaLabel="Search accounts"
              className="w-full sm:w-72"
            />

            <a
              href={adminApi.exportUsersUrl({
                role: roleFilter === "all" ? undefined : roleFilter,
                status: statusFilter,
                search: debouncedSearch || undefined,
                never_signed_in: neverSignedIn || undefined,
                sort: sort.key,
                dir: sort.dir,
              })}
              className="btn-secondary inline-flex items-center gap-1.5 rounded-pill px-4 py-2 text-sm font-semibold"
            >
              <Icon name="clipboard" className="h-4 w-4" />
              Export CSV
            </a>

            <button
              type="button"
              onClick={openCreate}
              className="btn-primary inline-flex items-center gap-1.5 rounded-pill px-4 py-2 text-sm font-semibold"
            >
              <Icon name="plus" className="h-4 w-4" />
              New staff account
            </button>
          </div>
        </div>

        {/* Role filter — mirrors the `role` query parameter the API accepts. */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            Role
          </span>
          <button
            type="button"
            onClick={() => {
              setRoleFilter("all");
              setPage(1);
            }}
            aria-pressed={roleFilter === "all"}
            className={`rounded-pill px-3 py-1.5 text-xs font-semibold transition ${
              roleFilter === "all"
                ? "bg-brand-700 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-800"
            }`}
          >
            All roles
          </button>

          {ROLE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setRoleFilter(key);
                setPage(1);
              }}
              aria-pressed={roleFilter === key}
              className={`rounded-pill px-3 py-1.5 text-xs font-semibold transition ${
                roleFilter === key
                  ? "bg-brand-700 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-800"
              }`}
            >
              {roleLabel(key)}
            </button>
          ))}
        </div>

        {/* Status filter — needed to find a deactivated account again. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            Status
          </span>
          {STATUS_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setStatusFilter(key);
                setPage(1);
              }}
              aria-pressed={statusFilter === key}
              className={`rounded-pill px-3 py-1.5 text-xs font-semibold transition ${
                statusFilter === key
                  ? "bg-brand-700 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-800"
              }`}
            >
              {label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => {
              setNeverSignedIn((current) => !current);
              setPage(1);
            }}
            aria-pressed={neverSignedIn}
            className={`rounded-pill px-3 py-1.5 text-xs font-semibold transition ${
              neverSignedIn
                ? "bg-amber-500 text-white"
                : "bg-amber-50 text-amber-800 hover:bg-amber-100"
            }`}
          >
            Never signed in
          </button>

        </div>

        {/* Presence filter — "who is signed in right now". A separate axis
            from Status (whether the account is enabled), kept in the URL like
            the role filter so the view survives a reload. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            {t("userManagement.presence.label")}
          </span>
          {["all", "online", "offline"].map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setPresenceFilter(key);
                setPage(1);
              }}
              aria-pressed={presenceFilter === key}
              className={`rounded-pill px-3 py-1.5 text-xs font-semibold transition ${
                presenceFilter === key
                  ? "bg-brand-700 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-800"
              }`}
            >
              {t(`userManagement.presence.${key}`)}
            </button>
          ))}

          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500">
            Rows
            <select
              value={perPage}
              onChange={(event) => {
                setPerPage(Number(event.target.value));
                setPage(1);
              }}
              className="field !w-20 !px-2 !py-1 text-xs"
              aria-label="Accounts per page"
            >
              {[25, 50].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}

      <section className="card overflow-hidden">
        {loading ? (
          <SkeletonList rows={4} />
        ) : users.length === 0 ? (
          <EmptyState
            title="No accounts found"
            description={
              debouncedSearch
                ? "No account matches that search. Try a different name, username or email."
                : "Accounts appear here once an administrator creates them."
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-700">
                {meta?.total ?? users.length} {(meta?.total ?? users.length) === 1 ? "account" : "accounts"}
              </span>
              {/* The live figure, deliberately unaffected by the presence
                  filter so switching to "Offline" still says how many are on. */}
              <span
                className="inline-flex items-center gap-1.5 font-medium text-emerald-700"
                title={t("userManagement.presence.onlineCountHint")}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    onlineCount > 0 ? "animate-pulse bg-emerald-500 motion-reduce:animate-none" : "bg-slate-300"
                  }`}
                />
                {t("userManagement.presence.onlineCount", { n: onlineCount })}
              </span>
              {ROLE_KEYS.some((key) => counts[key] > 0) && (
                <span className="text-slate-400">On this page:</span>
              )}
              {ROLE_KEYS.filter((key) => counts[key] > 0).map((key) => (
                <span key={key}>
                  {counts[key]} {roleLabel(key)}
                </span>
              ))}
            </div>

            {/* Bulk actions act on the matching half of the selection. */}
            <BulkActionBar
              count={selected.size}
              onClear={clear}
              noun="account"
              busy={bulkBusy || bulkReactivating}
            >
              <button
                type="button"
                onClick={() => setBulkConfirming(true)}
                disabled={bulkBusy || bulkReactivating || selectedActive.length === 0}
                className="inline-flex items-center gap-1 rounded-pill bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {bulkBusy ? <ButtonSpinner className="border-rose-200 border-t-white" /> : null}
                Deactivate selected
              </button>
              <button
                type="button"
                onClick={() => setBulkReactivateConfirming(true)}
                disabled={bulkBusy || bulkReactivating || selectedDeactivated.length === 0}
                className="inline-flex items-center gap-1 rounded-pill bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {bulkReactivating ? <ButtonSpinner className="border-emerald-200 border-t-white" /> : null}
                Reactivate selected
              </button>
            </BulkActionBar>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <colgroup>
                  <col className="w-[4%]" />
                  <col className="w-[23%]" />
                  <col className="w-[20%]" />
                  <col className="w-[10%]" />
                  <col className="w-[14%]" />
                  <col className="w-[12%]" />
                  <col className="w-[9%]" />
                  <col />
                </colgroup>
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                    <th scope="col" className="px-4 py-2.5">
                      <SelectAllCheckbox
                        ids={selectableIds}
                        selected={selected}
                        onToggleAll={toggleAll}
                      />
                    </th>
                    <SortableHeader
                      label="Account"
                      sortKey="name"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <th scope="col" className="hidden px-4 py-2.5 font-semibold md:table-cell">
                      Email
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Role</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                    <SortableHeader
                      label="Last sign-in"
                      sortKey="last_login_at"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <SortableHeader
                      label="Added"
                      sortKey="created_at"
                      sort={sort}
                      onSort={toggleSort}
                      className="hidden lg:table-cell"
                    />
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((row) => {
                    const isSelf = row.id === currentUser?.id;
                    const deactivated = row.status === "deactivated";
                    // Presence is the server's answer, primed per page; a
                    // deactivated account is never online regardless.
                    const online = !deactivated && row.presence === "online";
                    // Older payloads (and fixtures) predate the field; treat
                    // a missing value as verified rather than inventing a
                    // pending state.
                    const verification = row.verification_status ?? "verified";
                    const verified = verification === "verified";

                    return (
                      <tr
                        key={row.id}
                        className={`transition hover:bg-brand-50/40 ${deactivated ? "bg-slate-50/70" : ""}`}
                      >
                        <td className="px-4 py-2.5">
                          {/* Both statuses are selectable; the bulk buttons
                              then act on the matching subset. Your own
                              account is refused by the server. */}
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.name}`}
                            checked={selected.has(row.id)}
                            disabled={isSelf}
                            onChange={() => toggle(row.id)}
                            className="h-4 w-4 accent-brand-700 disabled:opacity-30"
                          />
                        </td>
                        <td className="px-4 py-2.5 font-medium whitespace-nowrap text-slate-900">
                          <span className={deactivated ? "text-slate-500" : undefined}>
                            {row.name}
                          </span>
                          {isSelf && (
                            <span className="ml-2 rounded-pill bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                              You
                            </span>
                          )}
                          <span className="block text-[11px] font-normal text-slate-500">
                            {row.username ? `@${row.username}` : "No username"}
                          </span>
                        </td>
                        <td className="hidden truncate px-4 py-2.5 text-slate-600 md:table-cell">
                          {row.email}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span
                            className={`rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${
                              ROLE_TONES[row.role] ?? ROLE_TONES.farmer
                            }`}
                          >
                            {roleLabel(row.role)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {deactivated ? (
                            <span
                              aria-label={t("userManagement.presence.deactivatedAria")}
                              className="inline-flex items-center gap-1.5 rounded-pill bg-rose-50 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-rose-700 uppercase"
                            >
                              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                              Disabled
                            </span>
                          ) : verified ? (
                            <span
                              aria-label="Active and verified"
                              className="inline-flex items-center gap-1.5 rounded-pill bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase"
                            >
                              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Active / Verified
                            </span>
                          ) : verification === "pending" ? (
                            <span
                              aria-label="Pending email verification"
                              className="inline-flex items-center gap-1.5 rounded-pill bg-amber-50 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-amber-800 uppercase"
                            >
                              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              Pending verification
                            </span>
                          ) : (
                            <span
                              aria-label="Email verification expired"
                              className="inline-flex items-center gap-1.5 rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-slate-600 uppercase"
                            >
                              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                              Verification expired
                            </span>
                          )}
                          {deactivated ? (
                            row.deactivated_at && (
                              <span className="mt-1 block text-[10px] text-slate-400">
                                {formatDate(row.deactivated_at)}
                              </span>
                            )
                          ) : verified ? (
                            <span className="mt-1 block text-[10px] text-slate-400">
                              <span
                                aria-label={
                                  online
                                    ? t("userManagement.presence.onlineAria")
                                    : t("userManagement.presence.offlineAria")
                                }
                                className={online ? "font-semibold text-emerald-700" : undefined}
                              >
                                {online
                                  ? t("userManagement.presence.online")
                                  : t("userManagement.presence.offline")}
                              </span>
                              {" · "}
                              {row.last_seen_at
                                ? t("userManagement.presence.lastSeen", {
                                    time: relativeTime(row.last_seen_at),
                                  })
                                : t("userManagement.presence.neverSeen")}
                            </span>
                          ) : (
                            <span className="mt-1 block text-[10px] text-slate-400">
                              {verification === "pending" && row.verification_expires_at
                                ? `Link expires ${formatDateTime(row.verification_expires_at)}`
                                : "Email not verified"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {row.last_login_at ? (
                            <span
                              className="text-slate-600"
                              title={formatDateTime(row.last_login_at)}
                            >
                              {relativeTime(row.last_login_at)}
                            </span>
                          ) : (
                            <span className="font-semibold text-amber-700">Never</span>
                          )}
                        </td>
                        <td className="hidden px-4 py-2.5 whitespace-nowrap text-slate-500 lg:table-cell">
                          {formatDate(row.created_at)}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {!isSelf && !deactivated && !verified && (
                            <button
                              type="button"
                              onClick={() => resendVerification(row)}
                              disabled={securityBusy === `verification-${row.id}`}
                              className="mr-1 rounded-pill px-3 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-50 disabled:opacity-50"
                            >
                              {securityBusy === `verification-${row.id}`
                                ? "Sending…"
                                : "Resend verification"}
                            </button>
                          )}
                          {!isSelf && !deactivated && verified && !row.last_login_at && (
                            <button
                              type="button"
                              onClick={() => sendSetupLink(row)}
                              disabled={securityBusy === `setup-${row.id}`}
                              className="mr-1 rounded-pill px-3 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-50 disabled:opacity-50"
                            >
                              {securityBusy === `setup-${row.id}` ? "Sending…" : "Setup link"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openActivity(row)}
                            className="rounded-pill px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100"
                          >
                            Activity
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditor(row)}
                            className="rounded-pill px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100"
                          >
                            Edit
                          </button>

                          {deactivated ? (
                            <button
                              type="button"
                              onClick={() => reactivate(row)}
                              disabled={saving}
                              className="ml-1 rounded-pill px-3 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
                            >
                              Reactivate
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirming(row)}
                              disabled={isSelf || saving}
                              title={
                                isSelf
                                  ? "You cannot deactivate your own account."
                                  : undefined
                              }
                              className="ml-1 rounded-pill px-3 py-1 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                            >
                              Deactivate
                            </button>
                          )}

                          {/* Permanent deletion is refused by the server for
                              any account that holds records; the button is
                              hidden only for your own account, which the
                              server also refuses. */}
                          {!isSelf && (
                            <button
                              type="button"
                              onClick={() => openDelete(row)}
                              disabled={saving || deleteBusy}
                              title="Permanently delete this account (cannot be undone)."
                              className="ml-1 rounded-pill px-3 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <PaginationFooter
              meta={meta}
              shown={users.length}
              noun="account"
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {/* Create — staff roles only; the server rejects `farmer` here. */}
      <Modal
        open={creating}
        title="New staff account"
        onClose={() => setCreating(false)}
        contentClassName="max-w-lg"
      >
        <p className="text-xs text-slate-500">
          The account starts as <span className="font-semibold text-slate-700">Pending verification</span>.
          A branded verification email is sent to this address and must be opened
          before the staff member can sign in.
        </p>
        <p className="mt-1.5 text-xs text-slate-500">
          {inviteMode
            ? "After verifying, they set their own password on a one-time link."
            : "After verifying, they sign in with the password you type below — share it with them directly."}
        </p>

        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveCreate();
          }}
        >
          <div>
            <label htmlFor="create-name" className="block text-xs font-semibold text-slate-600">
              Full name
            </label>
            <input
              id="create-name"
              className="field mt-1 w-full text-sm"
              value={createForm.name}
              onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })}
              autoComplete="off"
            />
            {createErrors.name && (
              <p className="mt-1 text-[11px] text-rose-600">{createErrors.name}</p>
            )}
          </div>

          <div>
            <label htmlFor="create-email" className="block text-xs font-semibold text-slate-600">
              Email
            </label>
            <input
              id="create-email"
              type="email"
              className="field mt-1 w-full text-sm"
              value={createForm.email}
              onChange={(event) => {
                setCreateForm({ ...createForm, email: event.target.value });
                setCreateErrors((current) => ({ ...current, email: undefined }));
              }}
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              aria-invalid={createErrors.email ? true : undefined}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Use a real inbox the staff member can open — the verification link
              and future password reset codes are sent here.
            </p>
            {createErrors.email && (
              <p className="mt-1 text-[11px] text-rose-600">{createErrors.email}</p>
            )}
          </div>

          <div>
            <label htmlFor="create-role" className="block text-xs font-semibold text-slate-600">
              Role
            </label>
            <select
              id="create-role"
              className="field mt-1 w-full text-sm"
              value={createForm.role}
              onChange={(event) => setCreateForm({ ...createForm, role: event.target.value })}
            >
              {STAFF_ROLE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {roleLabel(key)}
                </option>
              ))}
            </select>
            {createErrors.role && (
              <p className="mt-1 text-[11px] text-rose-600">{createErrors.role}</p>
            )}
          </div>

          {/* How the password arrives — the invite link (default) or a typed
              one. Both are real server paths; this toggle only picks which
              payload is sent. */}
          <fieldset className="rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Password
            </legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-start gap-2 text-xs text-slate-700">
                <input
                  type="radio"
                  name="password-mode"
                  checked={inviteMode}
                  onChange={() => setInviteMode(true)}
                  className="mt-0.5 h-4 w-4 accent-brand-700"
                />
                <span>
                  <span className="font-semibold">Email a verification link</span> —
                  they verify, then choose their own password.
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs text-slate-700">
                <input
                  type="radio"
                  name="password-mode"
                  checked={!inviteMode}
                  onChange={() => setInviteMode(false)}
                  className="mt-0.5 h-4 w-4 accent-brand-700"
                />
                <span className="font-semibold">Set a password now</span>
              </label>
            </div>

            {!inviteMode && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="create-password"
                    className="block text-xs font-semibold text-slate-600"
                  >
                    Password
                  </label>
                  <input
                    id="create-password"
                    type="password"
                    className="field mt-1 w-full text-sm"
                    value={createForm.password ?? ""}
                    onChange={(event) =>
                      setCreateForm({ ...createForm, password: event.target.value })
                    }
                    autoComplete="new-password"
                  />
                  {createErrors.password && (
                    <p className="mt-1 text-[11px] text-rose-600">{createErrors.password}</p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="create-password-confirmation"
                    className="block text-xs font-semibold text-slate-600"
                  >
                    Confirm password
                  </label>
                  <input
                    id="create-password-confirmation"
                    type="password"
                    className="field mt-1 w-full text-sm"
                    value={createForm.password_confirmation ?? ""}
                    onChange={(event) =>
                      setCreateForm({ ...createForm, password_confirmation: event.target.value })
                    }
                    autoComplete="new-password"
                  />
                </div>

                <p className="text-[11px] text-slate-500 sm:col-span-2">
                  At least 8 characters, with upper and lower case, a number and
                  a symbol — the same policy registration uses.
                </p>
              </div>
            )}
          </fieldset>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary inline-flex items-center gap-2"
              disabled={saving}
            >
              {saving ? (
                <>
                  <ButtonSpinner />
                  Creating &amp; sending verification email…
                </>
              ) : (
                "Create account & send verification email"
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Invite created — the one-time setup link, copyable. */}
      <Modal
        open={created !== null}
        title={created?.resent ? "Setup link ready" : "Account created — setup link ready"}
        onClose={() => setCreated(null)}
        contentClassName="max-w-lg"
      >
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{created?.name}</span>{" "}
          {created?.resent
            ? "has not signed in yet. This new one-time link replaces any earlier setup link and lets them set their own password:"
            : "has an account. This one-time link lets them set their own password:"}
        </p>

        <div className="mt-3 flex items-start gap-2">
          <code className="flex-1 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] break-all text-slate-700">
            {created?.setup_url}
          </code>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(created?.setup_url ?? "");
                toast.success("Setup link copied.");
              } catch {
                toast.error("Copying failed — select the link text manually.");
              }
            }}
            className="btn-secondary rounded-pill px-4 py-2 text-xs font-semibold"
          >
            Copy
          </button>
        </div>

        <p className="mt-3 text-[11px] text-slate-500">
          The link is also sent to their email address. If no mail service is
          configured yet, hand the link over directly — it expires and can only
          be used once.
        </p>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="btn-primary rounded-pill px-4 py-2 text-sm font-semibold"
            onClick={() => setCreated(null)}
          >
            Done
          </button>
        </div>
      </Modal>

      {/* Account created — the verification email is the deliverable. The
          account exists in both branches; only delivery differs, so the admin
          knows immediately whether to retry. */}
      <Modal
        open={verificationNotice !== null}
        title={
          verificationNotice?.sent
            ? "Verification email sent"
            : "Account created — email not sent"
        }
        onClose={() => setVerificationNotice(null)}
        contentClassName="max-w-lg"
      >
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{verificationNotice?.name}</span>{" "}
          has been added as a staff account and is now{" "}
          <span className="font-semibold text-amber-800">Pending verification</span>.
        </p>

        <div className="mt-3" aria-live="polite">
          {verificationNotice?.sent ? (
            <InlineAlert
              tone="success"
              message={`A verification email was sent to ${verificationNotice?.email}. The link expires in ${verificationNotice?.expiresInHours} hours and can only be used once.`}
            />
          ) : (
            <InlineAlert
              tone="error"
              message={`The account was created, but the verification email to ${verificationNotice?.email} could not be sent. Check the mail configuration, then resend it from here or from the account row.`}
            />
          )}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Sign-in is refused until the staff member opens the link. After
          verifying, they either sign in with the password you set or use the
          one-time setup link shown on the verification page. Resending creates
          a new link and cancels the previous one.
        </p>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {verificationNotice?.id && (
            <button
              type="button"
              className="btn-secondary rounded-pill px-4 py-2 text-sm font-semibold"
              onClick={() => resendVerification(verificationNotice)}
              disabled={securityBusy === `verification-${verificationNotice.id}`}
            >
              {securityBusy === `verification-${verificationNotice.id}`
                ? "Sending…"
                : "Resend email"}
            </button>
          )}
          <button
            type="button"
            className="btn-primary rounded-pill px-4 py-2 text-sm font-semibold"
            onClick={() => setVerificationNotice(null)}
          >
            Done
          </button>
        </div>
      </Modal>

      {/* Bulk deactivation confirmation */}
      <Modal
        open={bulkConfirming}
        title={`Deactivate ${selected.size} ${selected.size === 1 ? "account" : "accounts"}?`}
        onClose={() => setBulkConfirming(false)}
        contentClassName="max-w-md"
      >
        <p className="text-sm text-slate-600">
          Each selected account will no longer be able to sign in, and is signed
          out of every device immediately.
        </p>
        <p className="mt-3 text-xs text-slate-500">
          Their records are kept — the accounts are deactivated, not deleted, so
          anything they logged stays in the system. You can reactivate them from
          this screen at any time.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setBulkConfirming(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-pill bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
            onClick={deactivateBulk}
            disabled={bulkBusy}
          >
            {bulkBusy ? (
              <>
                <ButtonSpinner />
                Deactivating…
              </>
            ) : (
              "Deactivate accounts"
            )}
          </button>
        </div>
      </Modal>

      {/* Bulk reactivation confirmation */}
      <Modal
        open={bulkReactivateConfirming}
        title={`Reactivate ${selectedDeactivated.length} ${selectedDeactivated.length === 1 ? "account" : "accounts"}?`}
        onClose={() => setBulkReactivateConfirming(false)}
        contentClassName="max-w-md"
      >
        <p className="text-sm text-slate-600">
          The selected accounts can sign in again with their existing passwords.
          Their role and records are unchanged.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setBulkReactivateConfirming(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-pill bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            onClick={reactivateBulk}
            disabled={bulkReactivating}
          >
            {bulkReactivating ? (
              <>
                <ButtonSpinner />
                Reactivating…
              </>
            ) : (
              "Reactivate accounts"
            )}
          </button>
        </div>
      </Modal>

      {/* One account's activity trail */}
      <Modal
        open={activity !== null}
        title={`Account activity — ${activity?.user?.name ?? ""}`}
        onClose={() => setActivity(null)}
        contentClassName="max-w-xl"
      >
        {activityLoading || !activity ? (
          <SkeletonList rows={4} />
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-slate-200 px-3 py-2.5">
                <dt className="font-semibold tracking-wide text-slate-500 uppercase">
                  Last sign-in
                </dt>
                <dd className="mt-1 text-sm text-slate-800">
                  {formatDateTime(activity.user.last_login_at)}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-200 px-3 py-2.5">
                <dt className="font-semibold tracking-wide text-slate-500 uppercase">
                  {t("userManagement.presence.lastSeenLabel")}
                </dt>
                <dd className="mt-1 text-sm text-slate-800">
                  {activity.user.last_seen_at
                    ? formatDateTime(activity.user.last_seen_at)
                    : t("userManagement.presence.notYet")}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-200 px-3 py-2.5">
                <dt className="font-semibold tracking-wide text-slate-500 uppercase">
                  Created by
                </dt>
                <dd className="mt-1 text-sm text-slate-800">
                  {activity.user.created_by_name ?? "—"}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-200 px-3 py-2.5">
                <dt className="font-semibold tracking-wide text-slate-500 uppercase">Role</dt>
                <dd className="mt-1 text-sm text-slate-800">{roleLabel(activity.user.role)}</dd>
              </div>
              <div className="rounded-xl border border-slate-200 px-3 py-2.5">
                <dt className="font-semibold tracking-wide text-slate-500 uppercase">Status</dt>
                <dd className="mt-1 text-sm text-slate-800">
                  {verificationLabel(activity.user)}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-200 px-3 py-2.5">
                <dt className="font-semibold tracking-wide text-slate-500 uppercase">
                  Email address
                </dt>
                <dd className="mt-1 truncate text-sm text-slate-800" title={activity.user.email}>
                  {activity.user.email ?? "—"}
                </dd>
              </div>
            </dl>

            {/* Security actions live with the account context. Every one is
                server-gated and audited; the UI only saves the round trip. */}
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                Security
              </p>

              {(activity.security?.failed_logins_7d ?? 0) > 0 && (
                <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800">
                  {activity.security.failed_logins_7d} failed sign-in
                  {activity.security.failed_logins_7d === 1 ? " attempt" : " attempts"} in
                  the last 7 days
                  {activity.security.last_failed_login_at
                    ? ` · last ${formatDateTime(activity.security.last_failed_login_at)}`
                    : ""}
                </p>
              )}

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => sendPasswordReset(activity.user)}
                  disabled={
                    activity.user.status !== "active" ||
                    (activity.user.verification_status ?? "verified") !== "verified" ||
                    securityBusy === `reset-${activity.user.id}`
                  }
                  title={
                    (activity.user.verification_status ?? "verified") !== "verified"
                      ? "Password recovery is available only after the email is verified."
                      : undefined
                  }
                  className="rounded-pill border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {securityBusy === `reset-${activity.user.id}`
                    ? "Sending…"
                    : "Send password reset"}
                </button>

                {activity.user.status === "active" &&
                  (activity.user.verification_status ?? "verified") !== "verified" && (
                    <button
                      type="button"
                      onClick={() => resendVerification(activity.user)}
                      disabled={securityBusy === `verification-${activity.user.id}`}
                      className="rounded-pill border border-amber-200 px-3 py-1.5 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-50 disabled:opacity-50"
                    >
                      {securityBusy === `verification-${activity.user.id}`
                        ? "Sending…"
                        : "Resend verification email"}
                    </button>
                  )}

                {activity.user.status === "active" &&
                  (activity.user.verification_status ?? "verified") === "verified" &&
                  !activity.user.last_login_at && (
                  <button
                    type="button"
                    onClick={() => sendSetupLink(activity.user)}
                    disabled={securityBusy === `setup-${activity.user.id}`}
                    className="rounded-pill border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-50 disabled:opacity-50"
                  >
                    {securityBusy === `setup-${activity.user.id}`
                      ? "Sending…"
                      : "Send setup link"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setConfirmRevoke(true)}
                  disabled={
                    activity.user.id === currentUser?.id ||
                    activity.user.status !== "active" ||
                    securityBusy === `revoke-${activity.user.id}`
                  }
                  className="rounded-pill border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                >
                  Sign out everywhere
                </button>
              </div>

              <p className="mt-2 text-[11px] text-slate-500">
                Password recovery and setup links are emailed to the account
                owner; you never see their password. An unverified account must
                open its verification link first — an administrator cannot skip
                that step. Signing out revokes sessions and API tokens without
                deactivating the account.
              </p>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  History (newest first)
                </p>
                <Link
                  to={`/dashboard/admin/audit?actor_id=${activity.user.id}`}
                  className="text-[11px] font-semibold text-brand-800 hover:underline"
                >
                  Open in Audit Trail →
                </Link>
              </div>
              {activity.activity.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  Nothing recorded yet — this account has not signed in and has
                  not been changed since the audit trail began.
                </p>
              ) : (
                <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {activity.activity.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2"
                    >
                      <span>
                        <span className="text-xs font-semibold text-slate-800">
                          {ACTIVITY_LABELS[entry.action] ?? entry.action}
                        </span>
                        {entry.action === "role_changed" && entry.context && (
                          <span className="ml-1.5 text-xs text-slate-500">
                            {entry.context.previous_role} → {entry.context.new_role}
                          </span>
                        )}
                        <span className="block text-[11px] text-slate-400">
                          {entry.actor?.name && entry.actor.id !== activity.user.id
                            ? `by ${entry.actor.name}`
                            : "by the account itself"}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {formatDateTime(entry.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Edit name / email / role */}
      <Modal
        open={editing !== null}
        title={`Edit account — ${editing?.name ?? ""}`}
        onClose={() => setEditing(null)}
        contentClassName="max-w-lg"
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="edit-name" className="block text-xs font-semibold text-slate-600">
              Full name
            </label>
            <input
              id="edit-name"
              className="field mt-1 w-full text-sm"
              value={editForm.name}
              onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
            />
            {editErrors.name && (
              <p className="mt-1 text-[11px] text-rose-600">{editErrors.name}</p>
            )}
          </div>

          <div>
            <label htmlFor="edit-email" className="block text-xs font-semibold text-slate-600">
              Email
            </label>
            <input
              id="edit-email"
              type="email"
              className="field mt-1 w-full text-sm"
              value={editForm.email}
              onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
            />
            {editErrors.email && (
              <p className="mt-1 text-[11px] text-rose-600">{editErrors.email}</p>
            )}
          </div>

          <div>
            <label htmlFor="edit-role" className="block text-xs font-semibold text-slate-600">
              Role
            </label>
            <select
              id="edit-role"
              className="field mt-1 w-full text-sm"
              value={editForm.role}
              onChange={(event) => setEditForm({ ...editForm, role: event.target.value })}
              disabled={editingSelf}
            >
              {ROLE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {roleLabel(key)}
                </option>
              ))}
            </select>
            {editErrors.role && (
              <p className="mt-1 text-[11px] text-rose-600">{editErrors.role}</p>
            )}
          </div>

          {/* Mirrors a server-side rule, not a substitute for it: the API
              refuses a self role change (UserRoleService), so an administrator
              can never lock themselves out of the admin routes. Disabled here
              so the reason is visible instead of arriving as a 422. */}
          {editingSelf && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-800">
              This is your own account. Changing your role would remove your
              administrator access, so it is disabled here — you can still
              update your name and email. Ask another administrator to change
              the role.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              onClick={saveEdit}
              disabled={saving || !editDirty}
            >
              {saving ? (
                <>
                  <ButtonSpinner />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirmation before granting full administrator access */}
      <Modal
        open={confirmRoleChange}
        title="Grant administrator access?"
        onClose={() => setConfirmRoleChange(false)}
        contentClassName="max-w-md"
      >
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{editing?.name}</span> will
          gain full administrator access — every capability in the role matrix,
          including account and permission management.
        </p>
        <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-3 text-xs text-amber-800">
          Only promote someone who needs that reach. The change is recorded in
          the audit trail under your account.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setConfirmRoleChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setConfirmRoleChange(false);
              commitEdit();
            }}
            className="btn-primary inline-flex items-center gap-2"
          >
            {saving ? <ButtonSpinner /> : null}
            Grant administrator access
          </button>
        </div>
      </Modal>

      {/* Confirmation before revoking every session */}
      <ConfirmDialog
        open={confirmRevoke}
        title="Sign this account out everywhere?"
        message={
          activity
            ? `${activity.user.name} will be signed out of every browser and device. The account stays active and can sign in again immediately.`
            : ""
        }
        confirmLabel="Sign out everywhere"
        cancelLabel="Cancel"
        onConfirm={() => revokeSessions(activity.user)}
        onCancel={() => setConfirmRevoke(false)}
      />

      {/* Permanent deletion — irreversible, so the email must be retyped */}
      <Modal
        open={deleting !== null}
        title="Permanently delete this account?"
        onClose={() => setDeleting(null)}
        contentClassName="max-w-md"
      >
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{deleting?.name}</span>{" "}
          ({deleting?.email}) and their sign-in credentials will be removed from
          the database. This cannot be undone.
        </p>

        <p className="mt-3 rounded-xl bg-rose-50 px-3.5 py-3 text-xs text-rose-800">
          Deactivation is reversible and keeps the account's history. Permanent
          deletion is only for an account that has recorded nothing — the server
          refuses one that authored visits, monitoring or clinical records.
        </p>

        <label
          htmlFor="delete-confirm-email"
          className="mt-4 block text-xs font-semibold text-slate-600"
        >
          Type{" "}
          <span className="font-mono text-slate-900">{deleting?.email}</span> to
          confirm
        </label>
        <input
          id="delete-confirm-email"
          className="field mt-1 w-full text-sm"
          value={deleteConfirmText}
          onChange={(event) => setDeleteConfirmText(event.target.value)}
          autoComplete="off"
          autoFocus
        />

        {deleteError && (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
            {deleteError}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setDeleting(null)}
            disabled={deleteBusy}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={purgeAccount}
            disabled={deleteBusy || !deleteConfirmed}
            className="inline-flex items-center gap-2 rounded-pill bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleteBusy ? (
              <>
                <ButtonSpinner />
                Deleting…
              </>
            ) : (
              "Delete permanently"
            )}
          </button>
        </div>
      </Modal>

      {/* Confirmation before deactivating anyone */}
      <Modal
        open={confirming !== null}
        title="Deactivate this account?"
        onClose={() => setConfirming(null)}
        contentClassName="max-w-md"
      >
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{confirming?.name}</span>{" "}
          will no longer be able to sign in, and is signed out of every device
          immediately.
        </p>
        <p className="mt-3 text-xs text-slate-500">
          Their records are kept — the account is deactivated, not deleted, so
          anything they logged stays in the system. You can reactivate them
          from this screen at any time.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setConfirming(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-pill bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
            onClick={() => deactivate(confirming)}
            disabled={saving}
          >
            {saving ? (
              <>
                <ButtonSpinner />
                Deactivating…
              </>
            ) : (
              "Deactivate account"
            )}
          </button>
        </div>
      </Modal>
    </div>
  );
}
