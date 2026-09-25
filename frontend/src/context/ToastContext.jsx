import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
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
 *   toast.info("Sync started.");
 *
 * Toasts live above the routed tree so they survive navigation (e.g. the
 * register → sign-in redirect) and stack newest-on-top. Rendering is
 * delegated to `ToastViewport`; this file only owns the queue.
 */
const ToastContext = createContext(null);

/** Default visible lifetime, in milliseconds. */
const DEFAULT_DURATION_MS = 4500;
/** Errors linger a little longer — they usually need reading twice. */
const ERROR_DURATION_MS = 6000;
/** How long the exit animation runs before the node is dropped. */
const EXIT_ANIMATION_MS = 200;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  /** Mark a toast as leaving so the viewport can play the exit animation. */
  const dismiss = useCallback((id) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
    );
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_ANIMATION_MS);
  }, []);

  const push = useCallback(
    (variant, message, duration) => {
      const id = ++nextId.current;
      // Prepend: newest on top, consistently.
      setToasts((prev) => [
        { id, variant, message, duration, leaving: false },
        ...prev,
      ]);
      return id;
    },
    [],
  );

  const toast = useMemo(
    () => ({
      success: (message, duration = DEFAULT_DURATION_MS) => push("success", message, duration),
      error: (message, duration = ERROR_DURATION_MS) => push("error", message, duration),
      info: (message, duration = DEFAULT_DURATION_MS) => push("info", message, duration),
      dismiss,
    }),
    [push, dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx.toast;
}
