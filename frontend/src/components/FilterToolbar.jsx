/**
 * Shared building blocks for every filter panel in the CVO system.
 *
 * The panels used to be hand-rolled flex rows with per-page fixed widths
 * (`sm:w-44`, `sm:w-64`, …). When two of those widths met a long option label
 * the control overflowed its neighbour and clipped the text. These primitives
 * replace the fixed widths with one responsive grid:
 *
 * - the primary search field always keeps its own prominent row,
 * - filter fields share the row evenly, wrap naturally, and stack into one
 *   full-width column on a phone,
 * - active filters are echoed as removable chips,
 * - less-used controls sit behind an "Advanced filters" disclosure,
 * - on phones the filters open in a bottom sheet with Apply / Reset, while
 *   search, active chips and the module's action row stay on the page,
 * - actions sit in their own row, so a button can never cover a field.
 *
 * The layout lives in `index.css` (`.filter-panel`, `.filter-toolbar`,
 * `.filter-field`, `.filter-label`, `.filter-actions`, `.filter-footer`,
 * `.filter-sheet`) so the design tokens, dark mode and breakpoints stay in one
 * place.
 */

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

/**
 * The filter panel shell: a visible search section, active-filter chips, the
 * module's action row, and the responsive filter grid.
 *
 * `collapsible` turns the filter grid into a mobile bottom sheet. The search
 * field, chips and action row remain visible on the page; above 640px the sheet
 * becomes a normal, always-visible grid and the open button is hidden.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children `FilterField` items (and any view
 *   controls that belong with the filters)
 * @param {string} [props.className] outer spacing classes
 * @param {React.ReactNode} [props.search] primary search field
 * @param {React.ReactNode} [props.actions] reset / import / export / view row
 * @param {Array<{key: string, label: string, onClear: () => void}>} [props.activeFilters]
 * @param {() => void} [props.onClearAll] clear every active filter
 * @param {() => void} [props.onReset] reset used by the mobile sheet
 * @param {boolean} [props.collapsible] open filters in a mobile bottom sheet
 * @param {string} [props.title] sheet title / toggle label
 */
