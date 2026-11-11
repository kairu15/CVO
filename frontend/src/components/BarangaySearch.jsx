import { useEffect, useId, useMemo, useRef, useState } from "react";
import { normalizeBarangayName } from "../lib/barangayBoundaries";
import { Icon } from "./Icons";

/**
 * The shared map's "Find a barangay" control — a type-ahead combobox.
 *
 * Replaces the long native <select>: typing filters the 28 barangays
 * immediately (diacritics-insensitive, so "suba" matches "Suba (Pob.)"),
 * the full keyboard pattern works (↑/↓ move, Enter picks, Home/End jump,
 * Escape closes — and stops there instead of also closing a records panel
 * underneath), and matches highlight the typed substring. The currently
 * zoomed-to barangay stays in the field with a clear button that hands off
 * to `onClear` (the map's reset view).
 *
 * ARIA combobox/listbox pattern: the input is role=combobox with
 * aria-activedescendant pointing at the highlighted option.
 *
 * @param {object} props
 * @param {string[]} props.names the barangay names, sorted
 * @param {string} [props.value] the currently focused barangay ("" = none)
 * @param {(name: string) => void} props.onSelect zoom to the picked barangay
 * @param {() => void} props.onClear clear the focus (reset view)
 */
export function BarangaySearch({ names, value = "", onSelect, onClear }) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();

  const matches = useMemo(() => {
    const needle = normalizeBarangayName(query);
    if (!needle) return names;
    return names.filter((name) => normalizeBarangayName(name).includes(needle));
  }, [names, query]);

  // The field shows the query while the picker is open, otherwise the
  // barangay currently zoomed to — so an outside reset clears it for free.
  const shown = open ? query : value;

  const openList = () => {
    setOpen(true);
    setActiveIndex(0);
  };

  // Click-away closes the picker.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the highlighted option visible while arrowing through a long list.
  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open]);

  const commit = (name) => {
    setQuery("");
    setOpen(false);
    onSelect(name);
    inputRef.current?.focus();
  };

  const clear = () => {
    setQuery("");
    setOpen(false);
    onClear();
    inputRef.current?.focus();
  };

  const moveActive = (delta) => {
    setActiveIndex((index) => {
      if (matches.length === 0) return 0;
      return (index + delta + matches.length) % matches.length;
    });
  };

  const onKeyDown = (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (open) moveActive(1);
        else openList();
        break;
      case "ArrowUp":
        event.preventDefault();
        if (open) moveActive(-1);
        else openList();
        break;
      case "Home":
        if (!open) break;
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        if (!open) break;
        event.preventDefault();
        setActiveIndex(matches.length - 1);
        break;
      case "Enter":
        // Enter submits nothing else here (the input is not in a form), so
        // the only job is picking the highlighted match.
        if (!open || !matches[activeIndex]) break;
        event.preventDefault();
        commit(matches[activeIndex]);
        break;
      case "Escape":
        if (!open) break;
        // Close ONLY the picker: a records panel or the fullscreen fallback
        // underneath must not react to this Escape too.
        event.preventDefault();
        event.stopPropagation();
        setQuery("");
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  };

  const needle = query.trim().toLowerCase();

  return (
    <div ref={rootRef} className="relative flex-none">
      <div className="relative">
        <Icon
          name="search"
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && matches[activeIndex] ? `${listId}-option-${activeIndex}` : undefined
          }
          aria-label="Find and zoom to a barangay"
          placeholder="Find a barangay…"
          value={shown}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={openList}
          onKeyDown={onKeyDown}
          className="field h-11 w-[13rem] pl-9 pr-9 text-xs"
        />
        {value ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear the barangay search and reset the view"
            title="Clear search and reset the view"
            className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Icon
            name="chevron-down"
            className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
          />
        )}
      </div>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Barangays"
          className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {matches.length === 0 && (
            <li className="px-3 py-2.5 text-xs text-slate-500" role="status">
              No barangay matches &ldquo;{query.trim()}&rdquo;
            </li>
          )}
          {matches.map((name, index) => {
            const active = index === activeIndex;
            const selected = name === value;
            // Highlight the typed substring when a plain case-insensitive
            // match lines up (diacritic folding can shift the offsets, in
            // which case no highlight is shown).
            const at = needle ? name.toLowerCase().indexOf(needle) : -1;
            return (
              <li key={name} id={`${listId}-option-${index}`} role="option" aria-selected={selected}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(name)}
                  className={`flex h-11 w-full items-center gap-2 px-3 text-left text-xs transition-colors ${
                    active
                      ? "bg-brand-50 text-brand-900 dark:bg-slate-800 dark:text-slate-100"
                      : "text-slate-700 dark:text-slate-300"
                  }`}
                >
                  {selected && (
                    <Icon name="check-small" className="h-3.5 w-3.5 shrink-0 text-brand-700" />
                  )}
                  <span className="truncate">
                    {at >= 0 ? (
                      <>
                        {name.slice(0, at)}
                        <mark className="bg-transparent font-bold text-brand-800 dark:text-brand-200">
                          {name.slice(at, at + needle.length)}
                        </mark>
                        {name.slice(at + needle.length)}
                      </>
                    ) : (
                      name
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default BarangaySearch;
