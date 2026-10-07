import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../api/adminApi";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { InlineAlert } from "../components/InlineAlert";
import { Modal } from "../components/Modal";
import { SkeletonList } from "../components/Skeleton";
import { useToast } from "../context/ToastContext";
import { ROLE_KEYS, getRole, roles, roleLabel } from "../config/roles";

/**
 * Admin "Roles & Permissions" screen — the editor over the capability matrix.
 *
 * The server-side truth is the `permissions` + `role_permissions` pair: rows
 * are capabilities, columns are roles, and every cell is a live grant the
 * Policies, FormRequests and route middleware consult on each request
 * ($user->hasPermission). The seed was the de facto permission set, so
 * day-one behaviour matched the pre-matrix role checks exactly; edits here
 * take effect on the next request, no deploy.
 *
 * What a cell means — and what it does not:
 *   - Checking a capability lets that role DO it in principle. Row-level SCOPE
 *     (all / assigned / own) is decided separately, role by role, inside the
 *     Policies — it is the "How far each role's view reaches" table below, and
 *     it is not editable here on purpose: scope rules are the per-record
 *     contracts (an author keeps their note, a technician their trips), not
 *     switches.
 *   - Unchecking the last holder of "Manage roles and permissions" is refused
 *     by the server (422) — the matrix must never be uneditable. The UI warns
 *     before that refusal happens.
 *
 * Admin-only: reached only through the admin dashboard route guard
 * (`RoleRoute dashboard="admin"`), and additionally gated by the manage_roles
 * capability itself — if that grant is ever moved off the admin role, a role
 * without it sees this page refuse, not silently read-only.
 */

