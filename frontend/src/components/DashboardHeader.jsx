import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { roleLabel } from "../config/roles";
import { Icon } from "./Icons";

/** Up to two initials for the avatar chip. */
function initialsOf(name) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export function DashboardHeader({ title, subtitle, onOpenSidebar }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [panel, setPanel] = useState(null); // "notifications" | "profile" | null

  const close = () => setPanel(null);

  async function handleLogout() {
    close();
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200/70 bg-white/85 px-4 backdrop-blur sm:px-6">
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label="Open navigation"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-brand-50 hover:text-brand-700 lg:hidden"
      >
        <Icon name="menu" />
      </button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-base font-bold text-slate-900 sm:text-lg">
          {title}
        </h1>
        {subtitle && (
          <p className="hidden truncate text-xs text-slate-500 sm:block">{subtitle}</p>
        )}
      </div>

      {/* Search is intentionally disabled: there are no records to query yet. */}
      <div className="relative hidden md:block">
        <Icon
          name="search"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
        />
        <input
          type="search"
          disabled
          aria-label="Search records"
          placeholder="Search records — coming soon"
          className="field w-60 pl-9 text-xs"
        />
      </div>

      {/* Notifications */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPanel(panel === "notifications" ? null : "notifications")}
          aria-label="Notifications"
          aria-expanded={panel === "notifications"}
          className="relative grid h-10 w-10 place-items-center rounded-xl text-slate-500 transition hover:bg-brand-50 hover:text-brand-700"
        >
          <Icon name="bell" />
          <span className="absolute top-2 right-2.5 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-white" />
        </button>

        {panel === "notifications" && (
          <>
            <button
              type="button"
              aria-label="Close notifications"
              onClick={close}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div className="card absolute right-0 z-20 mt-2 w-72 p-4">
              <p className="font-display text-sm font-semibold text-slate-900">
                Notifications
              </p>
              <p className="mt-1.5 text-xs text-slate-500">
                Dispersal, vaccination and re-dispersal alerts will appear here
                once records are encoded.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Profile */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPanel(panel === "profile" ? null : "profile")}
          aria-expanded={panel === "profile"}
          aria-label="Account menu"
          className="flex items-center gap-2 rounded-pill border border-slate-200 py-1.5 pr-2.5 pl-1.5 transition hover:border-brand-300 hover:bg-brand-50"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800">
            {initialsOf(user?.name)}
          </span>
          <span className="hidden text-left sm:block">
            <span className="block text-xs leading-tight font-semibold text-slate-800">
              {user?.name}
            </span>
            <span className="block text-[11px] leading-tight text-slate-500">
              {roleLabel(user?.role)}
            </span>
          </span>
          <Icon name="chevron-down" className="h-4 w-4 shrink-0 text-slate-400" />
        </button>

        {panel === "profile" && (
          <>
            <button
              type="button"
              aria-label="Close account menu"
              onClick={close}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div className="card absolute right-0 z-20 mt-2 w-64 p-4">
              <p className="truncate font-display text-sm font-semibold text-slate-900">
                {user?.name}
              </p>
              <p className="truncate text-xs text-slate-500">{user?.email}</p>
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-pill bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-800">
                <Icon name="shield" className="h-3.5 w-3.5" />
                {roleLabel(user?.role)}
              </p>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-3 flex w-full items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              >
                <Icon name="logout" className="h-4 w-4" />
                Log out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
