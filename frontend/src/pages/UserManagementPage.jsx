import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "../api/adminApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { Modal } from "../components/Modal";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { PaginationFooter } from "../components/PaginationFooter";
import { Icon } from "../components/Icons";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ROLE_KEYS, STAFF_ROLE_KEYS, roleLabel } from "../config/roles";

/**
 * Admin "User Management" screen — the account lifecycle, not just roles.
 *
 * Lists every account (search + role + status filters, all server-side so the
 * table can paginate) and offers the four write actions the API exposes:
 * create a staff account, edit name/email/role, deactivate, reactivate.
 *
 * Two rules are mirrored from the server rather than invented here, and both
 * are stated in the UI so the reason is visible instead of arriving as a 422:
 *   - an administrator cannot change their own role, and
 *   - an administrator cannot deactivate their own account.
 * In both cases the server is the authority; the disabled control only saves
 * the round trip.
 *
 * Deactivation is the soft delete the rest of the system uses, so it is
 * reversible and never destroys the rows that reference the account.
 */

/** Badge tones per role, so the four roles are distinguishable at a glance. */
const ROLE_TONES = {
  admin: "bg-brand-100 text-brand-900",
  doctor: "bg-sky-50 text-sky-800",
  technician: "bg-amber-50 text-amber-800",
  farmer: "bg-slate-100 text-slate-600",
};

/** Which account states the table is showing — maps to the API's `status`. */
const STATUS_FILTERS = [
  { key: "all", label: "All statuses" },
  { key: "active", label: "Active only" },
  { key: "deactivated", label: "Deactivated only" },
];

const EMPTY_CREATE = {
  name: "",
  email: "",
  role: "technician",
  password: "",
  password_confirmation: "",
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export default function UserManagementPage() {
  const toast = useToast();
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const debouncedSearch = useDebouncedValue(search, 300);

  // Account being edited / created, plus the field errors the server returned.
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", role: "" });
  const [editErrors, setEditErrors] = useState({});

  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE);
  const [createErrors, setCreateErrors] = useState({});

  /** Account awaiting deactivation confirmation — null when no dialog is up. */
  const [confirming, setConfirming] = useState(null);

  const [saving, setSaving] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const rows = await adminApi.listUsersPage({
        per_page: 50,
        page,
        role: roleFilter === "all" ? undefined : roleFilter,
        search: debouncedSearch || undefined,
        // `all` keeps deactivated accounts visible so they can be brought
        // back; the API's own default is `active` for the picker endpoints.
        status: statusFilter,
      });

      setUsers(rows?.data ?? []);
      setMeta(rows?.meta ?? null);
    } catch (err) {
      if (!quiet) setError(getErrorMessage(err));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [roleFilter, statusFilter, debouncedSearch, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Quietly re-fetch so accounts registered or changed elsewhere appear live.
  useAutoRefresh(load);

  const counts = useMemo(() => {
    const tally = Object.fromEntries(ROLE_KEYS.map((key) => [key, 0]));
    for (const row of users) {
      if (row.role in tally) tally[row.role] += 1;
    }
    return tally;
  }, [users]);

  /** The account being edited is the signed-in administrator's own. */
  const editingSelf = editing !== null && editing.id === currentUser?.id;

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

  async function saveEdit() {
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

      toast.success(
        roleChanged
          ? `${updated.name} saved — now ${roleLabel(updated.role)}.`
          : `${updated?.name ?? editForm.name} updated.`,
      );
    } catch (err) {
      reportFailure(err, setEditErrors);
    } finally {
      setSaving(false);
    }
  }

  async function saveCreate() {
    setSaving(true);
    setCreateErrors({});

    try {
      const created = await adminApi.createUser(createForm);

      setCreating(false);
      await load();

      toast.success(
        `${created?.name ?? createForm.name} can now sign in as ${roleLabel(created?.role ?? createForm.role)}.`,
      );
    } catch (err) {
      reportFailure(err, setCreateErrors);
    } finally {
      setSaving(false);
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
              Every account registered with the program. Self-registration
              always creates a farmer — staff accounts are created here, and
              deactivating an account keeps its records while blocking sign-in.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Icon
                name="search"
                className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-400"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search name, username or email…"
                className="field w-64 pl-9"
                aria-label="Search accounts"
              />
            </div>

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
                : "Accounts appear here as staff and farmers register."
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-700">
                {meta?.total ?? users.length} {(meta?.total ?? users.length) === 1 ? "account" : "accounts"}
              </span>
              {ROLE_KEYS.filter((key) => counts[key] > 0).map((key) => (
                <span key={key}>
                  {counts[key]} {roleLabel(key)}
                </span>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <colgroup>
                  <col className="w-[20%]" />
                  <col className="w-[13%]" />
                  <col className="w-[23%]" />
                  <col className="w-[12%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col />
                </colgroup>
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                    <th scope="col" className="px-4 py-2.5 font-semibold">Name</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Username</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Email</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Role</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Added</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((row) => {
                    const isSelf = row.id === currentUser?.id;
                    const deactivated = row.status === "deactivated";

                    return (
                      <tr
                        key={row.id}
                        className={`transition hover:bg-brand-50/40 ${deactivated ? "bg-slate-50/70" : ""}`}
                      >
                        <td className="px-4 py-2.5 font-medium whitespace-nowrap text-slate-900">
                          <span className={deactivated ? "text-slate-500" : undefined}>
                            {row.name}
                          </span>
                          {isSelf && (
                            <span className="ml-2 rounded-pill bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                              You
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                          {row.username ?? "—"}
                        </td>
                        <td className="truncate px-4 py-2.5 text-slate-600">
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
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${
                              deactivated
                                ? "bg-rose-50 text-rose-700"
                                : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`h-1.5 w-1.5 rounded-full ${
                                deactivated ? "bg-rose-500" : "bg-emerald-500"
                              }`}
                            />
                            {deactivated ? "Deactivated" : "Active"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                          {formatDate(row.created_at)}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
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
          The new staff member signs in with this email and password. Share the
          password with them directly — the system does not email it.
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
              onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })}
              autoComplete="off"
            />
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="create-password" className="block text-xs font-semibold text-slate-600">
                Password
              </label>
              <input
                id="create-password"
                type="password"
                className="field mt-1 w-full text-sm"
                value={createForm.password}
                onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })}
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
                value={createForm.password_confirmation}
                onChange={(event) =>
                  setCreateForm({ ...createForm, password_confirmation: event.target.value })
                }
                autoComplete="new-password"
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            At least 8 characters, with upper and lower case, a number and a
            symbol — the same policy registration uses.
          </p>

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
                  Creating…
                </>
              ) : (
                "Create account"
              )}
            </button>
          </div>
        </form>
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
