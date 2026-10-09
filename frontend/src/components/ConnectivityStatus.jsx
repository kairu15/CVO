import { useEffect, useRef } from "react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useOptionalToast } from "../context/ToastContext";
import { Icon } from "./Icons";

/**
 * Connectivity indicator for the header — two distinct behaviors:
 *
 *   OFFLINE     A persistent full-width bar under the header row: "You are in
 *               offline mode…". It stays for the entire time the device is
 *               offline — no auto-dismiss, no close button (the condition it
 *               describes is still true). Muted amber, the "normal field
 *               working state" tone, not an alarming error red.
 *
 *   BACK ONLINE A floating success toast: "You are connected online.". Fired
 *               once on the offline→online transition and auto-dismissed after
 *               a few seconds by the existing toast system. Online is therefore
 *               NOT a persistent readout — it is good news that the connection
 *               returned.
 *
 * Detection is the shared, debounced `useOnlineStatus` hook — the same one that
 * drives the offline queue (via OfflineQueueContext). No second listener, and
 * because the hook settles BOTH directions for SETTLE_MS (~1.5s), a brief blip
 * neither flashes the bar on/off nor fires the toast repeatedly.
 *
 * This is intentionally separate from OfflineSavedDialog (the action-triggered
 * "saved on this device" confirmation shown when a form is submitted offline):
 * they describe different things and may be on screen at the same time.
 */
const OFFLINE_MESSAGE =
  "You are in offline mode. All changes will be synced when online.";
const ONLINE_MESSAGE = "You are connected online.";

/** The prompt asks for ~3–4s; the toast system's success default is 4.5s. */
const ONLINE_TOAST_MS = 4_000;

export function ConnectivityStatus() {
  const online = useOnlineStatus();
  const toast = useOptionalToast();

  // Previous debounced state, so the toast fires exactly once per
  // offline→online transition and never on a mount that starts online.
  const wasOnline = useRef(online);

  useEffect(() => {
    if (online && !wasOnline.current) {
      toast?.success(ONLINE_MESSAGE, ONLINE_TOAST_MS);
    }
    wasOnline.current = online;
  }, [online, toast]);

  // Online is silent here — it is announced by the toast, not persisted.
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-connectivity="offline"
      className="connectivity-fade flex w-full items-center justify-center gap-2 border-t border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs font-medium text-amber-900 dark:border-amber-200/60 dark:bg-amber-100 dark:text-amber-800"
    >
      <Icon name="wifi-off" className="h-3.5 w-3.5 shrink-0" />
      <span>{OFFLINE_MESSAGE}</span>
    </div>
  );
}
