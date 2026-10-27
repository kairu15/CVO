/**
 * Role definitions — the single place that decides what each role sees.
 *
 * Keys must match `App\Models\User::ROLES` on the Laravel side; the role
 * returned by `GET /api/v1/user` is used directly to look up an entry here.
 *
 * The sidebar is GROUPED: `nav` is a list of `{ group, items }` bands, where
 * `group: null` renders without a header (Overview leads, Notifications close
 * every sidebar). Groups are LABELS, not permissions — the items themselves
 * are unchanged per role. Give an item a `to` value once its route exists and
 * the sidebar will start linking to it; items without one still render with a
 * "Soon" tag.
 *
 * There is deliberately no `farmer` role: beneficiaries are program records the
 * administrator maintains (see the Beneficiaries screen), never login accounts.
 */

export const ROLE_KEYS = ["admin", "doctor", "technician"];

/**
 * Roles an administrator creates — mirrors `User::STAFF_ROLES` on the server.
 *
 * Every account in the system is one of these three; there is no
 * self-registration path, and the admin "create account" form offers exactly
 * this list.
 */
export const STAFF_ROLE_KEYS = ["admin", "doctor", "technician"];

/**
 * Roles allowed into *every* dashboard, not just their own.
 *
 * The CVO administrator oversees all three workspaces, so it is the "all
 * access" account — a single login can review the vet and field views without
 * signing in and out. This is what makes admin@example.com an all access
 * account after seeding.
 *
 * NOTE: this only guards routing in the SPA. The same rules are enforced
 * server-side per endpoint (the role_permissions matrix + Policies) — a
 * client-side check is not authorization.
 */
export const ALL_ACCESS_ROLES = ["admin"];

export const roles = {
  admin: {
    key: "admin",
    label: "Administrator",
    shortLabel: "Admin",
    dashboardLabel: "Admin Dashboard",
    path: "/dashboard/admin",
    blurb: "Owns accounts, permissions and city-wide program reporting.",
    icon: "shield",
    nav: [
      { group: null, items: [{ label: "Overview", icon: "grid", to: "/dashboard/admin" }] },
      {
        group: "Monitoring",
        items: [
          { label: "Monitoring Records", icon: "clipboard-check", to: "/dashboard/admin/monitoring" },
          { label: "Beneficiaries", icon: "clipboard", to: "/dashboard/admin/beneficiaries" },
          { label: "Field Visits", icon: "route", to: "/dashboard/admin/field-visits" },
          { label: "Technicians", icon: "map-pin", to: "/dashboard/admin/technicians" },
        ],
      },
      {
        group: "Program",
        items: [{ label: "Dispersal Map", icon: "map", to: "/dashboard/admin/map" }],
      },
      {
        group: "Administration",
        items: [
          { label: "User Management", icon: "users", to: "/dashboard/admin/users" },
          { label: "Roles & Permissions", icon: "shield", to: "/dashboard/admin/roles" },
          { label: "Audit Trail", icon: "activity", to: "/dashboard/admin/audit" },
          { label: "Reports", icon: "chart", to: "/dashboard/admin/reports" },
          { label: "System Settings", icon: "sliders", to: "/dashboard/admin/settings" },
        ],
      },
      {
        group: null,
        items: [
          { label: "Notifications", icon: "bell", to: "/dashboard/admin/notifications", badge: "notifications" },
        ],
      },
    ],
  },
  doctor: {
    key: "doctor",
    label: "Veterinarian",
    shortLabel: "Doctor",
    dashboardLabel: "Doctor Dashboard",
    path: "/dashboard/doctor",
    blurb: "Handles animal health records, vaccination and case notes.",
    icon: "medical-cross",
    nav: [
      { group: null, items: [{ label: "Overview", icon: "grid", to: "/dashboard/doctor" }] },
      {
        group: "Monitoring",
        items: [
          { label: "Monitoring Records", icon: "clipboard-check", to: "/dashboard/doctor/monitoring" },
          { label: "Health Records", icon: "medical-cross", to: "/dashboard/doctor/health-records" },
          { label: "Vaccination Schedule", icon: "calendar", to: "/dashboard/doctor/vaccination-schedule" },
          { label: "Case Notes", icon: "file-text", to: "/dashboard/doctor/case-notes" },
          { label: "Animal Health Monitoring", icon: "activity", to: "/dashboard/doctor/animal-health" },
        ],
      },
      {
        group: "Program",
        items: [{ label: "Dispersal Map", icon: "map", to: "/dashboard/doctor/map" }],
      },
      {
        group: null,
        items: [
          { label: "Notifications", icon: "bell", to: "/dashboard/doctor/notifications", badge: "notifications" },
        ],
      },
    ],
  },
  technician: {
    key: "technician",
    label: "Field Technician",
    shortLabel: "Technician",
    dashboardLabel: "Technician Dashboard",
    path: "/dashboard/technician",
    blurb: "Tags animals in the field and records dispersal movements.",
    icon: "map-pin",
    nav: [
      { group: null, items: [{ label: "Overview", icon: "grid", to: "/dashboard/technician" }] },
      {
        group: "Monitoring",
        items: [{ label: "Monitoring Records", icon: "clipboard-check", to: "/dashboard/technician/monitoring" }],
      },
      {
        group: "Program",
        items: [
          { label: "Geo-Tagging Map", icon: "map", to: "/dashboard/technician/map" },
          { label: "Field Visits", icon: "route", to: "/dashboard/technician/field-visits" },
          { label: "Dispersal Records", icon: "truck", to: "/dashboard/technician/map" },
          { label: "Re-Dispersal Tracking", icon: "refresh", to: "/dashboard/technician/map" },
        ],
      },
      {
        group: null,
        items: [
          { label: "Notifications", icon: "bell", to: "/dashboard/technician/notifications", badge: "notifications" },
        ],
      },
    ],
  },
};

