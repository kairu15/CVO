import { useEffect, useRef, useState } from "react";
import { useOfflineQueue } from "../context/OfflineQueueContext";
import { Icon } from "./Icons";
import { ButtonSpinner } from "./LoadingSpinner";
import { SyncQueueList } from "./SyncQueueList";

/**
 * Persistent sync indicator for the dashboard header.
 *
 * A count of everything still to sync (queued, failed or conflicting) that
 * opens into the queue list. It appears whenever there is something to report
 * — offline, or work waiting — so a technician can verify nothing was lost
 * after days in the field, without hunting for the page-level banner.
 */
export function SyncStatusBadge() {
  const { online, syncing, activeCount, errorCount, conflictCount, flush } =
    useOfflineQueue();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Close on an outside click or Escape, like the other header panels.
  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Nothing to say when online with an empty queue — the header stays quiet.
  if (online && activeCount === 0) return null;

  const urgent = errorCount > 0 || conflictCount > 0;
  const tone = urgent
    ? "text-red-700 hover:bg-red-50 dark:hover:bg-red-100"
    : "text-slate-500 hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-100";

  const summary = !online
    ? "Offline"
    : `${activeCount} pending sync`;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Sync status: ${summary}`}
        aria-expanded={open}
        title={summary}
        className={`relative grid h-10 w-10 place-items-center rounded-xl transition ${tone}`}
      >
        <Icon name="refresh" className={`h-5 w-5 ${syncing ? "animate-spin" : ""}`} />
        {activeCount > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold text-white ${
              urgent ? "bg-red-600" : "bg-brand-700"
            }`}
          >
            {activeCount > 9 ? "9+" : activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-12 right-0 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-panel">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
              Sync status
            </p>
            <button
              type="button"
              onClick={flush}
              disabled={!online || syncing}
              className="inline-flex items-center gap-1.5 rounded-pill bg-white px-3 py-1 text-[11px] font-semibold text-brand-800 ring-1 ring-brand-200 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncing && <ButtonSpinner />}
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            {!online
              ? "You're offline. Saved changes are held on this device and sync automatically when you reconnect."
              : "Saved changes waiting to sync. Failed items need a retry; conflicts need your decision."}
          </p>

          <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto border-t border-slate-100 pt-3">
            <SyncQueueList />
          </ul>
        </div>
      )}
    </div>
  );
}
