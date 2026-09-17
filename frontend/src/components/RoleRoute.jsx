import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { dashboardPathFor } from "../config/roles";
import { LoadingSpinner } from "./LoadingSpinner";

/**
 * Role-based access control for dashboard routes.
 *
 * Runs inside <ProtectedRoute>, so the session is already known to be valid.
 * A user who opens a dashboard that is not theirs is bounced to their own
 * instead of seeing a dead end.
 *
 * This is a routing guard only — every endpoint that eventually feeds these
 * dashboards must enforce the same rule server-side.
 *
 * @param {object} props
 * @param {string[]} props.allow roles permitted to render the children
 */
export function RoleRoute({ allow, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingSpinner />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!allow.includes(user.role)) {
    const home = dashboardPathFor(user.role);
    // Unknown roles have no dashboard of their own — fall back to a safe page.
    return <Navigate to={home ?? "/login"} replace />;
  }

  return children;
}
