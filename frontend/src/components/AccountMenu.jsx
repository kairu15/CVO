import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getRole, roleLabel } from "../config/roles";
import { useTheme } from "../context/ThemeContext";
import { LogoutConfirmDialog } from "./LogoutConfirmDialog";
import { Icon } from "./Icons";

/** Exit animation length; keep in sync with `.account-menu-exit` in index.css. */
const CLOSE_ANIMATION_MS = 160;

const THEME_OPTIONS = [
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" },
  { id: "system", label: "System", icon: "monitor" },
];

const ACCOUNT_LINKS = [
  {
    label: "Personal information",
    icon: "user",
    href: "/dashboard/profile#personal-information",
  },
  {
    label: "Password & security",
    icon: "shield",
    href: "/dashboard/profile#security",
  },
  {
    label: "Notification preferences",
    icon: "bell",
    href: "/dashboard/profile#preferences",
  },
];

/** Up to two initials for the avatar fallback. */
function initialsOf(name) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

/**
 * The shared account dropdown used by every dashboard role.
 *
 * Owns its open state, outside-click/Escape dismissal, keyboard navigation and
 * the logout confirmation. Identity comes from AuthContext; appearance comes
 * from ThemeContext; the account links target the existing My Profile sections.
 */
export function AccountMenu({ user, onOpen }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const closeTimer = useRef(null);

  const closeNow = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    setOpen(false);
    setClosing(false);
  }, []);

  const close = useCallback(() => {
    if (!open || closing) return;

    setClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, CLOSE_ANIMATION_MS);
  }, [open, closing]);

  const closeAndRestoreFocus = useCallback(() => {
    if (!open || closing) return;

    setClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      triggerRef.current?.focus();
    }, CLOSE_ANIMATION_MS);
  }, [open, closing]);

  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current);
    },
    [],
  );

  // Opening via mouse or keyboard moves focus to the first actionable item,
  // so the menu can be used without tabbing back through the header.
  useEffect(() => {
    if (!open || closing) return undefined;

    const frame = window.requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector("a[href], button:not([disabled])")
        ?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open, closing]);

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) close();
    }

    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeAndRestoreFocus();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close, closeAndRestoreFocus]);

  function toggle() {
    if (open && !closing) {
      close();
      return;
    }

    window.clearTimeout(closeTimer.current);
    setClosing(false);
    setOpen(true);
    onOpen?.();
  }

  /** Arrow keys move through the menu's links/buttons; Tab still works. */
  function onPanelKeyDown(event) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    const items = Array.from(
      panelRef.current?.querySelectorAll('a[href], button:not([disabled])') ?? [],
    );
    if (items.length === 0) return;

    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    let next = 0;

    if (event.key === "End") next = items.length - 1;
    else if (event.key === "ArrowUp") {
      next = current <= 0 ? items.length - 1 : current - 1;
    } else if (event.key === "ArrowDown") {
      next = current < 0 || current === items.length - 1 ? 0 : current + 1;
    }

    items[next]?.focus();
  }

  const { mode, setThemeMode } = useTheme();
  const role = getRole(user?.role);
  const roleName = roleLabel(user?.role);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open && !closing}
        aria-controls="account-menu-panel"
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-pill border border-slate-200 py-1.5 pr-2.5 pl-1.5 transition hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 dark:border-slate-200/70 dark:hover:border-brand-200/60 dark:hover:bg-brand-100/60"
      >
        {user?.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-200/40"
          />
        ) : (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800">
            {initialsOf(user?.name)}
          </span>
        )}
        <span className="hidden text-left sm:block">
          <span className="block max-w-40 truncate text-xs leading-tight font-semibold text-slate-800">
            {user?.name}
          </span>
          <span className="block text-[11px] leading-tight text-slate-500">
            {roleName}
          </span>
        </span>
        <Icon
          name="chevron-down"
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
            open && !closing ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          ref={panelRef}
          id="account-menu-panel"
          onKeyDown={onPanelKeyDown}
          className={`card absolute right-0 z-20 mt-2 max-h-[calc(100dvh-5.5rem)] w-[min(21rem,calc(100vw-2rem))] overflow-y-auto shadow-panel ${
            closing ? "account-menu-exit" : "account-menu-enter"
          }`}
        >
          <Link
            to="/dashboard/profile"
            onClick={closeNow}
            aria-label="My Profile"
            className="group flex items-start gap-3 p-3.5 transition hover:bg-brand-50/70 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-700 dark:hover:bg-brand-100/40"
          >
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt=""
                className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-200/40"
              />
            ) : (
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-100 font-display text-sm font-bold text-brand-800">
                {initialsOf(user?.name)}
              </span>
            )}

            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-sm font-bold text-slate-900">
                {user?.name}
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">
                {user?.email}
              </span>
              <span className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-pill bg-brand-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-brand-800 uppercase dark:bg-brand-100 dark:text-brand-800">
                  <Icon name={role?.icon ?? "shield"} className="h-3 w-3" />
                  {roleName}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 transition group-hover:text-brand-800">
                  My Profile
                  <Icon name="arrow-right" className="h-3 w-3" />
                </span>
              </span>
            </span>
          </Link>

          <section
            aria-labelledby="account-appearance-heading"
            className="border-t border-slate-100 px-3.5 py-3 dark:border-slate-200/60"
          >
            <div className="flex items-center justify-between gap-3">
              <h3
                id="account-appearance-heading"
                className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase"
              >
                Appearance
              </h3>
              <span className="text-[10px] font-medium text-slate-400">
                {mode === "system" ? "Follows device" : "Saved on this device"}
              </span>
            </div>

            <div
              role="group"
              aria-label="Theme"
              className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-slate-100/80 p-1 dark:bg-slate-950/40"
            >
              {THEME_OPTIONS.map((option) => {
                const active = mode === option.id;

                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setThemeMode(option.id)}
                    className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 ${
                      active
                        ? "bg-white text-brand-800 shadow-sm ring-1 ring-slate-200/70 dark:bg-slate-200 dark:text-brand-900 dark:ring-slate-200/40"
                        : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-700"
                    }`}
                  >
                    <Icon name={option.icon} className="h-3.5 w-3.5" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section
            aria-labelledby="account-settings-heading"
            className="border-t border-slate-100 px-3.5 py-3 dark:border-slate-200/60"
          >
            <h3
              id="account-settings-heading"
              className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase"
            >
              Account settings
            </h3>

            <nav aria-label="Account settings" className="mt-1.5 space-y-0.5">
              {ACCOUNT_LINKS.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  onClick={closeNow}
                  className="group flex items-center gap-2.5 rounded-xl px-2 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-700 dark:text-slate-600 dark:hover:bg-slate-100/60 dark:hover:text-slate-900"
                >
                  <Icon
                    name={link.icon}
                    className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:text-brand-700"
                  />
                  <span className="flex-1">{link.label}</span>
                  <Icon
                    name="arrow-right"
                    className="h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:text-brand-700"
                  />
                </Link>
              ))}
            </nav>
          </section>

          <div className="border-t border-slate-100 p-2 dark:border-slate-200/60">
            <button
              type="button"
              onClick={() => {
                closeNow();
                setConfirmingLogout(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-red-600 dark:text-slate-600 dark:hover:bg-red-100 dark:hover:text-red-700"
            >
              <Icon name="logout" className="h-4 w-4" />
              Log out
            </button>
          </div>
        </div>
      )}

      <LogoutConfirmDialog
        open={confirmingLogout}
        onClose={() => setConfirmingLogout(false)}
        returnFocusRef={triggerRef}
      />
    </div>
  );
}
