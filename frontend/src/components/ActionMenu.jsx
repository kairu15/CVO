import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/**
 * The compact row-action menu used by the beneficiary directory.
 *
 * Three inline links per row made the busiest column on the page; the same
 * actions fit in one menu without hiding anything. Closes on an outside click
 * and on Escape, and every item stays a real button/link so keyboard and
 * screen-reader navigation behave normally.
 *
 * @param {object} props
 * @param {string} [props.label] accessible name of the trigger
 * @param {Array<{label: string, onClick?: () => void, to?: string, ariaLabel?: string, key?: string}>} props.items
 * @param {"left"|"right"} [props.align] which edge the panel opens from
 */
export function ActionMenu({ label = "Actions", items = [], align = "right" }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const itemClass =
    "block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-brand-50 hover:text-brand-900 focus-visible:bg-brand-50 focus-visible:outline-none";

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          ⋯
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute z-20 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item) =>
            item.to ? (
              <Link
                key={item.key ?? item.label}
                to={item.to}
                role="menuitem"
                aria-label={item.ariaLabel}
                className={itemClass}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.key ?? item.label}
                type="button"
                role="menuitem"
                aria-label={item.ariaLabel}
                className={itemClass}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
