import { useMemo } from "react";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { ROLE_KEYS, getRole, roles, roleLabel } from "../config/roles";

/**
 * Admin "Roles & Permissions" screen — a read-only matrix over the role
 * system that exists, not a permission editor.
 *
 * The backend has no per-permission infrastructure: authorization is four
 * fixed roles checked in Policies, FormRequests and route middleware. A real
 * per-permission editor would need a permissions table, checks in every
 * Policy, and a migration of the existing role logic — a decision flagged to
 * the product owner, not smuggled in as a screen. So this page documents the
 * matrix honestly: who gets which dashboard, which modules each role sees,
 * and where each rule is actually enforced (server-side, never just hidden).
 *
 * Its one editorial job: routes nav entries to their pages, so the matrix is
 * generated from the same `roles.js` the sidebar renders and cannot drift
 * from what the app actually shows.
 */

/** Server-side enforcement points, stated per row rather than implied. */
const RULES = [
  {
    title: "Workspace access",
    body: "Admin is an all-access role: it can open every dashboard. The other three roles see only their own workspace.",
    enforced: "RoleRoute guard in the SPA, re-checked per endpoint server-side.",
  },
  {
    title: "Beneficiaries & monitoring",
    body: "Admin and doctors see all households. Technicians see only households assigned to them. Farmers see only their own.",
    enforced: "BeneficiaryService::scopeQueryFor — applied at the query on every list and search.",
  },
  {
    title: "Clinical records",
    body: "Doctors author health records and case notes. Every role can read the records for animals it can already see.",
    enforced: "HealthRecordPolicy / CaseNotePolicy + role check in the FormRequest.",
  },
  {
    title: "Field visits",
    body: "Technicians log visits to their assigned households; admin and doctors review all visits.",
    enforced: "FieldVisitPolicy + assignment check at validation time.",
  },
  {
    title: "Role assignment",
    body: "Only admins change account roles — and an admin cannot change their own role, so no admin can strand the system.",
    enforced: "EnsureUserIsAdmin middleware + UserRoleService self-change guard.",
  },
  {
    title: "Program reports & settings",
    body: "City-wide reporting and system settings are admin-only surfaces.",
    enforced: "EnsureUserIsAdmin middleware + admin check in the FormRequest.",
  },
];

/** Who authored what — the write surface of each record type. */
const WRITE_SURFACES = [
  { label: "Beneficiaries", roles: ["admin", "doctor", "technician", "farmer"] },
  { label: "Monitoring visits", roles: ["technician"] },
  { label: "Health records", roles: ["doctor"] },
  { label: "Case notes", roles: ["doctor"] },
  { label: "Field visits", roles: ["technician"] },
  { label: "Dispersal events", roles: ["admin", "doctor", "technician"] },
  { label: "Account roles", roles: ["admin"] },
  { label: "System settings", roles: ["admin"] },
];

export default function RolesPermissionsPage({ roleKey = "admin" }) {
  const config = getRole(roleKey) ?? roles.admin;

  /** Modules per role, straight from the nav config the sidebar renders. */
  const moduleMatrix = useMemo(
    () =>
      ROLE_KEYS.map((key) => ({
        role: key,
        modules: roles[key].nav.map((item) => item.label),
      })),
    [],
  );

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
              What each role can see and do. This is a map of the rules the
              server enforces — not an editor. Every rule below is checked
              server-side on each request; the SPA only mirrors them.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
            <Icon name="lock" className="h-3 w-3" />
            Read-only
          </span>
        </div>
      </section>

      {/* Module matrix — generated from roles.js, so it cannot drift */}
      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
          <h3 className="font-display text-xs font-semibold tracking-wide text-slate-700 uppercase">
            Modules per role
          </h3>
        </div>

        <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-4">
          {moduleMatrix.map(({ role, modules }) => (
            <div key={role} className="bg-white p-4">
              <p className="inline-flex items-center gap-1.5 rounded-pill bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-800">
                <Icon name={roles[role].icon} className="h-3.5 w-3.5" />
                {roleLabel(role)}
              </p>
              <ul className="mt-3 space-y-1">
                {modules.map((label) => (
                  <li key={label} className="flex items-start gap-1.5 text-xs text-slate-600">
                    <Icon name="check" className="mt-0.5 h-3 w-3 shrink-0 text-brand-600" />
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Write surfaces */}
      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
          <h3 className="font-display text-xs font-semibold tracking-wide text-slate-700 uppercase">
            Who can record what
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
              {WRITE_SURFACES.map((surface) => (
                <tr key={surface.label} className="transition hover:bg-brand-50/40">
                  <td className="px-4 py-3 font-semibold text-slate-900">{surface.label}</td>
                  {ROLE_KEYS.map((key) => (
                    <td key={key} className="px-4 py-3 text-center">
                      {surface.roles.includes(key) ? (
                        <Icon
                          name="check"
                          className="mx-auto h-4 w-4 text-brand-600"
                        />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

      <section className="card">
        <EmptyState
          title="Why this page does not offer editing"
          description="Authorization in this system is four fixed roles enforced in Policies, Form Requests and route middleware. Per-permission control would need a permissions table, checks in every policy, and a migration of existing role logic — a deliberate architecture decision, not a settings toggle. Role membership itself is managed under User Management."
        />
      </section>
    </div>
  );
}
