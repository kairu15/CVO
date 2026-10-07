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
  resolveConflict as resolveConflictItem,
  subscribe,
} from "../lib/offlineQueue";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useOptionalToast } from "./ToastContext";

/**
 * App-wide view of the offline submission queue.
 *
 * Owns the pieces the UI needs — how many submissions are waiting, which of
 * them failed or hit a conflict, and whether a sync is running — and triggers
 * a flush whenever the browser comes back online (and once at startup, in case
 * the tab was closed before the last reconnect).
 *
 * Sync feedback is BATCHED: a flush that syncs several items fires one toast,
 * not one per item, so a reconnect after a week offline doesn't bury the
 * screen in notifications.
 */
const OfflineQueueContext = createContext(null);

export function OfflineQueueProvider({ children }) {
  const online = useOnlineStatus();
  // Optional: the provider works without a ToastProvider (e.g. in tests).
  const toast = useOptionalToast();
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
      const summary = await flushQueue();

      // One toast for the whole pass — never one per item. A conflict or a
      // failure is also surfaced in the list with its reason; the toast is a nudge.
      if (summary.synced === 1) toast?.success("1 saved change synced.");
      else if (summary.synced > 1) {
        toast?.success(`${summary.synced} saved changes synced successfully.`);
      }

      if (summary.conflicts > 0) {
        toast?.info(
          summary.conflicts === 1
            ? "1 saved change needs your review — the record changed on the server."
            : `${summary.conflicts} saved changes need your review — their records changed on the server.`,
        );
      }

      if (summary.failed > 0) {
        toast?.error(
          summary.failed === 1
            ? "1 saved change couldn't sync — open the sync list to fix it."
            : `${summary.failed} saved changes couldn't sync — open the sync list to fix them.`,
        );
      }
    } catch {
      // Storage unavailable — leave the queue untouched.
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [refresh, toast]);

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
  const hasPending = items.some((item) => item.status === "pending");
  useEffect(() => {
    if (online && hasPending) flush();
  }, [online, hasPending, flush]);

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

  const resolveConflict = useCallback(
    async (id, decision) => {
      try {
        await resolveConflictItem(id, decision);
      } catch {
        return;
      }
      await refresh();
    },
    [refresh],
  );

  const value = useMemo(() => {
    const byStatus = (status) => items.filter((item) => item.status === status);

    const pending = byStatus("pending").length + byStatus("syncing").length;
    const errors = byStatus("error").length;
    const conflicts = byStatus("conflict").length;

    return {
      online,
      syncing,
      items,
      pendingCount: pending,
      errorCount: errors,
      conflictCount: conflicts,
      syncedCount: byStatus("synced").length,
      // Everything that still needs the technician's eye or a connection.
      activeCount: pending + errors + conflicts,
      flush,
      retry,
      remove,
      resolveConflict,
    };
  }, [online, syncing, items, flush, retry, remove, resolveConflict]);

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
