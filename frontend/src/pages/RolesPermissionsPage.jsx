import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../api/adminApi";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import {
  FilterActions,
  FilterField,
  FilterToolbar,
} from "../components/FilterToolbar";
import { SearchField } from "../components/SearchField";
import { InlineAlert } from "../components/InlineAlert";
import { Modal } from "../components/Modal";
import { SkeletonList } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ROLE_KEYS, getRole, roles, roleLabel } from "../config/roles";

/**
 * Admin "Roles & Permissions" screen — role summaries over the capability
 * matrix.
 *
 * The server-side truth is the `permissions` + `role_permissions` pair: rows
 * are capabilities, columns are roles, and every cell is a live grant the
 * Policies, FormRequests and route middleware consult on each request
 * ($user->hasPermission). Edits here take effect on the next request, no
 * deploy.
 *
 * What a cell means — and what it does not:
 *   - Checking a capability lets that role DO it in principle. Row-level SCOPE
 *     (all / assigned / own) is decided separately, role by role, inside the
 *     Policies — it is the "How far each role's view reaches" table below, and
 *     it is not editable here on purpose: scope rules are the per-record
 *     contracts (an author keeps their note, a technician their trips), not
 *     switches.
 *   - Write capabilities declare the read capability they need. The server
 *     refuses a grant without its dependency and refuses to revoke a
 *     capability another grant still requires; the dialogs below offer the
 *     transaction that satisfies/removes the whole dependency set.
 *   - Unchecking the last holder of "Manage roles and permissions" is refused
 *     by the server (422) — the matrix must never be uneditable. The UI warns
 *     before that refusal happens.
 *
 * Admin-only by role OR by capability: any account holding manage_roles can
 * open this screen, even from another dashboard, so the lockout guard can
 * never be satisfied by an account that cannot reach the matrix.
 */

/** Server-side enforcement points, stated per row rather than implied. */
const RULES = [
  {
    title: "Workspace access",
    body: "Admin is an all-access role: it can open every dashboard. The technician sees only their own workspace — even by typing another dashboard's URL. A capability-gated admin tool can still be opened by any role that holds that capability.",
    enforced: "RoleRoute guard in the SPA (canAccessDashboard + user.permissions), re-checked per endpoint server-side.",
  },
  {
    title: "Beneficiaries & monitoring",
    body: "Admin and technicians see every household — the technician carries the field work and the program-wide oversight.",
    enforced: "BeneficiaryService::scopeQueryFor — applied at the query on every list and search, not after the fact.",
  },
  {
    title: "Clinical records",
    body: "The technician authors health records and case notes. Admin may correct them after a technician leaves; another technician cannot rewrite a colleague's clinical judgement. Every role can read the records.",
    enforced: "HealthRecordPolicy / CaseNotePolicy (create is technician-only; update is the author or an admin).",
  },
  {
    title: "Field visits",
    body: "Technicians log their own trips, and every staff role reviews all visits. Editing a visit stays with the technician who went, or an admin.",
    enforced: "FieldVisitPolicy + the technician check at validation time.",
  },
  {
    title: "Account management",
    body: "Only admins create staff accounts, edit an account's name, email or role, and deactivate or reactivate an account. An admin cannot change their own role or deactivate their own account, so no admin can strand the system.",
    enforced: "The manage_users capability (route middleware + each admin FormRequest) + the self-change guards in UserRoleService and UserAccountService.",
  },
  {
    title: "Reports, settings & rules",
    body: "City-wide reporting, office settings and the health-concern hint rules are gated by their own capabilities — view_reports and manage_settings — so they can be granted beyond admin from the matrix above.",
    enforced: "EnsurePermission middleware (permission:view_reports / permission:manage_settings) + the capability check in each FormRequest.",
  },
];

