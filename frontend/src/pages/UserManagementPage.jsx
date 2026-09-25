import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "../api/adminApi";
import { getErrorMessage } from "../api/client";
import { Modal } from "../components/Modal";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { Icon } from "../components/Icons";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ROLE_KEYS, roleLabel } from "../config/roles";

/**
 * Admin "User Management" screen.
 *
 * Lists every account and sets its role — the elevation path, since public
 * self-registration always creates a farmer. Both endpoints already existed
 * (`GET /admin/users`, `PATCH /admin/users/{id}/role`); this is the screen that
 * was missing.
 *
 * The role filter and search box map directly onto the query parameters the
 * controller already accepts, so no client-side filtering stands in for a
 * server that can paginate.
 */

/** Badge tones per role, so the four roles are distinguishable at a glance. */
const ROLE_TONES = {
  admin: "bg-brand-100 text-brand-900",
  doctor: "bg-sky-50 text-sky-800",
  technician: "bg-amber-50 text-amber-800",
  farmer: "bg-slate-100 text-slate-600",
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const debouncedSearch = useDebouncedValue(search, 300);

  const [editing, setEditing] = useState(null); // account whose role is being set
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const rows = await adminApi.listUsers({
        per_page: 200,
        role: roleFilter === "all" ? undefined : roleFilter,
        search: debouncedSearch || undefined,
      });

      setUsers(rows ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [roleFilter, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  /** The account being edited is the signed-in administrator's own. */
  const editingSelf = editing !== null && editing.id === currentUser?.id;

  const counts = useMemo(() => {
    const tally = Object.fromEntries(ROLE_KEYS.map((key) => [key, 0]));
    for (const row of users) {
      if (row.role in tally) tally[row.role] += 1;
    }
    return tally;
  }, [users]);

  function openEditor(row) {
    setEditing(row);
    setPick(row.role);
  }

  async function saveRole() {
    if (!editing || editingSelf) return;

    setSaving(true);
    setError(null);

    try {
      const updated = await adminApi.assignRole(editing.id, pick);
      setEditing(null);
      await load();

      // Global toast — survives the list refresh.
      toast.success(
        `${updated?.name ?? editing.name} is now ${roleLabel(updated?.role ?? pick)}.`,
      );
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
              always creates a farmer — promoting an account to a staff role
              happens here.
            </p>
          </div>

          <div className="relative">
            <Icon
              name="search"
              className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-400"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, username or email…"
              className="field w-64 pl-9"
              aria-label="Search accounts"
            />
          </div>
        </div>

        {/* Role filter — mirrors the `role` query parameter the API accepts. */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setRoleFilter("all")}
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
              onClick={() => setRoleFilter(key)}
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
                {users.length} {users.length === 1 ? "account" : "accounts"}
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
                  <col className="w-[24%]" />
                  <col className="w-[16%]" />
                  <col className="w-[26%]" />
                  <col className="w-[14%]" />
                  <col className="w-[12%]" />
                  <col />
                </colgroup>
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                    <th scope="col" className="px-4 py-2.5 font-semibold">Name</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Username</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Email</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Role</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Added</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((row) => (
                    <tr key={row.id} className="transition hover:bg-brand-50/40">
                      <td className="px-4 py-2.5 font-medium whitespace-nowrap text-slate-900">
                        {row.name}
                        {row.id === currentUser?.id && (
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
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                        {formatDate(row.created_at)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => openEditor(row)}
                          className="rounded-pill px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100"
                        >
                          Change role
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <Modal
        open={editing !== null}
        title={`Change role — ${editing?.name ?? ""}`}
        onClose={() => setEditing(null)}
      >
        <label htmlFor="account-role" className="block text-sm font-medium text-slate-700">
          Role
        </label>
        <select
          id="account-role"
          className="field mt-1.5"
          value={pick}
          onChange={(event) => setPick(event.target.value)}
          disabled={editingSelf}
        >
          {ROLE_KEYS.map((key) => (
            <option key={key} value={key}>
              {roleLabel(key)}
            </option>
          ))}
        </select>

        {/* Mirrors a server-side rule, not a substitute for it: the API
            refuses a self role change (UserRoleService), so an administrator
            can never lock themselves out of the admin routes. Disabled here so
            the reason is visible instead of arriving as a 422. */}
        {editingSelf && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-800">
            This is your own account. Changing your role would remove your
            administrator access, so it is disabled here — ask another
            administrator to do it.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={saveRole}
            disabled={saving || editingSelf || pick === editing?.role}
          >
            {saving ? (
              <>
                <ButtonSpinner />
                Saving…
              </>
            ) : (
              "Save role"
            )}
          </button>
        </div>
      </Modal>
    </div>
  );
}
