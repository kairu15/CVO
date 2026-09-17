import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { canAccessDashboard, dashboardPathFor } from "../config/roles";
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
 * @param {object} props
 * @param {string} props.dashboard the role whose dashboard these children are
 */
export function RoleRoute({ dashboard, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingSpinner />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!canAccessDashboard(user.role, dashboard)) {
    const home = dashboardPathFor(user.role);
    // Unknown roles have no dashboard of their own — fall back to a safe page.
    return <Navigate to={home ?? "/login"} replace />;
  }

  return children;
}