/** How far each role's READ scope reaches, transcribed from Policies. */
const READ_SCOPE = [
  { label: "Beneficiaries", admin: "all", technician: "all" },
  { label: "Monitoring records", admin: "all", technician: "all" },
  { label: "Health records", admin: "all", technician: "all" },
  { label: "Case notes", admin: "all", technician: "all" },
  { label: "Field visits", admin: "all", technician: "all" },
  { label: "Dispersal events", admin: "all", technician: "all" },
  { label: "Settings, reports & accounts", admin: "all" },
];

const SCOPE_LABELS = { all: "All", assigned: "Assigned", own: "Own" };
const SCOPE_TONES = {
  all: "bg-brand-50 text-brand-800",
  assigned: "bg-amber-50 text-amber-800",
  own: "bg-slate-100 text-slate-600",
};

const RISK_TONES = {
  standard: "bg-slate-100 text-slate-600",
  sensitive: "bg-amber-50 text-amber-800",
  critical: "bg-rose-50 text-rose-700",
};

function formatDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function RolesPermissionsPage({ roleKey = "admin" }) {
  const config = getRole(roleKey) ?? roles.admin;
  const toast = useToast();
  const { user, refreshUser } = useAuth();

  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingCell, setSavingCell] = useState(null);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [grantFilter, setGrantFilter] = useState("all");
  const [collapsed, setCollapsed] = useState(() => new Set());

  const [confirmLockout, setConfirmLockout] = useState(null);
  const [confirmDependency, setConfirmDependency] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const [confirmGroup, setConfirmGroup] = useState(null);
  const [groupActionRole, setGroupActionRole] = useState("admin");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setMatrix(await adminApi.getRolePermissions());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const allPermissions = useMemo(
    () => (matrix?.groups ?? []).flatMap((group) => group.permissions),
    [matrix],
  );

  const permissionByKey = useMemo(
    () => Object.fromEntries(allPermissions.map((permission) => [permission.key, permission])),
    [allPermissions],
  );

  const permissionLabel = useCallback(
    (key) => permissionByKey[key]?.label ?? key,
    [permissionByKey],
  );

  const grantedTo = useCallback(
    (role, key) => Boolean(permissionByKey[key]?.granted?.[role]),
    [permissionByKey],
  );

  const missingDependencies = useCallback(
    (role, permission) =>
      (permission.requires ?? []).filter(
        (key) => key !== permission.key && !grantedTo(role, key),
      ),
    [grantedTo],
  );

  const dependentsFor = useCallback(
    (role, key) =>
      allPermissions.filter(
        (permission) =>
          permission.key !== key &&
          permission.granted?.[role] &&
          (permission.requires ?? []).includes(key),
      ),
    [allPermissions],
  );

  async function adopt(next) {
    setMatrix(next);
    // The matrix may include the signed-in account's own role. Re-read /user
    // so the sidebar and route guards reflect the change without a reload.
    void refreshUser();
  }

  async function flip(role, permissionKey, granted, label, { withDependencies = false } = {}) {
    setSavingCell(`${role}:${permissionKey}`);
    setError(null);

    try {
      await adopt(
        await adminApi.setRolePermission(role, permissionKey, granted, {
          withDependencies,
        }),
      );
      toast.success(
        granted
          ? `${label} granted to ${roleLabel(role)}.`
          : `${label} removed from ${roleLabel(role)}.`,
      );
      return true;
    } catch (err) {
      setError(getErrorMessage(err));
      return false;
    } finally {
      setSavingCell(null);
    }
  }

  async function applyGroup(role, permissionKeys, granted, label) {
    setSavingCell(`${role}:group:${label}`);
    setError(null);

    try {
      await adopt(await adminApi.setRolePermissions(role, permissionKeys, granted));
      toast.success(
        granted
          ? `${label} granted to ${roleLabel(role)}.`
          : `${label} removed from ${roleLabel(role)}.`,
      );
      return true;
    } catch (err) {
      setError(getErrorMessage(err));
      return false;
    } finally {
      setSavingCell(null);
    }
  }

  function onToggle(role, permission, currentlyGranted) {
    const label = permission.label;

    if (!currentlyGranted) {
      const missing = missingDependencies(role, permission);

      if (missing.length > 0) {
        setConfirmDependency({
          role,
          permission,
          missing: missing.map(permissionLabel),
        });
        return;
      }

      flip(role, permission.key, true, label);
      return;
    }

    if (permission.key === "manage_roles") {
      setConfirmLockout({ role, key: permission.key, label });
      return;
    }

    const dependents = dependentsFor(role, permission.key);

    if (dependents.length > 0) {
      setConfirmRevoke({ role, permission, dependents });
      return;
    }

    flip(role, permission.key, false, label);
  }

  function requestGroup(group, granted, role) {
    const permissions = group.allPermissions ?? group.permissions;
    setConfirmGroup({ group, permissions, granted, role });
  }

  const saving = savingCell !== null;

  const groups = useMemo(() => matrix?.groups ?? [], [matrix]);
  const totalPermissions = matrix?.total_permissions ?? allPermissions.length;
  const canManageUsers = (user?.permissions ?? []).includes("manage_users");
  const canViewAudit = (user?.permissions ?? []).includes("view_activity_logs");
  const lastChange = formatDateTime(matrix?.last_change?.at);

  const roleKeys = useMemo(
    () => (matrix?.roles ?? ROLE_KEYS.map((key) => ({ key }))).map((role) => role.key),
    [matrix],
  );

  const filteredGroups = useMemo(() => {
    const term = search.trim().toLowerCase();

    return groups
      .map((group) => {
        if (groupFilter !== "all" && group.group !== groupFilter) return null;

        const permissions = group.permissions.filter((permission) => {
          if (term !== "") {
            const haystack =
              `${permission.label} ${permission.key} ${permission.description ?? ""} ${group.group}`.toLowerCase();

            if (!haystack.includes(term)) return false;
          }

          const grants = roleKeys.map((key) => Boolean(permission.granted?.[key]));

          if (grantFilter === "granted") return grants.some(Boolean);
          if (grantFilter === "missing") return grants.some((granted) => !granted);
          if (grantFilter === "different") return new Set(grants).size > 1;

          return true;
        });

        return permissions.length > 0
          ? { ...group, allPermissions: group.permissions, permissions }
          : null;
      })
      .filter(Boolean);
  }, [groups, groupFilter, grantFilter, roleKeys, search]);

  const shownCount = filteredGroups.reduce(
    (total, group) => total + group.permissions.length,
    0,
  );

  function toggleGroup(group) {
    setCollapsed((current) => {
      const next = new Set(current);

      if (next.has(group)) next.delete(group);
      else next.add(group);

      return next;
    });
  }

  return (
    <div className="space-y-6">
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{config.label}</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Roles &amp; Permissions
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              What each role can do, as a live capability matrix. Every checkbox
              is a grant the server checks on each request — a change takes
              effect immediately, no redeploy. Row-level scope (whose records a
              role reaches) is shown further down and stays fixed per role.
            </p>
          </div>

          {lastChange && (
            <div className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-[11px] text-slate-500">
              <p className="font-semibold tracking-wide text-slate-400 uppercase">
                Last matrix change
              </p>
              <p className="mt-1 font-medium text-slate-700">
                {lastChange}
                {matrix?.last_change?.actor_name
                  ? ` · ${matrix.last_change.actor_name}`
                  : ""}
              </p>
              {canViewAudit && (
                <Link
                  to="/dashboard/admin/audit?action=permissions_updated"
                  className="mt-1 inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-brand-900"
                >
                  Open in Audit Trail
                  <Icon name="arrow-right" className="h-3 w-3" />
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}

      {loading ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="card p-5"><SkeletonList rows={2} rowClassName="h-8" /></div>
            <div className="card p-5"><SkeletonList rows={2} rowClassName="h-8" /></div>
          </section>
          <section className="card overflow-hidden">
            <SkeletonList rows={6} rowClassName="h-12" />
          </section>
        </>
      ) : !matrix ? (
        <section className="card">
          <EmptyState
            title="Matrix unavailable"
            description="The capability matrix could not be loaded. Check the connection and try again."
          />
        </section>
      ) : (
        <>
          {/* Roles at a glance */}
          <section className="grid gap-3 sm:grid-cols-2">
            {matrix.roles.map((role) => (
              <article key={role.key} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-base font-bold text-slate-900">
                        {role.label}
                      </h3>
                      {role.manages_roles && (
                        <span className="rounded-pill bg-brand-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-brand-800 uppercase">
                          Manages access
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-600">
                      {role.description}
                    </p>
                  </div>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                    <Icon
                      name={getRole(role.key)?.icon ?? "shield"}
                      className="h-4 w-4"
                    />
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-slate-200 px-3 py-2">
                    <dt className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
                      Active
                    </dt>
                    <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                      {role.active_users}
                    </dd>
                  </div>
                  <div className="rounded-xl border border-slate-200 px-3 py-2">
                    <dt className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
                      Deactivated
                    </dt>
                    <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                      {role.deactivated_users}
                    </dd>
                  </div>
                  <div className="rounded-xl border border-slate-200 px-3 py-2">
                    <dt className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
                      Capabilities
                    </dt>
                    <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                      {role.granted_count}
                      <span className="text-xs font-medium text-slate-400">
                        /{role.total_permissions ?? totalPermissions}
                      </span>
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500">
                    Dashboard: {role.dashboard}
                  </span>
                  {canManageUsers && (
                    <Link
                      to={`/dashboard/admin/users?role=${role.key}`}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:text-brand-900"
                    >
                      Manage members
                      <Icon name="arrow-right" className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </section>

          {/* One sticky, filterable matrix */}
          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
              <FilterToolbar
                search={
                  <SearchField
                    id="capability-search"
                    value={search}
                    onChange={setSearch}
                    label={null}
                    placeholder="Search by name, key or description…"
                    ariaLabel="Search capabilities"
                  />
                }
                actions={
                  <FilterActions className="justify-start">
                    <span className="text-[11px] text-slate-500">
                      {shownCount} of {totalPermissions} capabilities
                    </span>

                    {(search || groupFilter !== "all" || grantFilter !== "all") && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearch("");
                          setGroupFilter("all");
                          setGrantFilter("all");
                        }}
                        className="filter-reset"
                      >
                        <Icon name="close" className="h-3.5 w-3.5" />
                        Clear
                      </button>
                    )}
                  </FilterActions>
                }
                activeFilters={[
                  groupFilter !== "all"
                    ? {
                        key: "group",
                        label: `Group: ${groupFilter}`,
                        onClear: () => setGroupFilter("all"),
                      }
                    : null,
                  grantFilter !== "all"
                    ? {
                        key: "grant",
                        label: `Grant: ${grantFilter}`,
                        onClear: () => setGrantFilter("all"),
                      }
                    : null,
                ].filter(Boolean)}
                onClearAll={() => {
                  setSearch("");
                  setGroupFilter("all");
                  setGrantFilter("all");
                }}
                onReset={() => {
                  setSearch("");
                  setGroupFilter("all");
                  setGrantFilter("all");
                }}
              >
                <FilterField label="Permission group" htmlFor="capability-group">
                  <select
                    id="capability-group"
                    className="field"
                    value={groupFilter}
                    onChange={(event) => setGroupFilter(event.target.value)}
                    aria-label="Filter by permission group"
                  >
                    <option value="all">All groups</option>
                    {groups.map((group) => (
                      <option key={group.group} value={group.group}>
                        {group.group}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label="Grant state" htmlFor="capability-grant">
                  <select
                    id="capability-grant"
                    className="field"
                    value={grantFilter}
                    onChange={(event) => setGrantFilter(event.target.value)}
                    aria-label="Filter by grant state"
                  >
                    <option value="all">All grants</option>
                    <option value="granted">Granted somewhere</option>
                    <option value="missing">Missing somewhere</option>
                    <option value="different">Role differences</option>
                  </select>
                </FilterField>

              </FilterToolbar>
            </div>

            {filteredGroups.length === 0 ? (
              <EmptyState
                title="No capabilities match"
                description="Try a different word, group or grant state."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="sticky top-0 z-20 bg-white">
                    <tr className="border-b border-slate-100 text-left text-[11px] tracking-wide text-slate-500 uppercase">
                      <th className="sticky left-0 z-30 w-[52%] bg-white px-4 py-2.5 font-semibold">
                        Capability
                      </th>
                      {matrix.roles.map((role) => (
                        <th
                          key={role.key}
                          className="px-4 py-2.5 text-center font-semibold"
                        >
                          <span className="block">{role.label}</span>
                          <span className="mt-0.5 block text-[10px] font-medium normal-case text-slate-400">
                            {role.granted_count}/{role.total_permissions ?? totalPermissions} granted
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredGroups.map((group) => {
                      const isCollapsed = collapsed.has(group.group);
                      const fullGroup = group.allPermissions ?? group.permissions;

                      return (
                        <Fragment key={group.group}>
                          <tr className="bg-slate-50/80">
                            <th
                              colSpan={matrix.roles.length + 1}
                              scope="colgroup"
                              className="px-4 py-2.5"
                            >
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(group.group)}
                                  aria-expanded={!isCollapsed}
                                  className="inline-flex items-center gap-1.5 font-display text-xs font-semibold tracking-wide text-slate-700 uppercase hover:text-brand-800"
                                >
                                  <Icon
                                    name="chevron-down"
                                    className={`h-3.5 w-3.5 transition-transform ${
                                      isCollapsed ? "-rotate-90" : ""
                                    }`}
                                  />
                                  {group.group}
                                </button>

                                <span className="text-[10px] font-medium text-slate-400">
                                  {fullGroup[0]?.granted
                                    ? matrix.roles
                                        .map(
                                          (role) =>
                                            `${role.short_label ?? role.label} ${fullGroup.filter((permission) => permission.granted?.[role.key]).length}/${fullGroup.length}`,
                                        )
                                        .join(" · ")
                                    : `${fullGroup.length} capabilities`}
                                </span>

                                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                                  <select
                                    value={groupActionRole}
                                    onChange={(event) => setGroupActionRole(event.target.value)}
                                    aria-label={`Role for ${group.group} group actions`}
                                    className="rounded-pill border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600"
                                  >
                                    {matrix.roles.map((role) => (
                                      <option key={role.key} value={role.key}>
                                        {role.short_label ?? role.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => requestGroup(group, true, groupActionRole)}
                                    className="rounded-pill border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-brand-50 hover:text-brand-800 disabled:opacity-50"
                                  >
                                    Grant all
                                  </button>
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => requestGroup(group, false, groupActionRole)}
                                    className="rounded-pill border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                                  >
                                    Clear
                                  </button>
                                </div>
                              </div>
                            </th>
                          </tr>

                          {!isCollapsed &&
                            group.permissions.map((permission) => (
                              <tr key={permission.key} className="group transition hover:bg-brand-50/30">
                                <td className="sticky left-0 z-10 bg-white px-4 py-3 align-top group-hover:bg-brand-50/30">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium text-slate-900">
                                      {permission.label}
                                    </span>
                                    {permission.risk && permission.risk !== "standard" && (
                                      <span
                                        className={`rounded-pill px-2 py-0.5 text-[9px] font-bold tracking-wide uppercase ${
                                          RISK_TONES[permission.risk] ?? RISK_TONES.standard
                                        }`}
                                      >
                                        {permission.risk}
                                      </span>
                                    )}
                                  </div>

                                  {permission.description && (
                                    <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-slate-500">
                                      {permission.description}
                                    </p>
                                  )}

                                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <code className="text-[10px] text-slate-400">
                                      {permission.key}
                                    </code>
                                    {(permission.requires ?? []).length > 0 && (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-800">
                                        <Icon name="lock" className="h-3 w-3" />
                                        Needs {permission.requires.map(permissionLabel).join(", ")}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {matrix.roles.map((role) => {
                                  const granted = Boolean(permission.granted?.[role.key]);
                                  const busy = savingCell === `${role.key}:${permission.key}`;

                                  return (
                                    <td key={role.key} className="px-4 py-3 text-center align-top">
                                      <input
                                        type="checkbox"
                                        aria-label={`${permission.label} for ${role.label}`}
                                        checked={granted}
                                        disabled={busy || savingCell?.startsWith(`${role.key}:group:`)}
                                        onChange={() => onToggle(role.key, permission, granted)}
                                        className="h-4 w-4 accent-brand-700"
                                      />
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
              Changes save immediately and are audited. Write capabilities
              require their read capability; group actions apply in one
              transaction.
            </p>
          </section>

          {/* Read scope — still role-driven, by design */}
          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
              <h3 className="font-display text-xs font-semibold tracking-wide text-slate-700 uppercase">
                How far each role&apos;s view reaches
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <colgroup>
                  <col className="w-[30%]" />
                  {ROLE_KEYS.map((key) => (
                    <col key={key} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] tracking-wide text-slate-500 uppercase">
                    <th className="px-4 py-2.5 font-semibold">Record type</th>
                    {ROLE_KEYS.map((key) => (
                      <th key={key} className="px-4 py-2.5 text-center font-semibold">
                        {roles[key].shortLabel}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {READ_SCOPE.map((row) => (
                    <tr key={row.label} className="transition hover:bg-brand-50/40">
                      <td className="px-4 py-3 font-semibold text-slate-900">{row.label}</td>
                      {ROLE_KEYS.map((key) =>
                        row[key] ? (
                          <td key={key} className="px-4 py-3 text-center">
                            <span
                              className={`inline-block rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${
                                SCOPE_TONES[row[key]]
                              }`}
                            >
                              {SCOPE_LABELS[row[key]]}
                            </span>
                          </td>
                        ) : (
                          <td key={key} className="px-4 py-3 text-center text-slate-300">
                            —
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
              <span>
                <span className="font-semibold text-slate-700">All</span> — every
                row city-wide.
              </span>
              <span>
                <span className="font-semibold text-slate-700">Assigned</span> —
                rows for households assigned to that technician.
              </span>
              <span>
                <span className="font-semibold text-slate-700">Own</span> — rows
                the role owns: their own animals, or their own logged trips.
              </span>
            </div>

            <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
              Scope is decided inside the Policies per record type — granting a
              capability above never widens whose rows it reaches. A technician
              granted a clinical capability, for example, would still only ever
              see the households assigned to them.
            </p>
          </section>

          {/* The rules and where they live */}
          <section className="card p-5 sm:p-6">
            <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
              Rules and where they are enforced
            </h3>
            <ul className="mt-4 space-y-3">
              {RULES.map((rule) => (
                <li key={rule.title} className="rounded-xl border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-900">{rule.title}</p>
                  <p className="mt-1 text-xs text-slate-600">{rule.body}</p>
                  <p className="mt-2 inline-flex items-start gap-1.5 rounded-xl bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">
                    <Icon name="shield" className="mt-0.5 h-3 w-3 shrink-0" />
                    {rule.enforced}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {/* Removal of manage_roles */}
      <Modal
        open={confirmLockout !== null}
        title="Remove roles management?"
        onClose={() => setConfirmLockout(null)}
        contentClassName="max-w-md"
      >
        {confirmLockout && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              You are about to remove{" "}
              <span className="font-semibold text-slate-900">Manage roles and permissions</span>{" "}
              from{" "}
              <span className="font-semibold text-slate-900">
                {roleLabel(confirmLockout.role)}
              </span>
              . Whoever loses this capability can no longer edit this matrix.
            </p>
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800">
              If no other role with active accounts holds it afterwards, the
              server will refuse the change — the system can never be left
              without someone able to manage permissions.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmLockout(null)}
                className="btn-secondary rounded-pill px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  const { role, key, label } = confirmLockout;
                  setConfirmLockout(null);
                  await flip(role, key, false, label);
                }}
                className="rounded-pill bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                Remove capability
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Grant needs a read dependency */}
      <Modal
        open={confirmDependency !== null}
        title="Grant required permissions?"
        onClose={() => setConfirmDependency(null)}
        contentClassName="max-w-md"
      >
        {confirmDependency && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">
                {confirmDependency.permission.label}
              </span>{" "}
              depends on the following capability for{" "}
              <span className="font-semibold text-slate-900">
                {roleLabel(confirmDependency.role)}
              </span>
              :
            </p>
            <ul className="space-y-1 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-700">
              {confirmDependency.missing.map((label) => (
                <li key={label}>• {label}</li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">
              The server applies the whole set in one transaction and audits
              each changed grant.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDependency(null)}
                className="btn-secondary rounded-pill px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  const { role, permission } = confirmDependency;
                  setConfirmDependency(null);
                  await flip(role, permission.key, true, permission.label, {
                    withDependencies: true,
                  });
                }}
                className="rounded-pill bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
              >
                Grant required permissions
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Revoke needs to take dependents too */}
      <Modal
        open={confirmRevoke !== null}
        title="Revoke dependent permissions too?"
        onClose={() => setConfirmRevoke(null)}
        contentClassName="max-w-md"
      >
        {confirmRevoke && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Other granted capabilities for{" "}
              <span className="font-semibold text-slate-900">
                {roleLabel(confirmRevoke.role)}
              </span>{" "}
              still require{" "}
              <span className="font-semibold text-slate-900">
                {confirmRevoke.permission.label}
              </span>
              :
            </p>
            <ul className="space-y-1 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
              {confirmRevoke.dependents.map((permission) => (
                <li key={permission.key}>• {permission.label}</li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">
              They will be revoked together so the role never keeps a write
              permission without its read capability.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRevoke(null)}
                className="btn-secondary rounded-pill px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  const { role, permission, dependents } = confirmRevoke;
                  setConfirmRevoke(null);
                  await applyGroup(
                    role,
                    [permission.key, ...dependents.map((dependent) => dependent.key)],
                    false,
                    `${permission.label} and ${dependents.length} dependent ${
                      dependents.length === 1 ? "capability" : "capabilities"
                    }`,
                  );
                }}
                className="rounded-pill bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                Revoke all
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Group grant/revoke */}
      <Modal
        open={confirmGroup !== null}
        title={confirmGroup?.granted ? "Grant this whole group?" : "Clear this whole group?"}
        onClose={() => setConfirmGroup(null)}
        contentClassName="max-w-md"
      >
        {confirmGroup && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              {confirmGroup.granted ? "Grant" : "Remove"}{" "}
              <span className="font-semibold text-slate-900">
                {confirmGroup.permissions.length}{" "}
                {confirmGroup.permissions.length === 1 ? "capability" : "capabilities"}
              </span>{" "}
              in{" "}
              <span className="font-semibold text-slate-900">
                {confirmGroup.group.group}
              </span>{" "}
              {confirmGroup.granted ? "to" : "from"}{" "}
              <span className="font-semibold text-slate-900">
                {roleLabel(confirmGroup.role)}
              </span>
              ?
            </p>
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
              {confirmGroup.granted
                ? "Required read capabilities outside this group will be granted automatically in the same transaction."
                : "Revocation is refused if another granted capability still requires one of these permissions."}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmGroup(null)}
                className="btn-secondary rounded-pill px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  const { group, permissions, granted } = confirmGroup;
                  setConfirmGroup(null);
                  await applyGroup(
                    confirmGroup.role,
                    permissions.map((permission) => permission.key),
                    granted,
                    `${group.group} group`,
                  );
                }}
                className={`rounded-pill px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                  confirmGroup.granted
                    ? "bg-brand-700 hover:bg-brand-800"
                    : "bg-rose-600 hover:bg-rose-700"
                }`}
              >
                {confirmGroup.granted ? "Grant group" : "Clear group"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
