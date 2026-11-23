import { Icon } from "./Icons";

/**
 * The one search field used by every filter panel.
 *
 * A consistent height, icon position, placeholder treatment and clear button
 * across modules — the pages used to each size their own search input, so the
 * box jumped height and clipped its placeholder from screen to screen.
 *
 * The clear button appears only when there is text, and it calls `onChange`
 * with an empty string so the caller's existing debounce / URL sync runs as it
 * would for any other keystroke.
 *
 * @param {object} props
 * @param {string} props.id input id (also used by the label)
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.label] visible label above the field
 * @param {string} [props.placeholder]
 * @param {string} [props.ariaLabel] accessible name when the label is hidden
 * @param {string} [props.className] wrapper layout class
 * @param {string} [props.inputClassName] extra input classes
 */
export function SearchField({
  id,
  value,
  onChange,
  label = "Search",
  placeholder = "Search…",
  ariaLabel,
  className = "",
  inputClassName = "",
}) {
  return (
    <div className={`filter-field filter-field--search ${className}`.trim()}>
      {label ? (
        <label htmlFor={id} className="filter-label">
          {label}
        </label>
      ) : null}

      <div className="relative min-w-0">
        <Icon
          name="search"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
        />
        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel ?? label ?? placeholder}
          className={`field pr-10 pl-9 ${inputClassName}`.trim()}
        />

        {value !== "" && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-brand-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
