import { useEffect, useState } from "react";

/**
 * Mirror `value` into state, but only commit changes after `delay` ms of
 * quiet. Keeps keystroke-driven API calls from firing on every character —
 * pair with a useEffect keyed on the debounced value.
 *
 * @template T
 * @param {T} value
 * @param {number} [delay=300]
 * @returns {T}
 */
export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
