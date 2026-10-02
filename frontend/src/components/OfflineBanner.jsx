import { useState } from "react";
import { useOfflineQueue } from "../context/OfflineQueueContext";
import { Icon } from "./Icons";
import { ButtonSpinner } from "./LoadingSpinner";

/**
 * Offline / pending-sync strip for the dashboard shell.
 *
 * Appears only when it has something to say: the device is offline, or there
 * are submissions waiting to sync. The count is the whole signal at a glance;
 * expanding it lists each queued item so a failed one can be retried or
 * discarded rather than silently dropped.
 */
const STATUS_LABEL = {
  pending: "Waiting to sync",
  error: "Needs attention",
};

export function OfflineBanner() {
  const { online, syncing, items, pendingCount, errorCount, flush, retry, remove } =
    useOfflineQueue();
  const [open, setOpen] = useState(false);

  // Nothing to report: online and everything synced.
  if (online && pendingCount === 0) return null;

  const hasErrors = errorCount > 0;
  const tone = hasErrors
    ? "border-amber-300 bg-amber-50 text-amber-900"
    : "border-slate-300 bg-slate-50 text-slate-700";

  return (
    <section className={`mb-5 rounded-xl border px-4 py-3 text-xs ${tone}`} aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Icon name="refresh" className="h-4 w-4 shrink-0" />

        <p className="font-medium">
          {!online
            ? "You're offline. Field visits and case notes are saved on this device and sync automatically when you reconnect."
            : `${pendingCount} saved ${
                pendingCount === 1 ? "change" : "changes"
              } waiting to sync.`}
        </p>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="rounded-pill bg-white px-3 py-1 font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
          >
            Pending sync ({pendingCount})
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
          {items.length === 0 ? (
            <li className="text-[11px] text-slate-500">Nothing waiting to sync.</li>
          ) : (
            items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{item.label ?? item.kind}</p>
                  <p className="text-[11px] opacity-80">
                    {STATUS_LABEL[item.status] ?? item.status}
                    {item.error ? ` — ${item.error}` : ""}
                  </p>
                </div>

                {item.status === "error" && (
                  <button
                    type="button"
                    onClick={() => retry(item.id)}
                    disabled={!online || syncing}
                    className="rounded-pill bg-white px-2.5 py-0.5 font-semibold text-brand-800 ring-1 ring-brand-200 transition hover:bg-brand-50 disabled:opacity-50"
                  >
                    Retry
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  className="rounded-pill bg-white px-2.5 py-0.5 font-semibold text-red-700 ring-1 ring-red-200 transition hover:bg-red-50"
                >
                  Discard
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
}
