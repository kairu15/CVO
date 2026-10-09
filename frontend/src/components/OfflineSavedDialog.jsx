import { useOfflineQueue } from "../context/OfflineQueueContext";
import { Icon } from "./Icons";
import { Modal } from "./Modal";

/**
 * The "your offline submission is safe" moment.
 *
 * The single instant a technician most needs certainty is the one where the
 * Submit button doesn't reach the server: did anything happen to their work?
 * A toast can be missed and the sync badge only shows a count, so the answer
 * is delivered here, modally, in plain language — what was saved, that it
 * lives on THIS device, that sending is automatic — and tied to the persistent
 * sync badge by naming the same count the badge shows, so "the thing I just
 * did" visibly became "one of the N items in that badge".
 *
 * Acknowledging it needs no further action from anyone: the queue syncs on
 * reconnect by itself.
 */
export function OfflineSavedDialog() {
  const { offlineSaved, dismissOfflineSaved, pendingCount } = useOfflineQueue();

  if (!offlineSaved) return null;

  const { noun, label } = offlineSaved;

  return (
    <Modal open title="Saved on this device" onClose={dismissOfflineSaved} contentClassName="!max-w-md">
      <div className="flex items-start gap-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700">
          <Icon name="check" className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            You're currently offline.
          </p>
          <p className="mt-1.5 text-sm text-slate-600">
            {label ? (
              <>
                Your <span className="font-semibold text-slate-900">{noun}</span> —{" "}
                <span className="font-semibold text-slate-900">{label}</span> — has
                been saved on this device.
              </>
            ) : (
              <>
                Your <span className="font-semibold text-slate-900">{noun}</span>{" "}
                has been saved on this device.
              </>
            )}{" "}
            It will be sent automatically once you're back online.
          </p>
        </div>
      </div>

      <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
        The sync badge{" "}
        <span className="inline-block align-middle" aria-hidden="true">
          <Icon name="refresh" className="inline h-3.5 w-3.5 text-slate-500" />
        </span>{" "}
        in the header now shows{" "}
        <span className="font-semibold text-slate-900">
          {pendingCount} {pendingCount === 1 ? "item" : "items"}
        </span>{" "}
        waiting to sync — this {noun} is one of them. Nothing else is needed
        from you.
      </p>

      <div className="mt-5 flex justify-end">
        <button type="button" onClick={dismissOfflineSaved} className="btn-primary">
          Got it
        </button>
      </div>
    </Modal>
  );
}
