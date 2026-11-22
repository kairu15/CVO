import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ToastViewport } from "../components/Toast";

/**
 * Global toast notifications.
 *
 * One provider at the app root; any component fires feedback through the
 * `useToast()` hook without owning message state:
 *
 *   const toast = useToast();
 *   toast.success("Account created successfully.");
 *   toast.error("That email is already registered.");
 *   toast.warning("Please complete all required fields.");
 *   toast.info("Sync started.");
 *
 * Toasts live above the routed tree so they survive navigation and stack
 * newest-on-top. Rendering is delegated to `ToastViewport`; this file only
 * owns the queue.
 */
const ToastContext = createContext(null);

/** Per-variant visible lifetime, in milliseconds. */
const TOAST_DURATIONS = Object.freeze({
  success: 3_000,
  info: 4_000,
  warning: 5_000,
  error: 6_500,
});

/** At most this many cards are mounted; the rest wait in the queue. */
const MAX_VISIBLE = 4;
/** Keep a bounded queue so a burst of API failures cannot grow without end. */
const MAX_QUEUE = 12;
/** Must match the `.toast-exit` animation in index.css. */
const EXIT_ANIMATION_MS = 200;

/**
 * Backwards compatible duration argument.
 *
 * Existing call sites pass a number (`toast.success(message, 4000)`). New
 * call sites may pass `{ duration }`, `{ persistent: true }` or
 * `{ duration: 0 }` for a message that stays until the reader dismisses it.
 */
function resolveDuration(variant, options) {
  if (typeof options === "number") {
    return Number.isFinite(options) && options > 0 ? options : 0;
  }

  if (options?.persistent) return 0;
  if (typeof options?.duration === "number") {
    return Number.isFinite(options.duration) && options.duration > 0
      ? options.duration
      : 0;
  }

  return TOAST_DURATIONS[variant] ?? TOAST_DURATIONS.info;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  const removalTimers = useRef(new Map());

  /** Mark a toast as leaving so the viewport can play the exit animation. */
  const dismiss = useCallback((id) => {
    setToasts((prev) => {
      const target = prev.find((toast) => toast.id === id);
      if (!target || target.leaving) return prev;

      return prev.map((toast) =>
        toast.id === id ? { ...toast, leaving: true } : toast,
      );
    });

    if (removalTimers.current.has(id)) return;

    const timer = window.setTimeout(() => {
      removalTimers.current.delete(id);
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, EXIT_ANIMATION_MS);

    removalTimers.current.set(id, timer);
  }, []);

  // A provider can unmount during a logout or hot reload; drop any pending
  // removal callbacks with it so nothing writes state after teardown.
  useEffect(() => {
    const timers = removalTimers.current;

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const push = useCallback(
    (variant, message, options) => {
      const text = String(message ?? "").trim();
      if (!text) return null;

      const id = ++nextId.current;
      const duration = resolveDuration(variant, options);

      setToasts((prev) => {
        // Coalesce an identical visible message instead of stacking a second
        // copy: the newest occurrence replaces (and restarts) the old one.
        const withoutDuplicate = prev.filter(
          (toast) => !(toast.variant === variant && toast.message === text),
        );

        return [
          { id, variant, message: text, duration, leaving: false },
          ...withoutDuplicate,
        ].slice(0, MAX_QUEUE);
      });

      return id;
    },
    [],
  );

  const toast = useMemo(
    () => ({
      success: (message, options) => push("success", message, options),
      error: (message, options) => push("error", message, options),
      warning: (message, options) => push("warning", message, options),
      info: (message, options) => push("info", message, options),
      dismiss,
    }),
    [push, dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts.slice(0, MAX_VISIBLE)} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx.toast;
}

/**
 * The toast API when a provider is present, else null.
 *
 * For providers that only OPTIONALLY surface feedback — the offline queue
 * batches a sync toast, but must keep working (and stay testable) without a
 * ToastProvider mounted above it.
 */
export function useOptionalToast() {
  return useContext(ToastContext)?.toast ?? null;
}
