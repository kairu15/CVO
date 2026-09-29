import { useEffect, useMemo, useRef, useState } from "react";
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
 * Group the month keys by year, newest year first, months Jan → Dec within
 * each group. The backend delivers chronological keys; grouping by the
 * "YYYY-MM" prefix keeps the year buckets and calendar order for free.
 *
 * @param {string[]} months "YYYY-MM" keys from the API
 * @returns {{ year: string, keys: string[] }[]}
 */
function groupByYear(months) {
  const byYear = new Map();

  for (const key of [...months].sort()) {
    const year = key.slice(0, 4);
    const bucket = byYear.get(year);

    if (bucket) bucket.push(key);
    else byYear.set(year, [key]);
  }

  return [...byYear.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, keys]) => ({ year, keys }));
}

/**
 * The month/year filter for the monitoring table, as one dropdown instead of
 * a pill row.
 *
 * Options come from the API's month list — only months that actually have
 * records appear (the same rule the Excel export uses to emit one sheet per
 * month), grouped under a small year heading, newest year first. "All months"
 * lets the unfiltered table coexist with the month view without hiding data
 * behind a default bucket.
 *
 * The listbox is keyboard accessible (arrows / Home / End, Enter, Escape,
 * Tab) and closes on click-outside; the selection is highlighted with the
 * same brand-* tokens the active pill used. Focus stays on the trigger and
 * `aria-activedescendant` tracks the highlighted option, the way a native
 * select behaves.
 *
 * @param {object} props
 * @param {string[]} [props.months] "YYYY-MM" keys, oldest → newest from the API
 * @param {string|null} [props.selected] the active month key, or null for all
 * @param {(month: string|null) => void} props.onSelect
 * @param {boolean} [props.disabled] render inert while the list is loading
 */
export function MonthYearDropdown({
  months = [],
  selected = null,
  onSelect,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const wasOpen = useRef(false);

  // Defensive chronological sort: the backend already delivers oldest →
  // newest, but a locally built list (tests, future callers) must not be
  // able to un-sort the option order — "YYYY-MM" sorts chronologically as
  // text. "All months" always sits first.
  const groups = useMemo(() => groupByYear(months), [months]);
  const options = useMemo(
    () => [
      { key: null, label: "All months" },
      ...groups.flatMap((group) => group.keys.map((key) => ({ key, label: monthTabLabel(key) }))),
    ],
    [groups],
  );

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.key === selected),
  );
  // Derived from `selected`, not the options list: if the selected month's
  // records are deleted server-side and it drops out of the list, the
  // trigger keeps telling the truth about the filter that still applies.
  const selectedLabel = selected ? monthTabLabel(selected) : "All months";

  /** Open the list with the highlight parked on the current selection. */
  function openList() {
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  /** Click outside → close. */
  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  /** Re-focus the trigger when the list closes (never on first mount). */
  useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  /** Keep the highlighted option visible while arrowing through the list. */
  useEffect(() => {
    if (!open || !listRef.current) return;

    const active = listRef.current.querySelector(`#monitoring-month-option-${activeIndex}`);

    // jsdom (and some embedded browsers) lack scrollIntoView.
    if (typeof active?.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex]);

  function choose(key) {
    setOpen(false);
    onSelect(key);
  }

  function onTriggerClick() {
    if (open) setOpen(false);
    else openList();
  }

  function onTriggerKeyDown(event) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (!open) openList();
    }
  }

  function onListKeyDown(event) {
    const last = options.length - 1;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((current) => Math.min(current + 1, last));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((current) => Math.max(current - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(last);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(options[activeIndex]?.key ?? null);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        // Close without choosing, matching native <select> behavior.
        setOpen(false);
        break;
      default:
        break;
    }
  }

  if (groups.length === 0) return null;

  return (
    <div
      ref={containerRef}
      // Full width on mobile; a fixed desktop basis so the Excel buttons sit
      // beside it in the filter row instead of wrapping below (w-full as a
      // flex item would claim the whole line).
      className="relative w-full sm:w-72"
      onKeyDown={open ? onListKeyDown : undefined}
    >
      {/* Trigger — the `field` input recipe, with the same calendar icon the
          "All months" pill used and brand tokens for the open/active state. */}
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label="Filter monitoring records by month"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls="monitoring-month-listbox"
        aria-activedescendant={open ? `monitoring-month-option-${activeIndex}` : undefined}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
        disabled={disabled}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border bg-white px-3.5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
          open
            ? "border-brand-400 ring-4 ring-brand-400/25"
            : "border-slate-300 hover:border-brand-400 hover:bg-brand-50"
        } ${selected === null ? "text-brand-800" : "text-slate-900"}`}
      >
        <span className="flex items-center gap-2">
          <Icon name="calendar" className="h-4 w-4" />
          {selectedLabel}
        </span>
        <Icon
          name="chevron-down"
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id="monitoring-month-listbox"
          role="listbox"
          aria-label="Filter monitoring records by month"
          className="absolute left-0 right-0 z-40 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-panel"
        >
          <li
            id="monitoring-month-option-0"
            role="option"
            aria-selected={selected === null}
            onClick={() => choose(null)}
            onMouseEnter={() => setActiveIndex(0)}
            className={`flex cursor-pointer items-center gap-2 px-3.5 py-2 text-sm font-semibold ${
              activeIndex === 0 ? "bg-brand-50 text-brand-800" : "text-slate-600"
            }`}
          >
            <Icon name="calendar" className="h-3.5 w-3.5" />
            All months
            {selected === null && (
              <Icon name="check" className="ml-auto h-4 w-4 text-brand-700" />
            )}
          </li>

          {groups.map((group) => {
            // Option indices continue across groups (0 is "All months").
            const groupStart = options.findIndex((option) => option.key === group.keys[0]);

            return (
              <li key={group.year} role="presentation" className="mt-1">
                <p className="px-3.5 py-1 text-[11px] font-semibold tracking-[0.14em] text-slate-400 uppercase">
                  {group.year}
                </p>
                <ul role="presentation">
                  {group.keys.map((key, offset) => {
                    const index = groupStart + offset;
                    const isSelected = key === selected;

                    return (
                      <li
                        key={key}
                        id={`monitoring-month-option-${index}`}
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => choose(key)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={`flex cursor-pointer items-center px-3.5 py-2 text-sm ${
                          activeIndex === index ? "bg-brand-50 text-brand-800" : "text-slate-600"
                        }`}
                      >
                        <span className="font-medium">{monthTabLabel(key)}</span>
                        {isSelected && (
                          <Icon name="check" className="ml-auto h-4 w-4 text-brand-700" />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
