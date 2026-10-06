import { useEffect, useState } from "react";

/**
 * A short-lived highlight id that clears itself after `duration` ms.
 *
 * Used for the "you just clicked a notification" feedback: the row or
 * notification is tinted, then the tint is dropped so the `transition-colors`
 * on the element fades it back out — no manual animation needed.
 *
 * Returns `[id, setId]`; call `setId(value)` to start (or restart) a flash.
 * The initial value is honoured, so a destination page can seed it from
 * router state and let it fade on arrival.
 *
 * @param {number|string|null} [initialId]
 * @param {number} [duration]
 * @returns {[number|string|null, (id: number|string|null) => void]}
 */
export function useFlashHighlight(initialId = null, duration = 2200) {
  const [id, setId] = useState(initialId ?? null);

  useEffect(() => {
    if (id === null || id === undefined) return undefined;

    const timer = setTimeout(() => setId(null), duration);

    return () => clearTimeout(timer);
  }, [id, duration]);

  return [id, setId];
}
