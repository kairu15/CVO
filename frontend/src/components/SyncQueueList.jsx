import { useOfflineQueue } from "../context/OfflineQueueContext";

/**
 * The list of queued offline submissions and their state.
 *
 * Shared by the header's sync badge and the offline banner so the state
 * vocabulary and the actions live in exactly one place. Each row shows what it
 * is, when/why it is stuck, and only the actions that make sense for its
 * state — a conflict needs a decision, a failure needs a retry, a synced row
 * needs nothing (it clears itself).
 */
const STATUS_LABEL = {
  pending: "Waiting to sync",
  syncing: "Syncing…",
  synced: "Synced",
  error: "Needs attention",
  conflict: "Conflict",
};

const ACTION =
  "rounded-pill bg-white px-2.5 py-0.5 font-semibold ring-1 transition disabled:opacity-50";

export function SyncQueueList({ className = "", emptyText = "Nothing waiting to sync." }) {
  const { online, syncing, items, retry, remove, resolveConflict } = useOfflineQueue();

  if (items.length === 0) {
    return <li className={`text-[11px] text-slate-500 ${className}`}>{emptyText}</li>;
  }

  return (
    <>
      {items.map((item) => (
        <li key={item.id} className={`flex flex-wrap items-start gap-x-3 gap-y-1 ${className}`}>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-slate-800">{item.label ?? item.kind}</p>
            <p className="text-[11px] text-slate-500">
              {STATUS_LABEL[item.status] ?? item.status}
              {item.error ? ` — ${item.error}` : ""}
            </p>

            {item.status === "conflict" && (
              <p className="mt-1 text-[11px] text-amber-800">
                This record was updated by someone else since you went offline —
                your changes will overwrite theirs.
              </p>
            )}
          </div>

          {item.status === "conflict" && (
            <>
              <button
                type="button"
                onClick={() => resolveConflict(item.id, "overwrite")}
                disabled={!online || syncing}
                className={`${ACTION} text-amber-900 ring-amber-300 hover:bg-amber-50`}
              >
                Overwrite
              </button>
              <button
                type="button"
                onClick={() => resolveConflict(item.id, "keep_server")}
                className={`${ACTION} text-slate-700 ring-slate-200 hover:bg-slate-100`}
              >
                Keep theirs
              </button>
            </>
          )}

          {item.status === "error" && (
            <button
              type="button"
              onClick={() => retry(item.id)}
              disabled={!online || syncing}
              className={`${ACTION} text-brand-800 ring-brand-200 hover:bg-brand-50`}
            >
              Retry
            </button>
          )}

          {item.status !== "synced" && item.status !== "syncing" && (
            <button
              type="button"
              onClick={() => remove(item.id)}
              className={`${ACTION} text-red-700 ring-red-200 hover:bg-red-50`}
            >
              Discard
            </button>
          )}
        </li>
      ))}
    </>
  );
}
