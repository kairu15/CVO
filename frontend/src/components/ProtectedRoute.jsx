import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { dashboardPathFor } from "../config/roles";
import { LoadingSpinner } from "./LoadingSpinner";

/**
 * Renders children only for authenticated users; otherwise redirects
 * to /login, remembering where the user was headed.
 */
export function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingSpinner />;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

/**
 * Guest-only pages (login, register). An authenticated user is sent straight
 * to their own dashboard instead of being shown the auth panel again.
 */
export function GuestRoute({ children }) {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) return <LoadingSpinner />;

  if (isAuthenticated) {
    return <Navigate to={dashboardPathFor(user?.role) ?? "/dashboard"} replace />;
  }

  return children;
}
