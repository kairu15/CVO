import { useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { dashboardsFor, getRole, roleLabel, visibleNav } from "../config/roles";
import { useUnreadNotificationsCount } from "../api/queries";
import { Brand } from "./Brand";
import { Icon } from "./Icons";
import { LogoutConfirmDialog } from "./LogoutConfirmDialog";

/**
 * Dashboard sidebar.
 *
 * Menu items come from `config/roles.js`, grouped into bands with headers
 * (Monitoring / Program / Administration) so the same concept sits in the
 * same group on every role's sidebar. Items without a `to` value are modules
 * that have not been built yet — they render as inert rows with a "Soon" tag
 * rather than as links that lead nowhere.
 *
 * An item may declare a `badge` source (e.g. `badge: "notifications"`); when
 * that source has a live count above zero the row shows a small red count
 * pill, the same signal the header bell carries. The badge is hidden while the
 * item is the current page — the page itself shows the state.
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
  permissions = [],
  onNavigate,
  onClose,
}) {
  const [confirming, setConfirming] = useState(false);
  const logoutButtonRef = useRef(null);

  const config = getRole(activeRole);
  const switchable = dashboardsFor(userRole);
  const nav = visibleNav(activeRole, permissions);
  const owningDashboard = userRole && activeRole !== userRole ? getRole(userRole) : null;

  // Shared with the header bell via the same query key, so the sidebar adds no
  // extra polling — it just mirrors the count as a badge.
  const { data: unreadNotifications = 0 } = useUnreadNotificationsCount();
  const badgeCounts = { notifications: unreadNotifications };

  return (
    <div className="flex h-full flex-col bg-cvo-navy text-white">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-white/10 px-5">
        <Brand subtitle={roleLabel(userRole)} onBrand />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-brand-100 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <Icon name="close" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {switchable.length > 1 && (
          <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-2">
            <p className="px-2 py-1 text-[10px] font-semibold tracking-wider text-brand-200 uppercase">
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
                          ? "bg-white/15 text-white"
                          : "text-brand-100 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <Icon
                        name={role.icon}
                        className={`h-4 w-4 shrink-0 ${
                          isActive ? "text-brand-300" : "text-brand-200"
                        }`}
                      />
                      <span className="truncate">{role.shortLabel}</span>
                      {isActive && (
                        <Icon
                          name="check"
                          className="ml-auto h-3.5 w-3.5 shrink-0 text-brand-300"
                        />
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {owningDashboard && (
          <NavLink
            to={owningDashboard.path}
            onClick={onNavigate}
            className="mb-4 flex items-center gap-2.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-brand-100 transition hover:bg-white/10 hover:text-white"
          >
            <Icon name="arrow-left" className="h-4 w-4 shrink-0" />
            Back to my {owningDashboard.shortLabel} dashboard
          </NavLink>
        )}

        <nav aria-label="Dashboard" className="space-y-4">
          {nav.map((band, bandIndex) => (
            <div key={band.group ?? `band-${bandIndex}`} className="space-y-1">
              {/* Named group header; ungrouped bands (Overview, the closing
                  row) render without one. */}
              {band.group && (
                <p className="px-3 pb-0.5 text-[10px] font-semibold tracking-wider text-brand-200 uppercase">
                  {band.group}
                </p>
              )}

              {band.items.map((item) => {
                const badgeCount = item.badge ? badgeCounts[item.badge] ?? 0 : 0;

                return item.to ? (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    onClick={onNavigate}
                    /* NavLink matches by path prefix, so the dashboard root
                       ("Overview") would stay lit on every sub-page — clicking
                       Monitoring Records appeared to do nothing. Require an exact
                       match for the root; deeper modules keep prefix matching so
                       they stay lit on their own sub-routes. */
                    end={item.to === config?.path}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                        isActive
                          ? "bg-white/15 text-white"
                          : "text-brand-100 hover:bg-white/10 hover:text-white"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          name={item.icon}
                          className={`h-5 w-5 shrink-0 ${
                            isActive ? "text-brand-300" : "text-brand-200"
                          }`}
                        />
                        <span className="truncate">{item.label}</span>
                        {badgeCount > 0 && !isActive && (
                          <>
                            <span
                              aria-hidden="true"
                              className="ml-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white"
                            >
                              {badgeCount > 9 ? "9+" : badgeCount}
                            </span>
                            <span className="sr-only">{badgeCount} unread</span>
                          </>
                        )}
                      </>
                    )}
                  </NavLink>
                ) : (
                  <span
                    key={item.label}
                    className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-brand-200/60"
                    title="This module has not been built yet"
                  >
                    <Icon name={item.icon} className="h-5 w-5 shrink-0 text-brand-200/50" />
                    <span className="truncate">{item.label}</span>
                    <span className="ml-auto rounded-pill bg-white/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-brand-200 uppercase">
                      Soon
                    </span>
                  </span>
                );
              })}
            </div>
          ))}
        </nav>
      </div>

      <div className="shrink-0 border-t border-white/10 p-3">
        <button
          ref={logoutButtonRef}
          type="button"
          onClick={() => setConfirming(true)}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-brand-100 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <Icon name="logout" className="h-5 w-5 shrink-0" />
          Log out
        </button>
      </div>

      <LogoutConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        returnFocusRef={logoutButtonRef}
      />
    </div>
  );
}
