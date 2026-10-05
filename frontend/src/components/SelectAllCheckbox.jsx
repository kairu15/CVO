import { useEffect, useRef } from "react";

/**
 * The header checkbox that ticks every row currently shown.
 *
 * Reflects three states: unchecked (none selected), indeterminate (some),
 * checked (all). Indeterminate is a DOM property, not an attribute, so it is
 * set imperatively via a ref.
 *
 * @param {object} props
 * @param {Array<number|string>} props.ids ids the header controls (visible rows)
 * @param {Set<number|string>} props.selected currently selected ids
 * @param {(ids: Array) => void} props.onToggleAll
 * @param {string} [props.label]
 */
export function SelectAllCheckbox({ ids, selected, onToggleAll, label = "Select all rows" }) {
  const ref = useRef(null);

  const total = ids.length;
  const selectedCount = ids.reduce((count, id) => count + (selected.has(id) ? 1 : 0), 0);
  const allChecked = total > 0 && selectedCount === total;
  const someChecked = selectedCount > 0 && !allChecked;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someChecked;
  }, [someChecked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="h-4 w-4 rounded accent-brand-700"
      aria-label={label}
      checked={allChecked}
      disabled={total === 0}
      onChange={() => onToggleAll(ids)}
    />
  );
}
