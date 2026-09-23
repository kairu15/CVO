import { lazy, Suspense } from "react";
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
import MonitoringPage from "../pages/MonitoringPage";
import TechnicianAssignmentsPage from "../pages/TechnicianAssignmentsPage";
import BeneficiariesPage from "../pages/BeneficiariesPage";

// The map bundle (MapLibre GL) is heavy — load it only when a map page opens.
const DispersalMapPage = lazy(() => import("../pages/DispersalMapPage"));
const BeneficiaryLineagePage = lazy(() => import("../pages/BeneficiaryLineagePage"));

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
                <RoleRoute dashboard="admin">
                  <RoleDashboard roleKey="admin" />
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/doctor"
              element={
                <RoleRoute dashboard="doctor">
                  <RoleDashboard roleKey="doctor" />
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/technician"
              element={
                <RoleRoute dashboard="technician">
                  <RoleDashboard roleKey="technician" />
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/farmer"
              element={
                <RoleRoute dashboard="farmer">
                  <RoleDashboard roleKey="farmer" />
                </RoleRoute>
              }
            />

            {/* Livestock monitoring — shared page, role-scoped data */}
            <Route
              path="/dashboard/admin/monitoring"
              element={
                <RoleRoute dashboard="admin">
                  <MonitoringPage roleKey="admin" />
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/doctor/monitoring"
              element={
                <RoleRoute dashboard="doctor">
                  <MonitoringPage roleKey="doctor" />
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/technician/monitoring"
              element={
                <RoleRoute dashboard="technician">
                  <MonitoringPage roleKey="technician" />
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/farmer/monitoring"
              element={
                <RoleRoute dashboard="farmer">
                  <MonitoringPage roleKey="farmer" />
                </RoleRoute>
              }
            />

            {/* Admin management screens */}
            <Route
              path="/dashboard/admin/technicians"
              element={
                <RoleRoute dashboard="admin">
                  <TechnicianAssignmentsPage />
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/admin/beneficiaries"
              element={
                <RoleRoute dashboard="admin">
                  <BeneficiariesPage />
                </RoleRoute>
              }
            />

            {/* Dispersal map — geo-tagged beneficiaries per role */}
            <Route
              path="/dashboard/admin/map"
              element={
                <RoleRoute dashboard="admin">
                  <Suspense fallback={<MapFallback />}>
                    <DispersalMapPage roleKey="admin" />
                  </Suspense>
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/doctor/map"
              element={
                <RoleRoute dashboard="doctor">
                  <Suspense fallback={<MapFallback />}>
                    <DispersalMapPage roleKey="doctor" />
                  </Suspense>
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/technician/map"
              element={
                <RoleRoute dashboard="technician">
                  <Suspense fallback={<MapFallback />}>
                    <DispersalMapPage roleKey="technician" />
                  </Suspense>
                </RoleRoute>
              }
            />

            {/* Re-dispersal lineage for one beneficiary */}
            <Route
              path="/dashboard/:role/beneficiaries/:id/lineage"
              element={<BeneficiaryLineagePage />}
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

/** Placeholder while the lazy map chunk loads. */
function MapFallback() {
  return (
    <div className="card grid h-72 place-items-center">
      <p className="text-sm text-slate-500">Loading map…</p>
    </div>
  );
}
