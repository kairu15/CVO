import { useState } from "react";
import { useOfflineQueue } from "../context/OfflineQueueContext";
import { Icon } from "./Icons";
import { ButtonSpinner } from "./LoadingSpinner";
import { SyncQueueList } from "./SyncQueueList";

/**
 * Offline / pending-sync strip for the dashboard shell.
 *
 * Appears only when it has something to say: the device is offline, or there
 * are submissions waiting to sync. The count is the whole signal at a glance;
 * expanding it lists each queued item (via the shared SyncQueueList) so a
 * failed or conflicting one can be handled rather than silently dropped.
 */
export function OfflineBanner() {
  const { online, syncing, activeCount, errorCount, conflictCount, flush } =
    useOfflineQueue();
  const [open, setOpen] = useState(false);

  // Nothing to report: online and everything synced.
  if (online && activeCount === 0) return null;

  const hasIssues = errorCount > 0 || conflictCount > 0;
  const tone = hasIssues
    ? "border-amber-300 bg-amber-50 text-amber-900"
    : "border-slate-300 bg-slate-50 text-slate-700";

  return (
    <section className={`mb-5 rounded-xl border px-4 py-3 text-xs ${tone}`} aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Icon name="refresh" className="h-4 w-4 shrink-0" />

        <p className="font-medium">
          {!online
            ? "You're offline. Field visits, case notes and registrations are saved on this device and sync automatically when you reconnect."
            : `${activeCount} saved ${
                activeCount === 1 ? "change" : "changes"
              } waiting to sync.`}
        </p>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="rounded-pill bg-white px-3 py-1 font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
          >
            Pending sync ({activeCount})
          </button>

          <button
            type="button"
            onClick={flush}
            disabled={!online || syncing}
            className="inline-flex items-center gap-1.5 rounded-pill bg-white px-3 py-1 font-semibold text-brand-800 ring-1 ring-brand-200 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing && <ButtonSpinner />}
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      {open && (
        <ul className="mt-3 space-y-2 border-t border-slate-200 pt-3">
          <SyncQueueList />
        </ul>
      )}
    </section>
  );
}
