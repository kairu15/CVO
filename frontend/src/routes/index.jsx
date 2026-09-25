import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { GuestRoute, ProtectedRoute } from "../components/ProtectedRoute";
import { RoleRoute } from "../components/RoleRoute";
import { DashboardLayout } from "../components/DashboardLayout";
import { RouteProgress } from "../components/RouteProgress";
import { EmptyState } from "../components/EmptyState";
import { dashboardPathFor } from "../config/roles";
import AuthPage from "../pages/AuthPage";
import LandingPage from "../pages/LandingPage";
import RoleDashboard from "../pages/RoleDashboard";
import MonitoringPage from "../pages/MonitoringPage";
import TechnicianAssignmentsPage from "../pages/TechnicianAssignmentsPage";
import BeneficiariesPage from "../pages/BeneficiariesPage";
import UserManagementPage from "../pages/UserManagementPage";
import ReportsPage from "../pages/ReportsPage";
import SystemSettingsPage from "../pages/SystemSettingsPage";
import RolesPermissionsPage from "../pages/RolesPermissionsPage";
import HealthRecordsPage from "../pages/HealthRecordsPage";
import VaccinationSchedulePage from "../pages/VaccinationSchedulePage";
import CaseNotesPage from "../pages/CaseNotesPage";
import AnimalHealthPage from "../pages/AnimalHealthPage";
import FieldVisitsPage from "../pages/FieldVisitsPage";
import { ProfilePage } from "../pages/ProfilePage";
import DispersalStatusPage from "../pages/DispersalStatusPage";
import NotificationsPage from "../pages/NotificationsPage";
import SupportPage from "../pages/SupportPage";

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
        {/* Top progress bar for route transitions; must live inside the router */}
        <RouteProgress />
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

            {/* My Profile — one page for every role, so deliberately no
                RoleRoute: it's the signed-in user's own data, scoped
                server-side to the caller. */}
            <Route path="/dashboard/profile" element={<ProfilePage />} />
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
            <Route
              path="/dashboard/admin/users"
              element={
                <RoleRoute dashboard="admin">
                  <UserManagementPage />
                </RoleRoute>
              }
            />

            {/* City-wide program report — aggregated, read-only */}
            <Route
              path="/dashboard/admin/reports"
              element={
                <RoleRoute dashboard="admin">
                  <ReportsPage roleKey="admin" />
                </RoleRoute>
              }
            />

            {/* System settings — contact profile writable, config read-only */}
            <Route
              path="/dashboard/admin/settings"
              element={
                <RoleRoute dashboard="admin">
                  <SystemSettingsPage roleKey="admin" />
                </RoleRoute>
              }
            />

            {/* Roles & Permissions — read-only matrix over the role system */}
            <Route
              path="/dashboard/admin/roles"
              element={
                <RoleRoute dashboard="admin">
                  <RolesPermissionsPage roleKey="admin" />
                </RoleRoute>
              }
            />

            {/* Clinical health records — veterinarian-authored */}
            <Route
              path="/dashboard/doctor/health-records"
              element={
                <RoleRoute dashboard="doctor">
                  <HealthRecordsPage roleKey="doctor" />
                </RoleRoute>
              }
            />

            {/* Vaccination schedule — derived, read-only */}
            <Route
              path="/dashboard/doctor/vaccination-schedule"
              element={
                <RoleRoute dashboard="doctor">
                  <VaccinationSchedulePage roleKey="doctor" />
                </RoleRoute>
              }
            />

            {/* Case notes — freeform, veterinarian-authored */}
            <Route
              path="/dashboard/doctor/case-notes"
              element={
                <RoleRoute dashboard="doctor">
                  <CaseNotesPage roleKey="doctor" />
                </RoleRoute>
              }
            />

            {/* Animal health rollup — derived, read-only */}
            <Route
              path="/dashboard/doctor/animal-health"
              element={
                <RoleRoute dashboard="doctor">
                  <AnimalHealthPage roleKey="doctor" />
                </RoleRoute>
              }
            />

            {/* Technician field visits — the trip, with an optional GPS fix */}
            <Route
              path="/dashboard/technician/field-visits"
              element={
                <RoleRoute dashboard="technician">
                  <FieldVisitsPage roleKey="technician" />
                </RoleRoute>
              }
            />

            {/* Farmer read-only modules — no authoring surface */}
            <Route
              path="/dashboard/farmer/dispersal-status"
              element={
                <RoleRoute dashboard="farmer">
                  <DispersalStatusPage roleKey="farmer" />
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/farmer/notifications"
              element={
                <RoleRoute dashboard="farmer">
                  <NotificationsPage roleKey="farmer" />
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/farmer/support"
              element={
                <RoleRoute dashboard="farmer">
                  <SupportPage />
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
