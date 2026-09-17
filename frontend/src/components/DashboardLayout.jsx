import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getRole, roleFromPath, roleLabel } from "../config/roles";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardSidebar } from "./DashboardSidebar";
import { Icon } from "./Icons";

/**
 * Shared shell for every role dashboard: role-conditional sidebar, top header
 * and a content area. Only the sidebar contents and header label change
 * between roles, which keeps the four dashboards feeling like one system.
 *
 * The shell describes the dashboard being *viewed* rather than the user's own
 * role, because an all access account can be looking at any of them.
 */
export function DashboardLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const [drawerPath, setDrawerPath] = useState(null);

  // The drawer is only "open" for the route it was opened on, so navigating
  // (including with the browser back button) closes it without an effect.
  const drawerOpen = drawerPath === location.pathname;

  const activeRole = roleFromPath(location.pathname) ?? user?.role;
  const config = getRole(activeRole);
  const title = config?.dashboardLabel ?? "Dashboard";

  // Flag when an all access user is inside a workspace that is not their own.
  const viewingOtherRole = Boolean(
    user?.role && activeRole && activeRole !== user.role,
  );
  const subtitle = config
    ? `${config.label} workspace · ${user?.email ?? ""}`
    : roleLabel(user?.role);

  return (
    <div className="min-h-screen lg:pl-72">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-slate-200/70 lg:block">
        <DashboardSidebar userRole={user?.role} activeRole={activeRole} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Click-away surface. Keyboard users get the drawer's own close
              button instead, so this stays out of the tab order. */}
          <div
            aria-hidden="true"
            onClick={() => setDrawerPath(null)}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] shadow-panel">
            <DashboardSidebar
              userRole={user?.role}
              activeRole={activeRole}
              onNavigate={() => setDrawerPath(null)}
              onClose={() => setDrawerPath(null)}
            />
          </div>
        </div>
      )}

      <div className="flex min-h-screen flex-col">
        <DashboardHeader
          title={title}
          subtitle={subtitle}
          onOpenSidebar={() => setDrawerPath(location.pathname)}
        />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {viewingOtherRole && (
            <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-xs font-medium text-brand-900">
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-white px-2.5 py-1 font-semibold text-brand-800">
                <Icon name="shield" className="h-3.5 w-3.5" />
                {roleLabel(user.role)}
              </span>
              You are viewing the {config.label} dashboard with full access. Use
              the dashboard switcher in the sidebar to move between roles.
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
