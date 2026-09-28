import { useMemo } from "react";
import { Icon } from "./Icons";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-09" → "Sep 2026", matching the Excel export's sheet labels. */
export function monthTabLabel(key) {
  const [year, month] = key.split("-").map(Number);

  if (!year || !month || month < 1 || month > 12) return key;

  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * The month/year tab strip for the monitoring table.
 *
 * Tabs come from the API's month list — only months that actually have
 * records appear (the same rule the Excel export uses to emit one sheet
 * per month), and the backend delivers them chronologically. The selected
 * tab is highlighted; "All months" lets the unfiltered table coexist with
 * the month view without hiding data behind a default bucket.
 *
 * @param {object} props
 * @param {string[]} [props.months] "YYYY-MM" keys, oldest → newest
 * @param {string|null} [props.selected] the active month key, or null for all
 * @param {(month: string|null) => void} props.onSelect
 * @param {boolean} [props.disabled] render inert while the list is loading
 */
export function MonthYearTabs({ months = [], selected = null, onSelect, disabled = false }) {
  // Defensive chronological sort: the backend already delivers oldest →
  // newest, but a locally built list (tests, future callers) must not be
  // able to un-sort the strip — "YYYY-MM" sorts chronologically as text.
  const ordered = useMemo(() => [...months].sort(), [months]);

  if (ordered.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Filter monitoring records by month"
      className="flex flex-wrap items-center gap-2"
    >
      <button
        type="button"
        role="tab"
        aria-selected={selected === null}
        onClick={() => onSelect(null)}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-60 ${
          selected === null
            ? "bg-brand-700 text-white shadow-sm"
            : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-brand-50 hover:text-brand-800"
        }`}
      >
        <Icon name="calendar" className="h-3.5 w-3.5" />
        All months
      </button>

      {ordered.map((key) => {
        const isActive = key === selected;

        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(key)}
            disabled={disabled}
            className={`rounded-pill px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-60 ${
              isActive
                ? "bg-brand-700 text-white shadow-sm"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-brand-50 hover:text-brand-800"
            }`}
          >
            {monthTabLabel(key)}
          </button>
        );
      })}
    </div>
  );
}
