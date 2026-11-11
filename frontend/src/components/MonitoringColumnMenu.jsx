/**
 * Column visibility for the monitoring sheet.
 *
 * Nineteen columns mirror the CVO Excel sheet and belong in the export, but
 * they are poor for scanning. This menu lets each administrator keep the
 * sheet's shape while hiding what they do not need; the choice is remembered
 * per browser by the caller.
 *
 * @param {object} props
 * @param {Array<{key: string, label: string}>} props.columns
 * @param {string[]} props.visible currently visible column keys
 * @param {(columns: string[]) => void} props.onChange
 * @param {string[]} props.compact the Compact preset's keys
 */
export function MonitoringColumnMenu({ columns, visible, onChange, compact }) {
  function toggle(key) {
    const next = visible.includes(key)
      ? visible.filter((entry) => entry !== key)
      : [...visible, key];

    // An empty table is never useful; the last visible column stays.
    onChange(next.length > 0 ? next : visible);
  }

  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-pill border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        Columns
      </summary>

      <div className="absolute right-0 z-30 mt-1 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
        <div className="flex items-center gap-1 border-b border-slate-100 pb-2">
          <button
            type="button"
            onClick={() => onChange(compact)}
            className="rounded-pill px-2.5 py-1 text-[11px] font-semibold text-brand-700 transition hover:bg-brand-50"
          >
            Compact
          </button>
          <button
            type="button"
            onClick={() => onChange(columns.map((column) => column.key))}
            className="rounded-pill px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100"
          >
            Show all
          </button>
        </div>

        <div className="mt-1 max-h-72 overflow-y-auto">
          {columns.map((column) => (
            <label
              key={column.key}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-700 transition hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded accent-brand-700"
                checked={visible.includes(column.key)}
                onChange={() => toggle(column.key)}
              />
              {column.label}
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}
