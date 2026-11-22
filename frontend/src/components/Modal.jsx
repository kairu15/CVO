import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Minimal accessible modal dialog.
 *
 * Renders over a click-away surface, closes on Escape, locks body scroll, and
 * can optionally trap/restore focus and animate its entrance and exit. Content
 * is a plain function of props so callers keep full control of the interior
 * layout.
 *
 * The dialog is portalled to document.body: an ancestor with `backdrop-filter`
 * or `transform` (the sticky header's blur, for one) becomes the containing
 * block for `position: fixed` descendants, which would clip and misplace the
 * overlay. Portalling keeps the dialog pinned to the viewport no matter where
 * in the tree it is mounted.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} props.title
 * @param {() => void} props.onClose
 * @param {string} [props.contentClassName] width override for the dialog card
 * @param {string} [props.titleClassName] size override for the title
 * @param {boolean} [props.closeDisabled] disables the X and Escape dismissal
 * @param {boolean} [props.trapFocus] keep Tab focus inside the dialog
 * @param {import("react").RefObject<HTMLElement>} [props.initialFocusRef]
 * @param {import("react").RefObject<HTMLElement>} [props.returnFocusRef]
 * @param {string} [props.describedById]
 * @param {boolean} [props.animated] fade/scale the backdrop and panel
 * @param {boolean} [props.closing] play the exit animation before unmounting
 * @param {import("react").ReactNode} props.children
 */
export function Modal({
  open,
  title,
  onClose,
  contentClassName,
  titleClassName,
  closeDisabled = false,
  trapFocus = false,
  initialFocusRef,
  returnFocusRef,
  describedById,
  animated = false,
  closing = false,
  children,
}) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  });

  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = document.activeElement;
    // Capture the caller-provided restore target before teardown; reading the
    // ref inside the cleanup would use whatever it points to later.
    const returnFocusTarget = returnFocusRef?.current ?? null;

    function onKeyDown(event) {
      if (event.key === "Escape") {
        if (closeDisabledRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (!trapFocus || event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll(FOCUSABLE) ?? [],
      ).filter(
        (node) =>
          !node.hasAttribute("hidden") &&
          node.getAttribute("aria-hidden") !== "true",
      );

      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const inside = dialogRef.current?.contains(active);

      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    let frame = null;
    if (trapFocus) {
      frame = window.requestAnimationFrame(() => {
        const target =
          initialFocusRef?.current ??
          dialogRef.current?.querySelector(FOCUSABLE);
        target?.focus();
      });
    }

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(frame);

      if (trapFocus) {
        const target = returnFocusTarget ?? previousFocusRef.current;
        if (target instanceof HTMLElement && target.isConnected) target.focus();
      }
    };
  }, [open, trapFocus, initialFocusRef, returnFocusRef]);

  if (!open) return null;

  const backdropAnimation = animated
    ? closing
      ? "modal-backdrop-exit"
      : "modal-backdrop-enter"
    : "";
  const panelAnimation = animated
    ? closing
      ? "modal-panel-exit"
      : "modal-panel-enter"
    : "";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={closeDisabled ? undefined : onClose}
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm dark:bg-black/60 ${backdropAnimation}`}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={describedById}
        tabIndex={-1}
        className={`card relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6 outline-none ${contentClassName ?? ""} ${panelAnimation}`}
      >
        <div className="flex items-start justify-between gap-4">
          <h3 className={`font-display text-lg font-bold text-slate-900 ${titleClassName ?? ""}`}>
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Close dialog"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-brand-100 dark:hover:text-brand-700"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
