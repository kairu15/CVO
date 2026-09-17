import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getRole, roleLabel } from "../config/roles";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardSidebar } from "./DashboardSidebar";

/**
 * Shared shell for every role dashboard: role-conditional sidebar, top header
 * and a content area. Only the sidebar contents and header label change
 * between roles, which keeps the four dashboards feeling like one system.
 */
export function DashboardLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const [drawerPath, setDrawerPath] = useState(null);

  // The drawer is only "open" for the route it was opened on, so navigating
  // (including with the browser back button) closes it without an effect.
  const drawerOpen = drawerPath === location.pathname;

  const config = getRole(user?.role);
  const title = config?.dashboardLabel ?? "Dashboard";
  const subtitle = config
    ? `${config.label} · ${user?.email ?? ""}`
    : roleLabel(user?.role);

  return (
    <div className="min-h-screen lg:pl-72">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-slate-200/70 lg:block">
        <DashboardSidebar role={user?.role} />
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
              role={user?.role}
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
          <Outlet />
        </main>
      </div>
    </div>
  );
}
