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
import TransparencyPage from "../pages/TransparencyPage";
import ResetPasswordPage from "../pages/ResetPasswordPage";

// Every authenticated screen is loaded on demand so the first paint does not
// ship the whole system: the reports (Recharts), the forms (MapLibre via the
// coordinate picker) and the admin configuration pages are the bulk of the
// bundle, and a signed-in user only ever opens a few of them. The shell —
// sidebar, header, Suspense fallback — lives in DashboardLayout, so a lazy
// page suspends inside the layout instead of blanking it.
const RoleDashboard = lazy(() => import("../pages/RoleDashboard"));
const MonitoringPage = lazy(() => import("../pages/MonitoringPage"));
const TechnicianAssignmentsPage = lazy(() => import("../pages/TechnicianAssignmentsPage"));
const BeneficiariesPage = lazy(() => import("../pages/BeneficiariesPage"));
const UserManagementPage = lazy(() => import("../pages/UserManagementPage"));
const ReportsPage = lazy(() => import("../pages/ReportsPage"));
const SystemSettingsPage = lazy(() => import("../pages/SystemSettingsPage"));
const RolesPermissionsPage = lazy(() => import("../pages/RolesPermissionsPage"));
const AuditLogPage = lazy(() => import("../pages/AuditLogPage"));
const HealthRecordsPage = lazy(() => import("../pages/HealthRecordsPage"));
const VaccinationSchedulePage = lazy(() => import("../pages/VaccinationSchedulePage"));
const CaseNotesPage = lazy(() => import("../pages/CaseNotesPage"));
const AnimalHealthPage = lazy(() => import("../pages/AnimalHealthPage"));
const FieldVisitsPage = lazy(() => import("../pages/FieldVisitsPage"));
const NotificationsPage = lazy(() => import("../pages/NotificationsPage"));
const ProfilePage = lazy(() =>
  import("../pages/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);

// The map bundle (MapLibre GL) is heavy — load it only when a map page opens.
const DispersalMapPage = lazy(() => import("../pages/DispersalMapPage"));
const BeneficiaryLineagePage = lazy(() => import("../pages/BeneficiaryLineagePage"));
const AnimalTagPage = lazy(() => import("../pages/AnimalTagPage"));

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
          <Route path="/transparency" element={<TransparencyPage />} />

          {/* Sign in. Accounts are issued by the CVO administrator — there is
              no public registration route (beneficiaries are records, not
              logins), so the panel is sign-in only. */}
          <Route
            path="/login"
            element={
              <GuestRoute>
                <AuthPage />
              </GuestRoute>
            }
          />

          {/* Password reset — the page the emailed link opens. Public, and
              guest-only like the auth panel: a signed-in user has no reason
              to be here. */}
          <Route
            path="/reset-password"
            element={
              <GuestRoute>
                <ResetPasswordPage />
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
            {/* Admin oversight of the field log — same page as the
                technician's, role-scoped server-side. Needed so an off-site
                verdict can be reviewed (and its fix adopted for an unpinned
                household) without asking a technician to do it. */}
            <Route
              path="/dashboard/admin/field-visits"
              element={
                <RoleRoute dashboard="admin">
                  <FieldVisitsPage roleKey="admin" />
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

            {/* Audit Trail — append-only record of every change, export and
                sign-in; read-only for admins holding view_activity_logs. */}
            <Route
              path="/dashboard/admin/audit"
              element={
                <RoleRoute dashboard="admin">
                  <AuditLogPage />
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

            {/* Notifications — one shared page for every role; the feed is
                role-scoped server-side, so each dashboard sees its own. */}
            <Route
              path="/dashboard/admin/notifications"
              element={
                <RoleRoute dashboard="admin">
                  <NotificationsPage roleKey="admin" />
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/doctor/notifications"
              element={
                <RoleRoute dashboard="doctor">
                  <NotificationsPage roleKey="doctor" />
                </RoleRoute>
              }
            />
            <Route
              path="/dashboard/technician/notifications"
              element={
                <RoleRoute dashboard="technician">
                  <NotificationsPage roleKey="technician" />
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

            {/* Printable ear-tag card for one beneficiary */}
            <Route
              path="/dashboard/:role/beneficiaries/:id/tag"
              element={<AnimalTagPage />}
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