export function FilterToolbar({
  children,
  className = "",
  search = null,
  actions = null,
  activeFilters = [],
  onClearAll,
  onReset,
  collapsible = false,
  title = "Filters",
}) {
  const [open, setOpen] = useState(false);
  const closeButton = useRef(null);
  const activeCount = activeFilters.filter(Boolean).length;

  // A bottom sheet owns the viewport while it is open: Escape closes it, the
  // page behind it stops scrolling, and focus starts on the close button.
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    closeButton.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const filterButton = collapsible ? (
    <button
      type="button"
      className="filter-toggle"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen(true)}
    >
      <Icon name="sliders" className="h-4 w-4" />
      {title}
      {activeCount > 0 ? (
        <span className="filter-toggle__count" aria-label={`${activeCount} active`}>
          {activeCount}
        </span>
      ) : null}
    </button>
  ) : null;

  return (
    <div className={`filter-panel min-w-0 ${className}`.trim()}>
      {search || actions ? (
        <div className="filter-bar">
          {search ? <div className="filter-search-row">{search}</div> : null}
          <div className="filter-bar__controls">
            {filterButton}
            {actions ? <div className="filter-actions-row">{actions}</div> : null}
          </div>
        </div>
      ) : null}

      {!search && !actions ? filterButton : null}

      <ActiveFilterChips filters={activeFilters} onClearAll={onClearAll} />

      <div
        className={`filter-sheet ${collapsible ? "filter-sheet--sheet" : ""} ${
          open ? "is-open" : ""
        }`.trim()}
      >
        {collapsible ? (
          <button
            type="button"
            className="filter-sheet__backdrop"
            aria-label={`Close ${title.toLowerCase()}`}
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
        ) : null}

        <div className="filter-sheet__panel">
          {collapsible ? (
            <div className="filter-sheet__head">
              <div>
                <p className="filter-sheet__title">{title}</p>
                <p className="filter-sheet__hint">
                  {activeCount > 0
                    ? `${activeCount} active ${activeCount === 1 ? "filter" : "filters"}`
                    : "Narrow the results"}
                </p>
              </div>
              <button
                ref={closeButton}
                type="button"
                className="filter-sheet__close"
                aria-label={`Close ${title.toLowerCase()}`}
                onClick={() => setOpen(false)}
              >
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <div className="filter-toolbar">{children}</div>

          {collapsible ? (
            <div className="filter-sheet__foot">
              <button
                type="button"
                className="filter-reset"
                onClick={() => {
                  onReset?.();
                  setOpen(false);
                }}
                disabled={!onReset}
              >
                Reset filters
              </button>
              <button type="button" className="btn-primary" onClick={() => setOpen(false)}>
                Apply filters
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Removable chips that echo the filters currently narrowing the results.
 * Search is not repeated here: the search field has its own clear button.
 *
 * @param {object} props
 * @param {Array<{key: string, label: string, onClear: () => void}>} props.filters
 * @param {() => void} [props.onClearAll]
 */
export function ActiveFilterChips({ filters = [], onClearAll }) {
  const active = filters.filter(Boolean);
  if (active.length === 0) return null;

  return (
    <div className="filter-chips" aria-label="Active filters">
      <span className="filter-chips__label">Active</span>

      {active.map((filter) => (
        <span key={filter.key} className="filter-chip">
          <span className="filter-chip__text">{filter.label}</span>
          <button
            type="button"
            className="filter-chip__remove"
            aria-label={`Remove filter: ${filter.label}`}
            onClick={filter.onClear}
          >
            <Icon name="close" className="h-3 w-3" />
          </button>
        </span>
      ))}

      {active.length > 1 && onClearAll ? (
        <button type="button" className="filter-chips__clear" onClick={onClearAll}>
          Clear all
        </button>
      ) : null}
    </div>
  );
}

/**
 * Compacts a page's view/export controls on phones.
 *
 * Above 640px the children render inline, exactly where they sit on desktop.
 * On a phone they collapse behind an "Actions" button and open in a small,
 * viewport-safe panel, so the sheet stays focused on filters and the page keeps
 * its view/export controls within one tap. The menu closes on an outside press
 * or Escape.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children buttons / view controls / export links
 * @param {string} [props.label]
 */
export function ResponsiveActionGroup({ children, label = "Actions" }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className="responsive-actions">
      <button
        type="button"
        className="filter-toggle responsive-actions__trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="sliders" className="h-4 w-4" />
        {label}
      </button>
      <div className={`responsive-actions__body ${open ? "is-open" : ""}`.trim()}>
        {children}
      </div>
    </div>
  );
}

/**
 * A disclosure for less frequently used filters. It is a normal grid child, so
 * the nested fields use the same responsive grid without disturbing the
 * primary filter row.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children `FilterField` items
 * @param {number} [props.count] number of active advanced filters
 * @param {string} [props.label]
 */
export function AdvancedFilters({ children, count = 0, label = "Advanced filters" }) {
  return (
    <details className="filter-advanced">
      <summary className="filter-advanced__summary">
        <Icon name="chevron-down" className="filter-advanced__chevron h-4 w-4" />
        <span>{label}</span>
        {count > 0 ? <span className="filter-advanced__count">{count}</span> : null}
      </summary>
      <div className="filter-toolbar filter-toolbar--nested">{children}</div>
    </details>
  );
}

/**
 * One labelled filter control. The label always sits above its input, so rows
 * share a baseline even when the controls are different heights.
 *
 * @param {object} props
 * @param {string} [props.label] visible label; omit for an icon-only control
 * @param {string} [props.htmlFor] id of the input this label describes
 * @param {string} [props.hint] small helper text under the control
 * @param {React.ReactNode} props.children the input / select / custom control
 * @param {string} [props.className] layout modifier (`filter-field--wide`, …)
 */
export function FilterField({
  label,
  htmlFor,
  hint,
  children,
  className = "",
}) {
  return (
    <div className={`filter-field ${className}`.trim()}>
      {label ? (
        <label htmlFor={htmlFor} className="filter-label">
          {label}
        </label>
      ) : null}
      {children}
      {hint ? <p className="text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

/**
 * A right-aligned row for the panel's actions (reset, add, import, export).
 * It always spans the full grid width, so buttons can never overlap a field.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children buttons / links
 * @param {string} [props.className]
 */
export function FilterActions({ children, className = "" }) {
  return (
    <div className={`filter-actions ${className}`.trim()}>{children}</div>
  );
}

/**
 * A full-width row that holds view controls on the left and actions on the
 * right (group-by toggles, column visibility, import/export). Wraps to two
 * columns on narrow screens instead of squeezing everything into one line.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string} [props.className]
 */
export function FilterFooter({ children, className = "" }) {
  return <div className={`filter-footer ${className}`.trim()}>{children}</div>;
}