/** Server-side enforcement points, stated per row rather than implied. */
const RULES = [
  {
    title: "Workspace access",
    body: "Admin is an all-access role: it can open every dashboard. The other three roles see only their own workspace — even by typing another dashboard's URL.",
    enforced: "RoleRoute guard in the SPA (canAccessDashboard), re-checked per endpoint server-side.",
  },
  {
    title: "Beneficiaries & monitoring",
    body: "Admin and doctors see every household. Technicians see only households assigned to them. Farmers see only their own.",
    enforced: "BeneficiaryService::scopeQueryFor — applied at the query on every list and search, not after the fact.",
  },
  {
    title: "Clinical records",
    body: "Doctors author health records and case notes. Admin may correct them after a vet leaves; another vet cannot rewrite a colleague's clinical judgement. Every role can read the records for animals it can already see.",
    enforced: "HealthRecordPolicy / CaseNotePolicy (create is doctor-only; update is the author or an admin).",
  },
  {
    title: "Field visits",
    body: "Technicians log their own trips. Admin and doctors review all visits. Scoping is by the visiting technician, not by assigned household — a visit is the technician's own activity record.",
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

/**
 * How far each role's READ scope reaches, transcribed from the Policies'
 * view() methods. Values are the shorthand the legend below defines.
 */
const READ_SCOPE = [
  { label: "Beneficiaries", admin: "all", doctor: "all", technician: "assigned", farmer: "own" },
  { label: "Monitoring records", admin: "all", doctor: "all", technician: "assigned", farmer: "own" },
  { label: "Health records", admin: "all", doctor: "all", technician: "assigned", farmer: "own" },
  { label: "Case notes", admin: "all", doctor: "all", technician: "assigned", farmer: "own" },
  { label: "Field visits", admin: "all", doctor: "all", technician: "own", farmer: "own" },
  { label: "Dispersal events", admin: "all", doctor: "all", technician: "assigned", farmer: "own" },
  { label: "Accounts, settings & reports", admin: "all" },
];

/** Read-scope shorthand → the word shown in the table. */
const SCOPE_LABELS = {
  all: "All",
  assigned: "Assigned",
  own: "Own",
};

/** Shorthand → the colours the cell is tinted with. */
const SCOPE_TONES = {
  all: "bg-brand-50 text-brand-800",
  assigned: "bg-amber-50 text-amber-800",
  own: "bg-slate-100 text-slate-600",
};

export default function RolesPermissionsPage({ roleKey = "admin" }) {
  const config = getRole(roleKey) ?? roles.admin;
  const toast = useToast();

  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // The cell in flight, `${role}:${permissionKey}` — so only that checkbox
  // waits and the rest of the matrix stays interactive.
  const [savingCell, setSavingCell] = useState(null);
  // Pending uncheck of a manage_roles grant that needs confirmation.
  const [confirmLockout, setConfirmLockout] = useState(null); // {role, key, label}

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

  /**
   * Flip one cell. Returns true when the server accepted it.
   */
  async function flip(role, permissionKey, granted, label) {
    setSavingCell(`${role}:${permissionKey}`);
    setError(null);

    try {
      setMatrix(await adminApi.setRolePermission(role, permissionKey, granted));
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

  /** A checkbox changed — guard the lockout-prone one, else act at once. */
  function onToggle(role, permissionKey, label, currentlyGranted) {
    if (currentlyGranted && permissionKey === "manage_roles") {
      // Removing manage_roles is the one edit that can strand the system.
      // The server refuses when no active account would hold it afterwards;
      // warn first so the refusal is expected, not surprising.
      setConfirmLockout({ role, key: permissionKey, label });
      return;
    }

    flip(role, permissionKey, !currentlyGranted, label);
  }

  const saving = savingCell !== null;

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{config.label}</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Roles &amp; Permissions
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              What each role can do, as a live capability matrix. Every checkbox
              is a grant the server checks on each request — a change takes
              effect immediately, no redeploy. Row-level scope (whose records a
              role reaches) is shown further down and stays fixed per role.
            </p>
          </div>
        </div>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}

      {loading ? (
        <section className="card overflow-hidden">
          <SkeletonList rows={6} rowClassName="h-12" />
        </section>
      ) : !matrix ? (
        <section className="card">
          <EmptyState
            title="Matrix unavailable"
            description="The capability matrix could not be loaded. Check the connection and try again."
          />
        </section>
      ) : (
        <>
          {/* The editable capability matrix */}
          {matrix.groups.map((group) => (
            <section key={group.group} className="card overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                <h3 className="font-display text-xs font-semibold tracking-wide text-slate-700 uppercase">
                  {group.group}
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <colgroup>
                    <col className="w-[40%]" />
                    {matrix.roles.map((role) => (
                      <col key={role.key} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] tracking-wide text-slate-500 uppercase">
                      <th className="px-4 py-2.5 font-semibold">Capability</th>
                      {matrix.roles.map((role) => (
                        <th key={role.key} className="px-4 py-2.5 text-center font-semibold">
                          {role.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {group.permissions.map((permission) => (
                      <tr key={permission.key} className="transition hover:bg-brand-50/40">
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {permission.label}
                        </td>
                        {matrix.roles.map((role) => {
                          const granted = permission.granted[role.key] ?? false;
                          const busy = savingCell === `${role.key}:${permission.key}`;

                          return (
                            <td key={role.key} className="px-4 py-2.5 text-center">
                              <input
                                type="checkbox"
                                aria-label={`${permission.label} for ${role.label}`}
                                checked={granted}
                                disabled={busy}
                                onChange={() =>
                                  onToggle(role.key, permission.key, permission.label, granted)
                                }
                                className="h-4 w-4 accent-brand-700"
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <p className="text-xs text-slate-500">
            Saving a checkbox updates the role_permissions table immediately —
            the feedback you see is the server's answer, not an optimistic
            guess. The system refuses the last removal of{" "}
            <span className="font-semibold text-slate-700">
              Manage roles and permissions
            </span>{" "}
            so the matrix can never become uneditable.
          </p>

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
          <section className="card p-6">
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

      {/* Lockout confirmation for removing manage_roles */}
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
    </div>
  );
}
