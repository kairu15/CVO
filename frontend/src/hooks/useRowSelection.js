import { useCallback, useState } from "react";

/**
 * Row-selection state for a table with a "Select all" checkbox.
 *
 * Kept in one place so every list screen selects the same way: a set of ids,
 * a per-row toggle, and a select-all that only ever acts on the ids the
 * caller passes in (the rows currently rendered), never a hidden page.
 */
export function useRowSelection() {
  const [selected, setSelected] = useState(() => new Set());

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /**
   * Tick every id when they are not all ticked, otherwise untick them all.
   * Empty input is a no-op.
   */
  const toggleAll = useCallback((ids) => {
    setSelected((prev) => {
      if (ids.length === 0) return prev;

      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));

      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }

      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, toggle, toggleAll, clear };
}
