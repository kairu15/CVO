import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import { OfflineSavedDialog } from "../components/OfflineSavedDialog";

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
 *
 * The auto-flush is EDGE-TRIGGERED, and that is load-bearing. An earlier
 * version flushed whenever `some(status === "pending")` was true — but every
 * flush attempt flips an item pending → syncing → pending, so the derived
 * boolean fell and rose again and the effect re-armed itself. With the server
 * unreachable ("online" but no route to it — the normal field condition), that
 * looped forever: one request to the dead endpoint every couple of seconds,
 * attempts climbing unbounded, the app re-rendering twice per attempt. It now
 * flushes only when something has actually changed: startup, a reconnect, or
 * a new submission landing while online.
 */
const OfflineQueueContext = createContext(null);

export function OfflineQueueProvider({ children }) {
  const online = useOnlineStatus();
  // Optional: the provider works without a ToastProvider (e.g. in tests).
  const toast = useOptionalToast();
  const [items, setItems] = useState([]);
  const [syncing, setSyncing] = useState(false);
  // The explicit "saved on this device" moment for a submission made offline —
  // { noun, label } — shown once as a dialog (see OfflineSavedDialog).
  const [offlineSaved, setOfflineSaved] = useState(null);

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

  // Edge-triggered auto-flush — see the class comment for why this must not
  // key off a derived "has pending" boolean. null marks "first run".
  const prevOnlineRef = useRef(null);
  const prevCountRef = useRef(null);

  useEffect(() => {
    const prevOnline = prevOnlineRef.current;
    const prevCount = prevCountRef.current;
    prevOnlineRef.current = online;
    prevCountRef.current = items.length;

    const firstRun = prevOnline === null;
    const cameOnline = !firstRun && online && !prevOnline;
    const newItemQueued = !firstRun && items.length > prevCount;

    if (
      online &&
      ((firstRun && items.length > 0) || cameOnline || newItemQueued)
    ) {
      flush();
    }
  }, [online, items, flush]);

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

  /**
   * The moment a form is submitted offline: hand the confirmation to the
   * dialog instead of (or ahead of) any transient toast, so the technician
   * explicitly sees that their work was saved and will sync. `noun` is the
   * plain-language thing saved ("field visit"); `label` the specific row as
   * the sync list shows it ("Field visit — Juan Dela Cruz").
   */
  const notifyOfflineSaved = useCallback(({ noun, label }) => {
    setOfflineSaved({ noun, label });
  }, []);

  const dismissOfflineSaved = useCallback(() => setOfflineSaved(null), []);

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
      offlineSaved,
      notifyOfflineSaved,
      dismissOfflineSaved,
    };
  }, [
    online,
    syncing,
    items,
    flush,
    retry,
    remove,
    resolveConflict,
    offlineSaved,
    notifyOfflineSaved,
    dismissOfflineSaved,
  ]);

  return (
    <OfflineQueueContext.Provider value={value}>
      {children}
      <OfflineSavedDialog />
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

/**
 * The offline-queue API when a provider MAY be present, else null.
 *
 * The form modals surface offline submissions through the queue's dialog, but
 * they are also rendered in tests (and potentially standalone) without the
 * provider mounted above them — there they keep working via the plain toast.
 */
export function useOptionalOfflineQueue() {
  return useContext(OfflineQueueContext);
}

/**
 * Fire the offline-submission confirmation through the queue provider when it
 * is mounted, falling back to the plain toast when it is not (tests,
 * standalone form renders) — the old behaviour.
 *
 * @returns {({ noun: string, label?: string }) => void}
 */
export function useNotifyOfflineSaved() {
  const context = useContext(OfflineQueueContext);
  const toast = useOptionalToast();

  return useCallback(
    ({ noun, label }) => {
      if (context) {
        context.notifyOfflineSaved({ noun, label });
        return;
      }
      toast?.success("Saved on this device — it will sync when you're back online.");
    },
    [context, toast],
  );
}
