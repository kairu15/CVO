import { useEffect, useRef, useState } from "react";
import { auditApi } from "../api/auditApi";
import { getErrorMessage } from "../api/client";
import { Icon } from "./Icons";
import { Skeleton } from "./Skeleton";
import { labelForAction, labelForEntity, labelForModule } from "../lib/auditLabels";

/**
 * The audit entry detail drawer.
 *
 * The list deliberately carries only summary fields; opening a row fetches
 * its complete context and before/after values once. That keeps a 50-row page
 * light in the common case (nobody reads most rows) while still showing the
 * full record without leaving the investigation.
 *
 * Keyboard: Escape closes, focus moves to the close button on open, and the
 * previous/next controls walk the rows already on screen.
 */

function formatDateTime(value, withTimeZone = false) {
  if (!value) return "—";
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: withTimeZone ? "long" : "short",
  });
}

function displayValue(value) {
  if (value === null || value === undefined) return "—";
  if (value === "") return "(empty)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function fieldLabel(field) {
  return field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

const STATUS_TONES = {
  success: "bg-brand-100 text-brand-800",
  failed: "bg-rose-100 text-rose-800",
  security: "bg-amber-100 text-amber-900",
};

export function AuditDetailDrawer({
  entryId,
  summary,
  onClose,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
}) {
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!entryId) return undefined;

    let live = true;
    setLoading(true);
    setError(null);
    setEntry(null);
    setCopied(false);

    auditApi
      .get(entryId)
      .then((data) => {
        if (live) setEntry(data);
      })
      .catch((err) => {
        if (live) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [entryId]);

  useEffect(() => {
    if (!entryId) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [entryId, onClose]);

  if (!entryId) return null;

  const row = entry ?? summary;
  const fields = [
    ...new Set([
      ...Object.keys(entry?.old_values ?? {}),
      ...Object.keys(entry?.new_values ?? {}),
    ]),
  ];

  const rawJson = entry
    ? JSON.stringify(
        {
          context: entry.context,
          old_values: entry.old_values,
          new_values: entry.new_values,
        },
        null,
        2,
      )
    : "";

  async function copyRaw() {
    try {
      await navigator.clipboard.writeText(rawJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission is optional; the JSON remains selectable.
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/35 backdrop-blur-[1px]"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-detail-title"
        className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-slate-900"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-200/60">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              Audit entry #{entryId}
            </p>
            <h2
              id="audit-detail-title"
              className="mt-1 truncate font-display text-lg font-bold text-slate-900 dark:text-slate-100"
            >
              {labelForAction(row?.action ?? "")}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {formatDateTime(row?.created_at, true)}
            </p>
          </div>

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 dark:hover:bg-slate-800"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="space-y-3" aria-label="Loading audit entry">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </div>
          )}

          {!loading && !error && entry && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${
                    STATUS_TONES[entry.status] ?? STATUS_TONES.success
                  }`}
                >
                  {entry.status === "security"
                    ? "Security event"
                    : entry.status === "failed"
                      ? "Failed"
                      : "Successful"}
                </span>
                <span className="rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-slate-600 uppercase dark:bg-slate-800 dark:text-slate-300">
                  {labelForModule(entry.module)}
                </span>
                {entry.critical && (
                  <span className="rounded-pill bg-rose-50 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-rose-700 uppercase">
                    Critical
                  </span>
                )}
              </div>

              <dl className="grid gap-3 sm:grid-cols-2">
                <Detail label="Performed by">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {entry.actor?.name ?? (entry.actor_id ? `User #${entry.actor_id}` : "System")}
                  </span>
                  {entry.actor?.email && (
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      {entry.actor.email}
                    </span>
                  )}
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    {entry.actor_role
                      ? `Role at the time: ${entry.actor_role}`
                      : "No role recorded"}
                    {entry.actor?.current_role &&
                      entry.actor.current_role !== entry.actor_role &&
                      ` · now ${entry.actor.current_role}`}
                  </span>
                </Detail>

                <Detail label="Affected module">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {labelForEntity(entry.target_type)}
                    {entry.target_id ? ` #${entry.target_id}` : ""}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    {labelForModule(entry.module)}
                  </span>
                </Detail>

                <Detail label="Recorded at">
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {formatDateTime(entry.created_at, true)}
                  </span>
                  {entry.context?.device_created_at && (
                    <span className="mt-0.5 block text-[11px] text-amber-800">
                      Device time: {formatDateTime(entry.context.device_created_at, true)}
                    </span>
                  )}
                </Detail>

                <Detail label="Source">
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {entry.ip_address ?? "No IP recorded"}
                  </span>
                  {entry.user_agent && (
                    <span className="mt-0.5 block break-words text-[11px] text-slate-500">
                      {entry.user_agent}
                    </span>
                  )}
                </Detail>
              </dl>

              <div>
                <h3 className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  Changed fields
                </h3>

                {fields.length === 0 ? (
                  <p className="mt-2 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                    {entry.action === "login" || entry.action === "logout"
                      ? "This event records an action, not a change to a record — there is no before/after pair."
                      : "No field-level values were stored for this entry."}
                  </p>
                ) : (
                  <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-200/60">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-[10px] tracking-wider text-slate-500 uppercase dark:border-slate-200/60 dark:bg-slate-800/60">
                          <th scope="col" className="px-3 py-2 font-semibold">Field</th>
                          <th scope="col" className="px-3 py-2 font-semibold">Before</th>
                          <th scope="col" className="px-3 py-2 font-semibold">After</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {fields.map((field) => {
                          const before = displayValue(entry.old_values?.[field]);
                          const after = displayValue(entry.new_values?.[field]);
                          const unchanged = before === after;

                          return (
                            <tr key={field}>
                              <td className="px-3 py-2 font-medium whitespace-nowrap text-slate-700 dark:text-slate-300">
                                {fieldLabel(field)}
                              </td>
                              <td className={`px-3 py-2 align-top ${unchanged ? "text-slate-400" : "text-slate-600 dark:text-slate-300"}`}>
                                {unchanged ? "—" : before}
                              </td>
                              <td className={`px-3 py-2 align-top ${unchanged ? "text-slate-400" : "font-medium text-slate-900 dark:text-slate-100"}`}>
                                {unchanged ? "—" : after}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {entry.context && Object.keys(entry.context).length > 0 && (
                <div>
                  <h3 className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                    Context
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(entry.context).map(([key, value]) => (
                      <span
                        key={key}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-pill bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700"
                      >
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {fieldLabel(key)}
                        </span>
                        <span className="truncate">{displayValue(value)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <details className="rounded-xl border border-slate-200 dark:border-slate-200/60">
                <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Raw recorded data
                </summary>
                <div className="border-t border-slate-100 p-3 dark:border-slate-800">
                  <div className="mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={copyRaw}
                      className="rounded-pill border border-slate-200 px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      {copied ? "Copied" : "Copy JSON"}
                    </button>
                  </div>
                  <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] leading-relaxed text-slate-100">
                    {rawJson || "No raw values recorded."}
                  </pre>
                </div>
              </details>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 dark:border-slate-200/60">
          <button
            type="button"
            onClick={onPrevious}
            disabled={!hasPrevious}
            className="inline-flex items-center gap-1.5 rounded-pill border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Icon name="arrow-left" className="h-3.5 w-3.5" />
            Newer
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!hasNext}
            className="inline-flex items-center gap-1.5 rounded-pill border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Older
            <Icon name="arrow-right" className="h-3.5 w-3.5" />
          </button>
        </footer>
      </section>
    </div>
  );
}

function Detail({ label, children }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3.5 py-2.5 dark:border-slate-200/60">
      <dt className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-xs text-slate-700 dark:text-slate-300">{children}</dd>
    </div>
  );
}
