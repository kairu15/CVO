import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  discard as discardItem,
  flushQueue,
  getQueue,
  markPending,
  subscribe,
} from "../lib/offlineQueue";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

/**
 * App-wide view of the offline submission queue.
 *
 * Owns the pieces the UI needs — how many submissions are waiting, which of
 * them failed, and whether a sync is running — and triggers a flush whenever
 * the browser comes back online (and once at startup, in case the tab was
 * closed before the last reconnect).
 */
const OfflineQueueContext = createContext(null);

export function OfflineQueueProvider({ children }) {
  const online = useOnlineStatus();
  const [items, setItems] = useState([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setItems(await getQueue());
    } catch {
      // Storage unavailable (e.g. private browsing) — show nothing rather
      // than breaking the dashboard.
      setItems([]);
    }
  }, []);

  const flush = useCallback(async () => {
    setSyncing(true);
    try {
      await flushQueue();
    } catch {
      // Storage unavailable — leave the queue untouched.
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [refresh]);

  // Mirror the queue store into React state, and keep it fresh on every change
  // (a queued form write, a completed sync, a discard).
  useEffect(() => {
    refresh();
    const unsubscribe = subscribe(() => {
      refresh();
    });

    return unsubscribe;
  }, [refresh]);

  // Flush on (re)connect, and whenever a submission lands in the queue while
  // online — together these catch items queued in a previous session and ones
  // queued just now by a request that never reached the server.
  useEffect(() => {
    if (online && items.length > 0) flush();
  }, [online, items.length, flush]);

  const retry = useCallback(
    async (id) => {
      try {
        await markPending(id);
      } catch {
        return;
      }
      await flush();
    },
    [flush],
  );

  const remove = useCallback(
    async (id) => {
      try {
        await discardItem(id);
      } catch {
        // Nothing to remove if storage is unavailable.
      }
      await refresh();
    },
    [refresh],
  );

  const value = useMemo(
    () => ({
      online,
      syncing,
      items,
      pendingCount: items.length,
      errorCount: items.filter((item) => item.status === "error").length,
      flush,
      retry,
      remove,
    }),
    [online, syncing, items, flush, retry, remove],
  );

  return (
    <OfflineQueueContext.Provider value={value}>
      {children}
    </OfflineQueueContext.Provider>
  );
}

export function useOfflineQueue() {
  const context = useContext(OfflineQueueContext);
  if (!context) {
    throw new Error("useOfflineQueue must be used within an OfflineQueueProvider");
  }
  return context;
}
