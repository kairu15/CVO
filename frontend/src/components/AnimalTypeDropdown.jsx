/**
 * The animal-type filter for the monitoring table.
 *
 * Options are the distinct types the API reports for the caller's records —
 * only types that actually have rows appear (same rule as the month dropdown),
 * so the list reflects what was imported or registered rather than a hardcoded
 * vocabulary. "All animal types" clears the filter.
 *
 * Combining with the month dropdown is the server's job: both are query
 * parameters ANDed in the database, so "Boar" + "Dec 2026" shows only boar
 * rows monitored that month.
 *
 * @param {object} props
 * @param {string[]} [props.types] distinct types from the API, alphabetical
 * @param {string|null} [props.selected] active type, or null for all
 * @param {(type: string|null) => void} props.onSelect
 * @param {boolean} [props.disabled] render inert while the list is loading
 */
export function AnimalTypeDropdown({ types = [], selected = null, onSelect, disabled = false }) {
  return (
    <label className="flex items-center">
      <span className="sr-only">Filter by animal type</span>
      <select
        className="field w-full sm:w-44"
        value={selected ?? ""}
        onChange={(event) => onSelect(event.target.value || null)}
        disabled={disabled}
        aria-label="Filter by animal type"
      >
        <option value="">All animal types</option>
        {types.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
    </label>
  );
}