/**
 * Every sidebar item for a role, flattened (groups removed, order kept) —
 * for the callers that want the plain item list (module cards, the landing
 * page's feature lists) rather than the grouped rendering.
 *
 * @returns {list<object>}
 */
export function flatNav(roleKey) {
  return (roles[roleKey]?.nav ?? []).flatMap((band) => band.items);
}

/** Roles shown on the public landing page, in display order. */
export const publicRoles = ROLE_KEYS.map((key) => roles[key]);

/** Look up a role, falling back to `null` so callers can render an error state. */
export function getRole(role) {
  return roles[role] ?? null;
}

/** Where a given role should land after login. */
export function dashboardPathFor(role) {
  return roles[role]?.path ?? null;
}

/** Display label for a role, safe for unknown values. */
export function roleLabel(role) {
  return roles[role]?.label ?? "Unassigned role";
}

/** True when this user is signed in with an all access role. */
export function hasAllAccess(role) {
  return ALL_ACCESS_ROLES.includes(role);
}

/** Can this user open the given role's dashboard? */
export function canAccessDashboard(userRole, dashboardRole) {
  return userRole === dashboardRole || hasAllAccess(userRole);
}

/**
 * Every dashboard this user may open, in display order.
 *
 * More than one entry means the sidebar should offer a switcher.
 */
export function dashboardsFor(userRole) {
  if (hasAllAccess(userRole)) return ROLE_KEYS;
  return roles[userRole] ? [userRole] : [];
}

/**
 * Which dashboard a pathname belongs to, or null for anything unrecognised.
 * Used so the shell describes the dashboard being viewed rather than the
 * user's own role — they differ for all access accounts.
 */
export function roleFromPath(pathname) {
  const match = /^\/dashboard\/([^/]+)/.exec(pathname);
  return match && roles[match[1]] ? match[1] : null;
}
