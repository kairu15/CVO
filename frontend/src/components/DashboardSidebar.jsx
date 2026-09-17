import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { dashboardsFor, getRole, roleLabel } from "../config/roles";
import { Brand } from "./Brand";
import { Icon } from "./Icons";

/**
 * Dashboard sidebar.
 *
 * Menu items come from `config/roles.js`, so all four dashboards share this
 * component and differ only in their role config. Items without a `to` value
 * are modules that have not been built yet — they render as inert rows with a
 * "Soon" tag rather than as links that lead nowhere.
 *
 * `userRole` is the signed-in identity (shown under the logo); `activeRole` is
 * the dashboard currently being viewed. They are the same for ordinary users,
 * and differ for an all access account, which also gets a dashboard switcher.
 *
 * `onClose` is only passed by the mobile drawer, which needs its own dismiss
 * button because the drawer covers all but a sliver of the screen.
 */
export function DashboardSidebar({
  userRole,
  activeRole,
  onNavigate,
  onClose,
}) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const config = getRole(activeRole);
  const switchable = dashboardsFor(userRole);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-5">
        <Brand subtitle={roleLabel(userRole)} />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            <Icon name="close" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {switchable.length > 1 && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/70 p-2">
            <p className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              All access · {switchable.length} dashboards
            </p>
            <ul className="mt-1 space-y-0.5">
              {switchable.map((key) => {
                const role = getRole(key);
                const isActive = key === activeRole;

                return (
                  <li key={key}>
                    <NavLink
                      to={role.path}
                      onClick={onNavigate}
                      className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${
                        isActive
                          ? "bg-brand-100 text-brand-900"
                          : "text-slate-600 hover:bg-white hover:text-brand-800"
                      }`}
                    >
                      <Icon
                        name={role.icon}
                        className={`h-4 w-4 shrink-0 ${
                          isActive ? "text-brand-700" : "text-slate-400"
                        }`}
                      />
                      <span className="truncate">{role.shortLabel}</span>
                      {isActive && (
                        <Icon
                          name="check"
                          className="ml-auto h-3.5 w-3.5 shrink-0 text-brand-700"
                        />
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <nav aria-label="Dashboard" className="space-y-1">
          {config?.nav.map((item) =>
            item.to ? (
              <NavLink
                key={item.label}
                to={item.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? "bg-brand-100 text-brand-900"
                      : "text-slate-600 hover:bg-brand-50 hover:text-brand-800"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      name={item.icon}
                      className={`h-5 w-5 shrink-0 ${
                        isActive ? "text-brand-700" : "text-slate-400"
                      }`}
                    />
                    {item.label}
                  </>
                )}
              </NavLink>
            ) : (
              <span
                key={item.label}
                className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400"
                title="This module has not been built yet"
              >
                <Icon name={item.icon} className="h-5 w-5 shrink-0 text-slate-300" />
                <span className="truncate">{item.label}</span>
                <span className="ml-auto rounded-pill bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
                  Soon
                </span>
              </span>
            ),
          )}
        </nav>
      </div>

      <div className="shrink-0 border-t border-slate-100 p-3">
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
        >
          <Icon name="logout" className="h-5 w-5 shrink-0" />
          Log out
        </button>
      </div>
    </div>
  );
}
