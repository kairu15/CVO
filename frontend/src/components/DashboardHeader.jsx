import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { roleLabel } from "../config/roles";
import { notificationsApi } from "../api/notificationsApi";
import {
  useInvalidate,
  useNotificationsFeed,
  useUnreadNotificationsCount,
} from "../api/queries";
import { searchApi } from "../api/searchApi";
import { getErrorMessage } from "../api/client";
import { Icon } from "./Icons";
import { SkeletonList } from "./Skeleton";

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

const SEARCH_GROUP_ICONS = {
  beneficiary: "map-pin",
  "monitoring-record": "clipboard-check",
  account: "users",
};

const NOTIFICATION_ICONS = {
  "vaccination-overdue": "alert-circle",
  "vaccination-due-soon": "calendar",
  dispersal: "truck",
  "re-dispersal": "refresh",
};

const MIN_QUERY = 2;

/** "32 days overdue" / "due in 19 days" — same wording as the alerts page. */
function dueHint(days) {
  if (days === null || days === undefined) return null;
  if (days === 0) return "due today";
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue`;
  return `due in ${days} ${days === 1 ? "day" : "days"}`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

export function DashboardHeader({ title, subtitle, onOpenSidebar }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [panel, setPanel] = useState(null); // "search" | "notifications" | "profile" | null
  const [query, setQuery] = useState("");

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

      {/* Search — queries the same role-scoped records the list pages show.
          Nothing outside the user's own scope can come back, because the
          scoping happens server-side, not here. */}
      <div className="relative hidden md:block">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setPanel("search");
          }}
        >
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPanel("search");
            }}
            aria-label="Search records"
            placeholder="Search records"
            className="field w-60 pl-9 text-xs"
          />
        </form>

        {panel === "search" && (
          <>
            <button
              type="button"
              aria-label="Close search"
              onClick={close}
              className="fixed inset-0 z-10 cursor-default"
            />
            <SearchPanel query={query} onNavigate={close} />
          </>
        )}
      </div>

      {/* Notifications — the live alert feed (same endpoint the farmer
          notifications page reads), with a badge only when something needs
          attention, so an empty feed reads as "all clear", not "broken". */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPanel(panel === "notifications" ? null : "notifications")}
          aria-label="Notifications"
          aria-expanded={panel === "notifications"}
          className="relative grid h-10 w-10 place-items-center rounded-xl text-slate-500 transition hover:bg-brand-50 hover:text-brand-700"
        >
          <Icon name="bell" />
          <NotificationBadge active={panel === "notifications"} />
        </button>

        {panel === "notifications" && (
          <>
            <button
              type="button"
              aria-label="Close notifications"
              onClick={close}
              className="fixed inset-0 z-10 cursor-default"
            />
            <NotificationPanel onNavigate={close} />
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
          {user?.avatar_url ? (
            <img
              src={user.avatar_url}
              alt=""
              className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
            />
          ) : (
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800">
              {initialsOf(user?.name)}
            </span>
          )}
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
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="h-10 w-10 rounded-full object-cover ring-1 ring-slate-200"
                />
              ) : (
                <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
                  {initialsOf(user?.name)}
                </span>
              )}
              <p className="mt-2 truncate font-display text-sm font-semibold text-slate-900">
                {user?.name}
              </p>
              <p className="truncate text-xs text-slate-500">{user?.email}</p>
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-pill bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-800">
                <Icon name="shield" className="h-3.5 w-3.5" />
                {roleLabel(user?.role)}
              </p>
              <Link
                to="/dashboard/profile"
                onClick={close}
                className="mt-3 flex w-full items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
              >
                <Icon name="user" className="h-4 w-4" />
                My Profile
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-2 flex w-full items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
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

/**
 * The debounced search results panel.
 *
 * Lives outside the header's own state so typing re-renders only this panel
 * and its request cycle, not the whole header (and the bell with it).
 */
function SearchPanel({ query, onNavigate }) {
  const { user } = useAuth();
  const trimmed = query.trim();
  const short = trimmed.length < MIN_QUERY;

  const [state, setState] = useState({ status: "idle", groups: [], total: 0, error: null });
  const latestQuery = useRef(trimmed);

  useEffect(() => {
    // Below the minimum there is nothing to fetch: the hint panel renders
    // straight from `short`, and any previous results simply stay unused.
    if (short) return undefined;

    latestQuery.current = trimmed;
    setState((prev) => ({ ...prev, status: "loading" }));

    // Debounced, and stale responses discarded: fast typing must not let an
    // older answer overwrite a newer one.
    const timer = setTimeout(async () => {
      try {
        const { groups, total } = await searchApi.search(trimmed);

        if (latestQuery.current === trimmed) {
          setState({ status: "done", groups, total, error: null });
        }
      } catch (err) {
        if (latestQuery.current === trimmed) {
          setState({ status: "done", groups: [], total: 0, error: getErrorMessage(err) });
        }
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [trimmed, short]);

  if (short) {
    // Accounts are a staff-only search group; the copy reflects that.
    const canSeeAccounts = ["admin", "doctor"].includes(user?.role);

    return (
      <div className="card absolute right-0 z-20 mt-2 w-80 p-4">
        <p className="font-display text-sm font-semibold text-slate-900">Search records</p>
        <p className="mt-1.5 text-xs text-slate-500">
          Type at least {MIN_QUERY} characters — households, monitoring visits
          {canSeeAccounts ? " and accounts" : ""} are searched by name,
          barangay or animal.
        </p>
      </div>
    );
  }

  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="card absolute right-0 z-20 mt-2 w-80 overflow-hidden">
        <SkeletonList className="space-y-2 p-4" rowClassName="h-10" />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="card absolute right-0 z-20 mt-2 w-80 p-4">
        <p className="font-display text-sm font-semibold text-slate-900">Search failed</p>
        <p className="mt-1.5 text-xs text-red-600">{state.error}</p>
      </div>
    );
  }

  if (state.total === 0) {
    return (
      <div className="card absolute right-0 z-20 mt-2 w-80 p-4">
        <p className="font-display text-sm font-semibold text-slate-900">No matches</p>
        <p className="mt-1.5 text-xs text-slate-500">
          Nothing in your records matches “{trimmed}”. Only records you can
          already open are searched.
        </p>
      </div>
    );
  }

  return (
    <div className="card absolute right-0 z-20 mt-2 max-h-96 w-80 overflow-y-auto p-2">
      {state.groups.map((group) => (
        <div key={group.type} className="p-2">
          <p className="px-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            {group.label} · {group.total}
          </p>
          <ul className="mt-1 space-y-0.5">
            {group.results.map((result) => (
              <li key={`${group.type}-${result.id}`}>
                <Link
                  to={result.link}
                  onClick={onNavigate}
                  className="flex items-start gap-2.5 rounded-xl px-2 py-2 transition hover:bg-brand-50"
                >
                  <Icon
                    name={SEARCH_GROUP_ICONS[group.type] ?? "search"}
                    className="mt-0.5 h-4 w-4 shrink-0 text-brand-700"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-slate-900">
                      {result.title}
                    </span>
                    {result.subtitle && (
                      <span className="block truncate text-[11px] text-slate-500">
                        {result.subtitle}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * The unread-event count behind the bell: a polled number, not a one-shot
 * dot. Hidden at 0 (no "0" badge), capped at "9+" so two digits never
 * stretch the pill. Invisible while the panel is open — the panel itself
 * shows the state, and the count refetches the moment events are read.
 */
function NotificationBadge({ active }) {
  const { data: unread = 0 } = useUnreadNotificationsCount();

  if (unread === 0 || active) return null;

  return (
    <span className="absolute -top-1 -right-1 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white ring-2 ring-white">
      {unread > 9 ? "9+" : unread}
    </span>
  );
}

/**
 * The bell's dropdown: the top of the same feed the notifications page
 * renders in full, so the two surfaces cannot disagree about what happened.
 *
 * Fed by the polled query, so it keeps updating while open, and "Mark all
 * read" writes through to the server and invalidates the badge query in the
 * same tick — the badge decrements immediately, not on the next poll.
 */
function NotificationPanel({ onNavigate }) {
  const { user } = useAuth();
  const invalidate = useInvalidate();
  const [marking, setMarking] = useState(false);
  const { data, isLoading, error } = useNotificationsFeed(10);

  const alerts = data?.alerts ?? [];
  const counts = data?.counts ?? {};
  const attention = (counts.urgent ?? 0) + (counts.warning ?? 0);
  const unreadEvents = counts.unread_events ?? 0;

  // Every role has its own full notifications page now; the panel is the
  // quick glance, the page the full history.
  const allHref = user?.role ? `/dashboard/${user.role}/notifications` : null;

  async function markAllRead() {
    setMarking(true);

    try {
      await notificationsApi.markAllRead();
      invalidate.notifications();
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="card absolute right-0 z-20 mt-2 w-80 p-4">
      <div className="flex items-center justify-between">
        <p className="font-display text-sm font-semibold text-slate-900">Notifications</p>
        {attention > 0 && (
          <span className="rounded-pill bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
            {attention} needing action
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="mt-3">
          <SkeletonList className="space-y-2" rows={2} rowClassName="h-12" />
        </div>
      ) : error ? (
        <p className="mt-2 text-xs text-red-600">{getErrorMessage(error)}</p>
      ) : alerts.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          Nothing needs attention and no movements have been recorded yet.
          Alerts appear here when a dispersal is recorded or a vaccination
          falls due.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {alerts.map((alert) => {
            const hint = dueHint(alert.days_until_due);
            const meta = [formatDate(alert.date), hint].filter(Boolean).join(" · ");
            const isEvent = typeof alert.id === "string" && alert.id.startsWith("event-");

            return (
              <li key={alert.id}>
                <Link
                  to={alert.link}
                  onClick={onNavigate}
                  className={`flex items-start gap-2.5 rounded-xl px-2 py-2 transition hover:bg-brand-50 ${
                    isEvent && !alert.read ? "bg-brand-50/70" : ""
                  }`}
                >
                  <Icon
                    name={NOTIFICATION_ICONS[alert.type] ?? "bell"}
                    className="mt-0.5 h-4 w-4 shrink-0 text-brand-700"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-900">
                      {alert.title}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                      {alert.message}
                    </span>
                    {meta && (
                      <span className="mt-0.5 block text-[11px] text-slate-400">{meta}</span>
                    )}
                  </span>
                  {isEvent && !alert.read && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-2">
        {unreadEvents > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            disabled={marking}
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 disabled:opacity-60"
          >
            {marking ? "Marking…" : "Mark all read"}
          </button>
        )}
        {allHref && (
          <Link
            to={allHref}
            onClick={onNavigate}
            className={`flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 ${
              unreadEvents > 0 ? "flex-1" : "w-full"
            }`}
          >
            View all
            <Icon name="arrow-right" className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
