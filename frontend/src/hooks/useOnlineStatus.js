import { useEffect, useState } from "react";

/**
 * Live browser connectivity.
 *
 * `navigator.onLine` is a coarse signal (it answers "is there a network
 * interface", not "can we reach the API"), but it is exactly the signal the
 * reconnect events fire on, so it is what drives the offline banner and the
 * queue's auto-flush. A request can still fail while this reads true — the
 * forms handle that case by queueing on transport failure too.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
