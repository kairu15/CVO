import { useEffect, useState } from "react";

/**
 * Live browser connectivity, debounced against flapping.
 *
 * `navigator.onLine` is a coarse signal (it answers "is there a network
 * interface", not "can we reach the API"), but it is exactly the signal the
 * reconnect events fire on, so it is what drives the offline banner and the
 * queue's auto-flush. A request can still fail while this reads true — the
 * forms handle that case by queueing on transport failure too.
 *
 * The raw `online`/`offline` events fire for every renegotiation of a weak
 * link, so both are funneled through a short settle window that re-reads
 * `navigator.onLine` and cancels a flip that was immediately contradicted.
 * Without this, a flaky connection thrashes the UI (banner, badge) and
 * retriggers the queue's flush on every blip — and a technician mid-form
 * watches the app flicker between states as they type.
 */
const SETTLE_MS = 1_500;

export function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    let timer = null;

    const settle = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setOnline(navigator.onLine), SETTLE_MS);
    };

    window.addEventListener("online", settle);
    window.addEventListener("offline", settle);

    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("online", settle);
      window.removeEventListener("offline", settle);
    };
  }, []);

  return online;
}
