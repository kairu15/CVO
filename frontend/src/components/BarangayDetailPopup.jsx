import { useCallback, useEffect, useId, useRef, useState } from "react";
import { analyticsApi } from "../api/analyticsApi";
import { getErrorMessage } from "../api/client";
import { Skeleton } from "./Skeleton";

/**
 * The floating card a barangay polygon opens.
 *
 * It is NOT a MapLibre popup: the map component positions this DOM node by
 * projecting the click's lngLat, so the card stays attached while the map is
 * panned and zoomed and can become a bottom sheet on a phone. The map holds
 * the summary row already (the same row behind the polygon's colour and the
 * table), so the four headline numbers render on the first paint; only the
 * animal mix and the handover lists wait for the detail request.
 *
 * Failure is never disguised as "no data": the loading state is a skeleton,
 * a failed request shows the error and a Retry button, and the empty state is
 * reached only from a successful answer that recorded nothing.
 */

const EMPTY_QUERY = {};

const TABS = [
  { key: "received", label: "Received" },
  { key: "passed_on", label: "Passed on" },
];

const EVENT_TYPE_LABELS = {
  dispersal: "Dispersal",
  re_dispersal: "Re-dispersal",
  pass_on: "Pass-on",
};

/** A date-only API string, spelled the way the table spells dates. */
function formatDate(iso) {
  if (!iso) return "";
  const parsed = new Date(`${iso}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

function StatTile({ label, value, tone = "" }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60">
      <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
      <p className={`mt-0.5 font-display text-base font-bold tabular-nums ${tone || "text-slate-900 dark:text-slate-100"}`}>
        {value}
      </p>
    </div>
  );
}

function HandoverList({ items, total, kind }) {
  if (items.length === 0) {
    return <p className="py-3 text-xs text-slate-500">No handovers recorded for the active filters.</p>;
  }

  return (
    <>
      <ul className="space-y-1.5">
        {items.map((item) => {
          const household = kind === "received" ? item.to : item.from;
          const other = kind === "received" ? item.from : item.to;
          const otherLabel = kind === "received" ? "from" : "to";

          return (
            <li
              key={item.event_id}
              className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 px-2.5 py-2 dark:border-slate-800"
            >
              <div className="min-w-0">
                <p
                  className={`truncate text-xs font-semibold text-slate-900 dark:text-slate-100 ${
                    household?.masked ? "italic" : ""
                  }`}
                >
                  {household?.name ?? "Unknown household"}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                  {item.animal_type}
                  {item.classification ? ` · ${item.classification}` : ""}
                  {item.ear_tag_number ? ` · Tag ${item.ear_tag_number}` : ""}
                </p>
                {other?.name && (
                  <p className={`mt-0.5 truncate text-[10px] text-slate-500 ${other.masked ? "italic" : ""}`}>
                    {otherLabel} {other.name}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="rounded-pill bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
                  {EVENT_TYPE_LABELS[item.event_type] ?? item.event_type}
                </span>
                <span className="text-[10px] text-slate-500">{formatDate(item.event_date)}</span>
              </div>
            </li>
          );
        })}
      </ul>

      {items.length < total && (
        <p className="mt-2 text-[10px] text-slate-500">
          Showing the {items.length} most recent of {total}.
        </p>
      )}
    </>
  );
}

/**
 * @param {object} props
 * @param {number} props.barangayId
 * @param {string} props.name
 * @param {object|null} [props.row] the map's live summary row (headline numbers)
 * @param {object} [props.detailQuery] the page's filters
 * @param {() => void} props.onClose
 * @param {"card"|"sheet"} [props.mode] desktop card or phone bottom sheet
 * @param {import("react").CSSProperties} [props.style] position from the map
 */
export function BarangayDetailPopup({
  barangayId,
  name,
  row = null,
  detailQuery = EMPTY_QUERY,
  onClose,
  mode = "card",
  style = {},
}) {
  const titleId = useId();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: "loading", detail: null, error: null });
  const [tab, setTab] = useState("received");
  // The newest request's ticket. A slower answer for a barangay the reader
  // already navigated away from must never overwrite the current card.
  const requestRef = useRef(0);

  useEffect(() => {
    const ticket = requestRef.current + 1;
    requestRef.current = ticket;

    const controller = new AbortController();
    setState({ status: "loading", detail: null, error: null });

    analyticsApi
      .barangayDetail(barangayId, { ...detailQuery, signal: controller.signal })
      .then((detail) => {
        if (requestRef.current !== ticket) return;
        setState({ status: "ready", detail: detail ?? {}, error: null });
      })
      .catch((error) => {
        if (requestRef.current !== ticket) return;
        if (error?.name === "AbortError" || error?.code === "ERR_CANCELED") return;
        setState({ status: "error", detail: null, error: getErrorMessage(error) });
      });

    return () => controller.abort();
  }, [barangayId, detailQuery, attempt]);

  // Escape closes the card, like every other dialog in the app.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const detail = state.detail;
  const received = detail?.received ?? { total: 0, items: [] };
  const passedOn = detail?.passed_on ?? { total: 0, items: [] };
  const categories = detail?.categories ?? [];
  const recorded = received.total > 0 || passedOn.total > 0;
  const net = Number(row?.net_flow) || 0;

  const active = tab === "passed_on" ? passedOn : received;

  return (
    <div
      className="cvo-barangay-card absolute z-[600] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
      style={style}
      role="dialog"
      aria-labelledby={titleId}
      data-testid="barangay-detail-popup"
    >
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">Barangay</p>
          <h2 id={titleId} className="truncate font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            {name}
          </h2>
          {row?.population !== null && row?.population !== undefined && (
            <p className="mt-0.5 text-[11px] text-slate-500">
              Population {Number(row.population).toLocaleString()}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close barangay details"
          className="-mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            ×
          </span>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {/* Headline numbers: already known from the map, so they are never
            replaced by a placeholder — a filter change updates them in place. */}
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Dispersed" value={row ? Number(row.dispersed) || 0 : "—"} />
          <StatTile label="Re-dispersed in" value={row ? Number(row.redispersed_in) || 0 : "—"} />
          <StatTile label="Re-dispersed out" value={row ? Number(row.redispersed_out) || 0 : "—"} />
          <StatTile
            label="Net flow"
            value={row ? `${net >= 0 ? "+" : ""}${net}` : "—"}
            tone={row ? (net >= 0 ? "text-brand-700" : "text-amber-700") : ""}
          />
        </div>

        {state.status === "loading" && (
          <div className="mt-4 space-y-2" role="status" aria-label="Loading barangay details">
            <Skeleton className="block h-4 w-2/3" />
            <Skeleton className="block h-12 w-full" />
            <Skeleton className="block h-16 w-full" />
          </div>
        )}

        {state.status === "error" && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            <p className="font-semibold">Couldn&apos;t load this barangay&apos;s details.</p>
            {state.error && <p className="mt-0.5">{state.error}</p>}
            <button type="button" onClick={retry} className="btn-secondary mt-2 !px-2.5 !py-1 text-[11px]">
              Retry
            </button>
          </div>
        )}

        {state.status === "ready" && !recorded && (
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-4 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            No dispersals recorded for {name} in this period.
          </p>
        )}

        {state.status === "ready" && recorded && (
          <>
            {categories.length > 0 && (
              <section className="mt-4">
                <h3 className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                  Received, by kind of animal
                </h3>
                <div className="mt-2 space-y-2">
                  {categories.map((group) => (
                    <div key={group.category}>
                      <p className="flex items-baseline justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                        <span>{group.label}</span>
                        <span className="tabular-nums text-slate-500">{group.total}</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {group.types.map((type) => `${type.name} (${type.count})`).join(" · ")}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="mt-4">
              <div role="tablist" aria-label="Handovers" className="flex gap-1 border-b border-slate-100 dark:border-slate-800">
                {TABS.map((option) => {
                  const count = option.key === "received" ? received.total : passedOn.total;
                  const selected = tab === option.key;

                  return (
                    <button
                      key={option.key}
                      type="button"
                      role="tab"
                      id={`${titleId}-${option.key}-tab`}
                      aria-selected={selected}
                      aria-controls={`${titleId}-${option.key}-panel`}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setTab(option.key)}
                      className={`-mb-px rounded-t-md border-b-2 px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                        selected
                          ? "border-brand-700 text-brand-800 dark:text-brand-200"
                          : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {option.label} ({count})
                    </button>
                  );
                })}
              </div>

              <div
                role="tabpanel"
                id={`${titleId}-${tab}-panel`}
                aria-labelledby={`${titleId}-${tab}-tab`}
                className="pt-2"
              >
                <HandoverList
                  key={`${titleId}-${tab}`}
                  items={active.items ?? []}
                  total={active.total ?? 0}
                  kind={tab}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {mode === "sheet" && <div className="mx-auto mb-1 mt-0.5 h-1 w-10 rounded-pill bg-slate-300" aria-hidden="true" />}
    </div>
  );
}

export default BarangayDetailPopup;
