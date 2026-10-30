import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icons";

/**
 * The dispersal map's date selector: previous / next day buttons (stepping
 * through the dates THAT HAVE RECORDS), a dropdown listing them newest first
 * with the day's pin count, a native date input for arbitrary days, and the
 * "Latest" chip with a jump button when an older day is on view.
 *
 * Keyboard: ArrowLeft / ArrowRight step through the dates with records when
 * the selector has focus; every control is a real button/select and
 * reachable by tab. At narrow widths the row wraps cleanly.
 */

function formatDay(iso) {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * @param {object} props
 * @param {Array<{date: string, event_count: number, barangay_count: number}>} props.dates
 *   newest first — the dates that have records
 * @param {string|null} props.selectedDate
 * @param {(date: string) => void} props.onSelectDate
 * @param {string} props.mode
 * @param {(mode: string) => void} props.onModeChange
 * @param {string|null} props.latestDate
 * @param {() => void} props.onJumpToLatest
 */
export function DateSelector({
  dates = [],
  selectedDate = null,
  onSelectDate,
  mode = "on",
  onModeChange,
  latestDate = null,
  onJumpToLatest,
}) {
  const [open, setOpen] = useState(false);
  const listRef = useRef(null);

  const dateIndex = useMemo(() => {
    if (!selectedDate) return -1;
    return dates.findIndex((entry) => entry.date === selectedDate);
  }, [dates, selectedDate]);

  const step = (offset) => {
    if (dates.length === 0) return;
    const next = Math.min(dates.length - 1, Math.max(0, (dateIndex === -1 ? 0 : dateIndex) + offset));
    const target = dates[next];
    if (target && target.date !== selectedDate) onSelectDate(target.date);
  };

  // Arrow keys step through the dates that have records, exactly like the
  // ‹ › buttons; the date input covers days without records.
  const onKeyDown = (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(1); // left = older (the list reads newest first)
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(-1); // right = newer
    }
  };

  // Close the dropdown on outside clicks / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (event) => {
      if (!listRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = dates.find((entry) => entry.date === selectedDate);
  const viewingHistory = Boolean(latestDate && selectedDate && selectedDate < latestDate);

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Map date and mode"
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-1" tabIndex={0} aria-label="Step through dates with records (arrow keys)">
        <button
          type="button"
          onClick={() => step(1)}
          disabled={dates.length === 0 || dateIndex >= dates.length - 1}
          className="grid h-8 w-8 place-items-center rounded-md bg-white text-slate-600 ring-1 ring-slate-300 transition hover:text-brand-700 disabled:opacity-40"
          aria-label="Previous date with records"
        >
          <Icon name="arrow-left" className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={dates.length === 0 || dateIndex <= 0}
          className="grid h-8 w-8 place-items-center rounded-md bg-white text-slate-600 ring-1 ring-slate-300 transition hover:text-brand-700 disabled:opacity-40"
          aria-label="Next date with records"
        >
          <Icon name="arrow-right" className="h-4 w-4" />
        </button>
      </div>

      {/* The dates-with-records dropdown: newest first, counts beside each. */}
      <div className="relative" ref={listRef}>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="inline-flex items-center gap-2 rounded-pill bg-brand-700 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-800"
        >
          <Icon name="map-pin" className="h-3.5 w-3.5" />
          {selectedDate
            ? `${formatDay(selectedDate)}${selected ? ` · ${selected.event_count}` : ""}`
            : "Pick a date"}
          <Icon name="chevron-down" className="h-3 w-3" />
        </button>

        {open && (
          <ul
            role="listbox"
            aria-label="Dates with records, newest first"
            className="absolute left-0 top-full z-[650] mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            {dates.map((entry) => (
              <li key={entry.date}>
                <button
                  type="button"
                  role="option"
                  aria-selected={entry.date === selectedDate}
                  onClick={() => {
                    onSelectDate(entry.date);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition hover:bg-brand-50 dark:hover:bg-slate-700 ${
                    entry.date === selectedDate ? "bg-brand-50 font-semibold text-brand-800 dark:bg-slate-700" : "text-slate-700 dark:text-slate-200"
                  }`}
                >
                  <span>{formatDay(entry.date)}</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {entry.event_count} event{entry.event_count === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Arbitrary dates — days without records answer an empty map, which
          is the honest answer for "what happened on the 4th?". */}
      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="sr-only">Pick any date</span>
        <input
          type="date"
          value={selectedDate ?? ""}
          onChange={(event) => onSelectDate(event.target.value)}
          className="field !w-auto !py-1.5 text-xs"
          aria-label="Pick any date"
        />
      </label>

      {viewingHistory && (
        <button
          type="button"
          onClick={onJumpToLatest}
          className="inline-flex items-center gap-1.5 rounded-pill bg-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-800 transition hover:bg-brand-200"
        >
          <Icon name="refresh" className="h-3 w-3" />
          Jump to latest
        </button>
      )}
      {latestDate && selectedDate === latestDate && (
        <span className="rounded-pill bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800">
          Latest
        </span>
      )}

      {/* The mode toggle: the two meanings of "by date". */}
      <div className="ml-auto flex flex-wrap items-center gap-2" role="group" aria-label="Date mode">
        {[
          { key: "on", label: "On this date" },
          { key: "as_of", label: "As of this date" },
        ].map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={mode === option.key}
            onClick={() => onModeChange(option.key)}
            className={`rounded-pill px-3 py-1.5 text-xs font-semibold transition-colors ${
              mode === option.key
                ? "bg-brand-700 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-800 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default DateSelector;
