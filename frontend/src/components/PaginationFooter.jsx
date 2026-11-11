import { Icon } from "./Icons";

/**
 * The shared list footer: "Showing X of Y <noun>" on the left, and
 * Prev / Page X of Y / Next on the right.
 *
 * One component so every paginated table and list reads the same way, rather
 * than each page inventing its own footer. It renders nothing until there is
 * more than one page, so a short list carries no dead controls.
 *
 * @param {object} props
 * @param {{total?: number, current_page?: number, last_page?: number}} props.meta
 *   the paginator `meta` from the API envelope
 * @param {number} props.shown rows rendered on the current page
 * @param {string} [props.noun] singular row label ("record", "animal", …)
 * @param {string} [props.plural] plural override when appending "s" would be
 *   wrong ("beneficiaries", "notes" is fine, …)
 * @param {(page: number) => void} props.onPageChange
 * @param {number} [props.pageSize] current rows per page (optional selector)
 * @param {number[]} [props.pageSizeOptions] e.g. [25, 50]
 * @param {(size: number) => void} [props.onPageSizeChange]
 */
export function PaginationFooter({
  meta,
  shown,
  noun = "record",
  plural,
  onPageChange,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
}) {
  if (!meta || !meta.total) return null;

  // A single-page list normally carries no dead controls, but when the caller
  // offers a page-size selector that control is still useful.
  if ((!meta.last_page || meta.last_page <= 1) && !pageSizeOptions?.length) return null;

  const total = meta.total ?? shown;
  const page = meta.current_page ?? 1;
  const lastPage = meta.last_page ?? 1;
  const label = total === 1 ? noun : (plural ?? `${noun}s`);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-600 dark:border-slate-200/60 dark:text-slate-400">
      <span>
        Showing {shown} of {total} {label}
      </span>

      <div className="flex items-center gap-3">
        {pageSizeOptions?.length > 0 && onPageSizeChange && (
          <label className="flex items-center gap-1.5">
            <span className="sr-only">Rows per page</span>
            <select
              className="rounded-pill border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-200/60 dark:bg-transparent dark:text-slate-300"
              value={pageSize ?? pageSizeOptions[0]}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              aria-label="Rows per page"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="inline-flex items-center gap-1 rounded-pill border border-slate-200 bg-white px-3.5 py-1.5 font-medium text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-200/60 dark:bg-transparent dark:hover:bg-slate-100/40"
        >
          <Icon name="chevron-down" className="h-3.5 w-3.5 -rotate-90" />
          Prev
        </button>

        <span className="tabular-nums">
          Page {page} of {lastPage}
        </span>

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= lastPage}
          className="inline-flex items-center gap-1 rounded-pill border border-slate-200 bg-white px-3.5 py-1.5 font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-200/60 dark:bg-transparent dark:text-slate-100 dark:hover:bg-slate-100/40"
        >
          Next
          <Icon name="chevron-down" className="h-3.5 w-3.5 rotate-90" />
        </button>
      </div>
    </div>
  );
}
