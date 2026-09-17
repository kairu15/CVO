/**
 * Role definitions — the single place that decides what each role sees.
 *
 * Keys must match `App\Models\User::ROLES` on the Laravel side; the role
 * returned by `GET /api/v1/user` is used directly to look up an entry here.
 *
 * Sidebar items and module cards are intentionally inert: the dashboards are
 * scaffolds, so each entry only names a module that will be built later. Give
 * an item a `to` value once its route exists and the sidebar will start
 * linking to it.
 */

export const ROLE_KEYS = ["admin", "doctor", "technician", "farmer"];

/**
 * Roles allowed into *every* dashboard, not just their own.
 *
 * The CVO administrator oversees all four workspaces, so it is the "all
 * access" account — a single login can review the vet, field and farmer views
 * without signing in and out. This is what makes admin@example.com an all
 * access account after seeding.
 *
 * NOTE: this only guards routing in the SPA. When the dashboard modules get
 * their real endpoints, the same rule has to be enforced server-side per
 * endpoint — a client-side check is not authorization.
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
      { label: "Overview", icon: "grid", to: "/dashboard/admin" },
      { label: "User Management", icon: "users" },
      { label: "Roles & Permissions", icon: "shield" },
      { label: "Reports", icon: "chart" },
      { label: "System Settings", icon: "sliders" },
      { label: "Beneficiary Records", icon: "clipboard" },
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
      { label: "Overview", icon: "grid", to: "/dashboard/doctor" },
      { label: "Health Records", icon: "medical-cross" },
      { label: "Vaccination Schedule", icon: "calendar" },
      { label: "Case Notes", icon: "file-text" },
      { label: "Animal Health Monitoring", icon: "activity" },
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
      { label: "Overview", icon: "grid", to: "/dashboard/technician" },
      { label: "Geo-Tagging Map", icon: "map" },
      { label: "Dispersal Records", icon: "truck" },
      { label: "Field Visits", icon: "route" },
      { label: "Re-Dispersal Tracking", icon: "refresh" },
    ],
  },
  farmer: {
    key: "farmer",
    label: "Farmer / Beneficiary",
    shortLabel: "Farmer",
    dashboardLabel: "Farmer Dashboard",
    path: "/dashboard/farmer",
    blurb: "Sees the animals received and the status of each dispersal.",
    icon: "livestock",
    nav: [
      { label: "Overview", icon: "grid", to: "/dashboard/farmer" },
      { label: "My Animals", icon: "livestock" },
      { label: "Dispersal Status", icon: "clipboard-check" },
      { label: "Notifications", icon: "bell" },
      { label: "Support / Contact CVO", icon: "life-buoy" },
    ],
  },
};

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
