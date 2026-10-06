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
 * Policy, and a migration of the existing role logic. That trade-off was put
 * to the product owner and decided against for this stage, so this page
 * documents the rules honestly instead of pretending to own them: which
 * modules each role sees, what each role may create, and how far each role's
 * read scope reaches — each row stating where the rule is actually enforced
 * (server-side, never just a hidden button).
 *
 * Two things keep it from drifting:
 *   - the per-role module table is generated from `roles.js`, the same config
 *     the sidebar renders, and
 *   - the tables below are transcribed from the Policies themselves; when a
 *     Policy changes, the corresponding row here has to change with it.
 *
 * Admin-only: reached only through the admin dashboard route guard
 * (`RoleRoute dashboard="admin"`), and admin is the only role with all-access
 * workspace switching.
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
    enforced: "EnsureUserIsAdmin middleware + authorize() on each admin FormRequest + the self-change guards in UserRoleService and UserAccountService.",
  },
  {
    title: "Reports, settings & rules",
    body: "City-wide reporting, office settings and the health-concern hint rules are admin-only surfaces.",
    enforced: "EnsureUserIsAdmin middleware + the admin check in each FormRequest.",
  },
];

/**
 * Who may CREATE each record type — transcribed from the Policies' create()
 * methods. Editing is narrower than creating (see the rules above), so this
 * table deliberately answers one question rather than blurring two.
 */
const WRITE_SURFACES = [
  { label: "Beneficiaries", roles: ["admin", "technician", "farmer"] },
  { label: "Monitoring records", roles: ["technician"] },
  { label: "Health records", roles: ["doctor"] },
  { label: "Case notes", roles: ["doctor"] },
  { label: "Field visits", roles: ["technician"] },
  { label: "Dispersal events", roles: ["admin", "technician", "farmer"] },
  { label: "Staff accounts", roles: ["admin"] },
  { label: "System settings", roles: ["admin"] },
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

      {/* Create permissions */}
      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
          <h3 className="font-display text-xs font-semibold tracking-wide text-slate-700 uppercase">
            Who can create each record
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

        <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
          Creating a record is not the same as editing it. Editing is narrower:
          the author keeps control of their own record, and an administrator can
          step in once they have left — so a vet cannot rewrite a colleague's
          clinical judgement, but an admin can correct it.
        </p>
      </section>

      {/* Read scope */}
      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
          <h3 className="font-display text-xs font-semibold tracking-wide text-slate-700 uppercase">
            How far each role's view reaches
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
            <span className="font-semibold text-slate-700">All</span> — every row
            city-wide.
          </span>
          <span>
            <span className="font-semibold text-slate-700">Assigned</span> — rows
            for households assigned to that technician.
          </span>
          <span>
            <span className="font-semibold text-slate-700">Own</span> — rows the
            role owns: their own animals, or their own logged trips.
          </span>
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
          description="Authorization in this system is four fixed roles enforced in Policies, Form Requests and route middleware. Per-permission control would need a permissions table, checks in every policy, and a migration of the existing role logic — a trade-off deliberately declined for this stage, not an oversight. Role membership itself is managed under User Management, where accounts can be created, edited, deactivated and brought back."
        />
      </section>
    </div>
  );
}
