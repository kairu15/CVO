import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { GuestRoute, ProtectedRoute } from "../components/ProtectedRoute";
import { RoleRoute } from "../components/RoleRoute";
import { DashboardLayout } from "../components/DashboardLayout";
import { EmptyState } from "../components/EmptyState";
import { dashboardPathFor } from "../config/roles";
import AuthPage from "../pages/AuthPage";
import LandingPage from "../pages/LandingPage";
import RoleDashboard from "../pages/RoleDashboard";

/**
 * `/dashboard` is a convenience entry point: it forwards each user to the
 * dashboard their role owns.
 */
function DashboardIndex() {
  const { user } = useAuth();
  const target = dashboardPathFor(user?.role);

  if (target) return <Navigate to={target} replace />;

  return (
    <div className="card">
      <EmptyState
        title="No dashboard assigned"
        description="Your account does not have a dashboard yet. Contact the CVO administrator to have a role assigned."
      />
    </div>
  );
}

export default function AppRoutes() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />

          <Route
            path="/login"
            element={
              <GuestRoute>
                <AuthPage mode="login" />
              </GuestRoute>
            }
          />
          <Route
            path="/register"
            element={
              <GuestRoute>
                <AuthPage mode="register" />
              </GuestRoute>
            }
          />

          {/* Authenticated shell shared by every role */}
          <Route
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardIndex />} />
            <Route
              path="/dashboard/admin"
              element={
                <RoleRoute allow={["admin"]}>
                  <RoleDashboard roleKey="admin" />
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/doctor"
              element={
                <RoleRoute allow={["doctor"]}>
                  <RoleDashboard roleKey="doctor" />
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/technician"
              element={
                <RoleRoute allow={["technician"]}>
                  <RoleDashboard roleKey="technician" />
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/farmer"
              element={
                <RoleRoute allow={["farmer"]}>
                  <RoleDashboard roleKey="farmer" />
                </RoleRoute>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
