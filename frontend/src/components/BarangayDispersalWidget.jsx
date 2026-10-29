import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { analyticsApi } from "../api/analyticsApi";
import { getErrorMessage } from "../api/client";
import { Icon } from "./Icons";
import { InlineAlert } from "./InlineAlert";
import { SkeletonList } from "./Skeleton";

/**
 * The dashboard home widget: the top 5 and bottom 5 barangays for one metric,
 * linking to the full Barangay dispersal tab. Admin and doctor only — the
 * full tab is where a technician's scoped view lives.
 *
 * The ranking comes straight from the server's summary (ties included); the
 * widget only trims the displayed lists to five.
 */

const METRICS = [
  { key: "dispersed", label: "Dispersed" },
  { key: "redispersed_out", label: "Re-dispersed out" },
  { key: "redispersed_in", label: "Re-dispersed in" },
  { key: "net_flow", label: "Net flow" },
  { key: "redispersal_rate", label: "Re-dispersal rate" },
];

export function BarangayDispersalWidget({ roleKey }) {
  const [metric, setMetric] = useState("dispersed");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    try {
      setData(await analyticsApi.barangayDispersal({}));
    } catch (err) {
      if (!quiet) setError(getErrorMessage(err));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary?.[metric];
  const total = data?.summary?.dispersed?.total === 0 && data?.summary?.redispersed_out?.total === 0;
  const target = `/dashboard/${roleKey}/reports/barangay-dispersal`;

  const formatValue = (value) =>
    metric === "redispersal_rate"
      ? value === null || value === undefined
        ? "n/a"
        : `${Math.round(value * 1000) / 10}%`
      : String(value ?? 0);

  return (
    <article className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
          <Icon name="chart" className="h-5 w-5" />
        </span>
        <span className="rounded-pill bg-brand-100 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-brand-800 uppercase">
          Live
        </span>
      </div>

      <h3 className="mt-4 font-display text-sm font-semibold text-slate-900">
        Barangay dispersal
      </h3>

      <label className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
        Metric
        <select
          value={metric}
          onChange={(event) => setMetric(event.target.value)}
          className="field !w-auto !px-2 !py-1 text-xs"
          aria-label="Metric for the barangay dispersal widget"
        >
          {METRICS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3">
        {loading ? (
          <SkeletonList rows={2} rowClassName="h-16" className="!p-0 space-y-2" />
        ) : error ? (
          <div className="flex flex-wrap items-center gap-2">
            <InlineAlert message={error} />
            <button type="button" onClick={() => load()} className="btn-secondary !px-3 !py-1 text-xs">
              Try again
            </button>
          </div>
        ) : total ? (
          <p className="text-xs text-slate-500">No dispersals recorded yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                Highest
              </p>
              <ol className="mt-1 space-y-1">
                {(summary?.highest ?? []).slice(0, 5).map((entry) => (
                  <li key={entry.barangay_id} className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-slate-700">{entry.name}</span>
                    <span className="tabular-nums text-slate-500">{formatValue(entry.value)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                Lowest
              </p>
              <ol className="mt-1 space-y-1">
                {(summary?.lowest ?? []).slice(0, 5).map((entry) => (
                  <li key={entry.barangay_id} className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-slate-700">{entry.name}</span>
                    <span className="tabular-nums text-slate-500">{formatValue(entry.value)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>

      <Link to={target} className="btn-secondary mt-4 !px-3.5 !py-1.5 text-xs">
        Open full analytics
        <Icon name="arrow-right" className="h-3.5 w-3.5" />
      </Link>
    </article>
  );
}

export default BarangayDispersalWidget;
