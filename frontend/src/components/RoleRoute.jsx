import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { canAccessDashboard, dashboardPathFor } from "../config/roles";
import { EmptyState } from "./EmptyState";
import { LoadingSpinner } from "./LoadingSpinner";

/**
 * Role-based access control for dashboard routes.
 *
 * Runs inside <ProtectedRoute>, so the session is already known to be valid.
 * A user who opens a dashboard their role does not own is bounced to their own
 * instead of seeing a dead end. All access roles (see `ALL_ACCESS_ROLES`) are
 * let into every dashboard.
 *
 * This is a routing guard only — every endpoint that eventually feeds these
 * dashboards must enforce the same rule server-side.
 *
 * When a route declares a `permission`, a holder may open it even when it
 * lives under another role's dashboard. That keeps the capability matrix
 * honest: granting `manage_roles` to a technician must actually let them use
 * the matrix, not leave the lockout guard satisfied by an unreachable page.
 * A missing capability renders an in-place access-changed state rather than a
 * misleading empty screen.
 *
 * @param {object} props
 * @param {string} props.dashboard the role whose dashboard these children are
 * @param {string} [props.permission] capability required in addition/instead
 */
export function RoleRoute({ dashboard, permission, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingSpinner />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // A cached identity from before permissions were shipped has no list; the
  // server still enforces every request, so do not lock an offline field user
  // out of pages merely because the snapshot is old.
  const hasCapability =
    !permission ||
    !Array.isArray(user.permissions) ||
    user.permissions.includes(permission);

  if (!hasCapability) {
    return <AccessChanged permission={permission} user={user} />;
  }

  // A capability-gated admin tool may be opened from another role's dashboard
  // by an account that actually holds the capability.
  if (!permission && !canAccessDashboard(user.role, dashboard)) {
    const home = dashboardPathFor(user.role);
    // Unknown roles have no dashboard of their own — fall back to a safe page.
    return <Navigate to={home ?? "/login"} replace />;
  }

  return children;
}

/** In-place refusal after a role or capability was changed elsewhere. */
function AccessChanged({ permission, user }) {
  return (
    <div className="card">
      <EmptyState
        title="Access changed"
        description={`Your account no longer holds the capability this page needs${
          permission ? ` (${permission})` : ""
        }. If this looks wrong, ask an administrator to review your role.`}
      />
      <div className="flex justify-center pb-6">
        <Link
          to={dashboardPathFor(user.role) ?? "/dashboard"}
          className="btn-secondary rounded-pill px-4 py-2 text-sm font-semibold"
        >
          Back to my dashboard
        </Link>
      </div>
    </div>
  );
}
