import { ButtonSpinner } from "./LoadingSpinner";

/**
 * Inline bar that appears above a table once rows are selected: the count, a
 * Clear button, and the destructive bulk Delete (which opens the caller's
 * confirmation dialog rather than deleting immediately).
 *
 * Rendered by the page, not the table, so each screen keeps its own wording
 * and can add extra actions beside Delete.
 *
 * @param {object} props
 * @param {number} props.count number of selected rows (bar hides at 0)
 * @param {() => void} props.onClear
 * @param {() => void} [props.onDelete] omit to render no Delete button
 * @param {boolean} [props.busy] disables the actions while a request runs
 * @param {string} [props.noun] singular noun for the count (e.g. "record")
 * @param {string} [props.plural] plural override when noun + "s" is wrong
 * @param {React.ReactNode} [props.children] extra actions before Delete
 */
export function BulkActionBar({
  count,
  onClear,
  onDelete,
  busy = false,
  noun = "row",
  plural,
  children,
}) {
  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-brand-50/60 px-4 py-2.5 dark:border-slate-200/60 dark:bg-brand-100/40"
    >
      <span className="text-xs font-semibold text-brand-900">
        {count} {count === 1 ? noun : (plural ?? `${noun}s`)} selected
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children}

        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-pill bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <ButtonSpinner className="border-red-200 border-t-white" /> : null}
            Delete selected
          </button>
        )}

        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="rounded-pill px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
