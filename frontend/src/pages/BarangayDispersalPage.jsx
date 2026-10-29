import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { analyticsApi } from "../api/analyticsApi";
import { animalTypesApi } from "../api/animalTypesApi";
import { getErrorMessage } from "../api/client";
import { useAutoRefresh } from "../api/queries";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { InlineAlert } from "../components/InlineAlert";
import { SkeletonList } from "../components/Skeleton";
import { FlowMatrix } from "../components/FlowMatrix";
import { getRole } from "../config/roles";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useToast } from "../context/ToastContext";

/**
 * Reports → Barangay dispersal. Which barangays dispersed the most and the
 * least, how much moved on to other barangays, and to where — every visual on
 * this page is driven by ONE metric switch, and the ranking itself (highest,
 * lowest, ties, totals, the sentence) is computed on the server: this page
 * renders it, it never re-derives it.
 *
 * The active filters live in the URL, so a view can be shared by copying the
 * address. Every chart has its equivalent table below it; the map is the only
 * canvas on the page and the barangay table is its exact keyboard-reachable
 * twin.
 */

// The map bundle (MapLibre GL) is heavy — load it only when the tab opens.
const BarangayFlowMap = lazy(() =>
  import("../components/BarangayFlowMap").then((m) => ({ default: m.BarangayFlowMap })),
);

const METRICS = [
  { key: "dispersed", label: "Dispersed" },
  { key: "redispersed_out", label: "Re-dispersed out" },
  { key: "redispersed_in", label: "Re-dispersed in" },
  { key: "net_flow", label: "Net flow" },
  { key: "redispersal_rate", label: "Re-dispersal rate" },
];

const EVENT_TYPES = [
  { key: "dispersal", label: "Dispersals" },
  { key: "re_dispersal", label: "Re-dispersals" },
  { key: "pass_on", label: "Pass-ons" },
];

const RATE_METRIC = "redispersal_rate";

function formatMetricValue(value, metric) {
  if (value === null || value === undefined) return "—";
  if (metric === RATE_METRIC) return `${(value * 100).toFixed(1)}%`;
  return String(value);
}

/** Same saveBlob idiom as the report template export panel. */
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function BarangayDispersalPage({ roleKey = "admin" }) {
  const config = getRole(roleKey);
  const toast = useToast();
  const online = useOnlineStatus();

  /* ---------------- URL-stored filters (shareable views) --------------- */

  const [params, setParams] = useSearchParams();

  const metric = METRICS.some((m) => m.key === params.get("metric"))
    ? params.get("metric")
    : "dispersed";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const animalTypeId = params.get("animal_type") ?? "";
  const classificationId = params.get("classification") ?? "";
  const per1000 = params.get("per_1000") === "1";
  const includeCvo = params.get("include_cvo") === "1";
  const sortDir = params.get("sort") === "asc" ? "asc" : "desc";
  const topFlows = Math.min(28, Math.max(1, Number(params.get("top") ?? 10) || 10));

  // The event-type selection as a STRING (the raw param), expanded to keys
  // through a memo keyed on that string — the array itself must keep a
  // stable identity across renders, or the query object below changes every
  // render and the load effect refetches forever. Absent/empty means "all
  // types", both here and in the checkbox handlers.
  const eventTypesParam = params.get("event_types") ?? "";
  const eventTypes = useMemo(() => {
    const parsed = eventTypesParam.split(",").filter((t) => EVENT_TYPES.some((e) => e.key === t));
    return parsed.length > 0 ? parsed : EVENT_TYPES.map((t) => t.key);
  }, [eventTypesParam]);

  const updateParams = useCallback(
    (patch) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === "" || value === null || value === false) next.delete(key);
            else next.set(key, String(value));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  /* ------------------------------ data -------------------------------- */

  const query = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      animal_type_id: animalTypeId || undefined,
      classification_id: classificationId || undefined,
      event_types: eventTypes.length > 0 ? eventTypes : EVENT_TYPES.map((t) => t.key),
      per_1000: per1000 || undefined,
      include_cvo: includeCvo || undefined,
    }),
    [from, to, animalTypeId, classificationId, eventTypes, per1000, includeCvo],
  );

  const [summaryData, setSummaryData] = useState(null);
  const [flowsData, setFlowsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);

      try {
        const [summary, flows] = await Promise.all([
          analyticsApi.barangayDispersal(query),
          analyticsApi.barangayFlows(query),
        ]);

        setSummaryData(summary);
        setFlowsData(flows);
        setFetchedAt(new Date());
      } catch (err) {
        if (!quiet) setError(getErrorMessage(err));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    load();
  }, [load, tick]);

  // Quietly re-fetch so the figures track handovers logged elsewhere.
  useAutoRefresh(load);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // The master list backs the animal-type filter — the same list every other
  // screen's cascade uses, so the filter cannot offer an unrecorded type.
  const [typeGroups, setTypeGroups] = useState([]);
  useEffect(() => {
    let active = true;
    animalTypesApi
      .list()
      .then((groups) => active && setTypeGroups(groups ?? []))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const typeOptions = useMemo(
    () => (typeGroups ?? []).flatMap((group) => group.animal_types ?? []),
    [typeGroups],
  );
  const classificationOptions = useMemo(
    () => typeOptions.find((type) => String(type.id) === animalTypeId)?.classifications ?? [],
    [typeOptions, animalTypeId],
  );

  /* --------------------------- derived rows ---------------------------- */

  const barangays = summaryData?.barangays ?? [];
  const summary = summaryData?.summary ?? {};
  const minRateAnimals = summaryData?.min_rate_animals ?? 5;
  const flows = flowsData?.flows ?? [];

  const metricConfig = METRICS.find((m) => m.key === metric);
  const metricSummary = summary[metric];

  // The rate ranks only the barangays that cleared the minimum; the server
  // says which (rate_eligible), the page just displays it.
  const sortedRows = useMemo(() => {
    const valueOf = (row) => {
      if (metric === RATE_METRIC) return row.redispersal_rate ?? -1;
      return row[metric] ?? 0;
    };
    return [...barangays].sort((a, b) => (sortDir === "asc" ? valueOf(a) - valueOf(b) : valueOf(b) - valueOf(a)));
  }, [barangays, metric, sortDir]);

  // An empty period: nothing dispersed, nothing re-dispersed, anywhere.
  const isEmpty =
    !loading &&
    !error &&
    barangays.length > 0 &&
    summary.dispersed?.total === 0 &&
    summary.redispersed_out?.total === 0 &&
    flows.length === 0;

  const anyPopulation = barangays.some((row) => row.population !== null);

  /* ------------------------------ export ------------------------------- */

  const [exporting, setExporting] = useState(false);

  const exportExcel = useCallback(async () => {
    setExporting(true);

    try {
      const { blob, filename } = await analyticsApi.exportExcel(query);
      saveBlob(blob, filename);
      toast.success(`Downloaded: ${filename}`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }, [query, toast]);

  /* ------------------------------ render ------------------------------- */

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{config?.label ?? "Administrator"}</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Barangay dispersal analytics
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Where the program's animals were dispersed to, and where they moved
              on from there — highest and lowest barangays at a glance, with the
              flows between them.
            </p>
            {summaryData?.scoped && (
              <p className="mt-3 inline-flex items-center gap-2 rounded-pill bg-brand-50 px-3.5 py-1.5 text-xs font-semibold text-brand-800">
                <Icon name="info" className="h-3.5 w-3.5" />
                Showing your assigned beneficiaries
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={exportExcel}
            disabled={exporting || loading || isEmpty}
            className="btn-secondary !px-3.5 !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting ? "Generating…" : "Export to Excel"}
            <Icon name="arrow-right" className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Metric switch — it drives every visual on the page. */}
        <div
          className="mt-5 flex flex-wrap gap-2"
          role="group"
          aria-label="Metric"
        >
          {METRICS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={metric === option.key}
              onClick={() => updateParams({ metric: option.key === "dispersed" ? "" : option.key })}
              className={`rounded-pill px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                metric === option.key
                  ? "bg-brand-700 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-800 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Filters — mirrored into the URL so a view can be shared. */}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="bd-from" className="block text-xs font-semibold text-slate-600">
              From
            </label>
            <input
              id="bd-from"
              type="date"
              value={from}
              onChange={(event) => updateParams({ from: event.target.value })}
              className="field mt-1 w-36 text-xs"
            />
          </div>
          <div>
            <label htmlFor="bd-to" className="block text-xs font-semibold text-slate-600">
              To
            </label>
            <input
              id="bd-to"
              type="date"
              value={to}
              onChange={(event) => updateParams({ to: event.target.value })}
              className="field mt-1 w-36 text-xs"
            />
          </div>
          <div>
            <label htmlFor="bd-type" className="block text-xs font-semibold text-slate-600">
              Animal type
            </label>
            <select
              id="bd-type"
              value={animalTypeId}
              onChange={(event) => {
                updateParams({ animal_type: event.target.value, classification: "" });
              }}
              className="field mt-1 w-40 text-xs"
            >
              <option value="">All types</option>
              {typeOptions.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
          {classificationOptions.length > 0 && (
            <div>
              <label htmlFor="bd-classification" className="block text-xs font-semibold text-slate-600">
                Classification
              </label>
              <select
                id="bd-classification"
                value={classificationId}
                onChange={(event) => updateParams({ classification: event.target.value })}
                className="field mt-1 w-40 text-xs"
              >
                <option value="">All classifications</option>
                {classificationOptions.map((classification) => (
                  <option key={classification.id} value={classification.id}>
                    {classification.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <fieldset className="flex flex-wrap items-center gap-3">
            <legend className="text-xs font-semibold text-slate-600">Event types</legend>
            {EVENT_TYPES.map((type) => (
              <label key={type.key} className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={eventTypes.includes(type.key)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...new Set([...eventTypes, type.key])]
                      : eventTypes.filter((t) => t !== type.key);
                    updateParams({
                      // An empty selection means "everything" server-side; do
                      // not let the URL imply a filter that is not there.
                      event_types:
                        next.length === EVENT_TYPES.length ? "" : next.sort().join(","),
                    });
                  }}
                />
                {type.label}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-1.5 text-xs text-slate-600" title={anyPopulation ? undefined : "Add barangay populations in System Settings first"}>
            <input
              type="checkbox"
              checked={per1000}
              disabled={!anyPopulation}
              onChange={(event) => updateParams({ per_1000: event.target.checked ? 1 : "" })}
            />
            Per 1,000 residents
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={includeCvo}
              onChange={(event) => updateParams({ include_cvo: event.target.checked ? 1 : "" })}
            />
            Include CVO as a source
          </label>
        </div>

        {(from || to || animalTypeId || classificationId || eventTypesParam !== "") && (
          <p className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-pill bg-brand-50 px-3.5 py-1.5 text-xs font-semibold text-brand-800">
            <Icon name="map-pin" className="h-3.5 w-3.5" />
            Filters: {[from && `from ${from}`, to && `to ${to}`, animalTypeId && "by type", eventTypesParam !== "" ? eventTypes.join(", ") : "all event types"]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </section>

      {!online && fetchedAt && !loading && (
        <InlineAlert
          tone="info"
          message={`You are offline — showing results loaded at ${fetchedAt.toLocaleTimeString()}.`}
        />
      )}

      {error && (
        <div className="flex flex-wrap items-center gap-3">
          <InlineAlert message={error} onDismiss={() => setError(null)} />
          <button type="button" onClick={refresh} className="btn-secondary !px-3.5 !py-1.5 text-xs">
            Try again
          </button>
        </div>
      )}

      {loading ? (
        <section className="card overflow-hidden">
          <SkeletonList rows={4} rowClassName="h-20" />
        </section>
      ) : isEmpty ? (
        <section className="card">
          <EmptyState
            title="No dispersals recorded in this period"
            description="Once animals are dispersed or re-dispersed, the barangay rankings, map and flows appear here."
          />
        </section>
      ) : (
        summaryData && (
          <>
            {/* Highest / lowest / total — the server's ranking, ties included. */}
            <section className="grid gap-4 lg:grid-cols-3">
              <article className="card p-5">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  Highest · {metricConfig.label}
                </p>
                <p className="mt-2 font-display text-lg font-bold text-slate-900">
                  {metricSummary?.highest?.length > 0
                    ? metricSummary.highest.map((entry) => entry.name).join(" and ")
                    : "—"}
                </p>
                {metricSummary?.highest?.[0] && (
                  <p className="mt-1 text-sm text-slate-600">
                    {formatMetricValue(metricSummary.highest[0].value, metric)}
                    {metricSummary.kind === "count" && metricSummary.total > 0 && (
                      <> · {Math.round((metricSummary.highest[0].value / metricSummary.total) * 100)}% of the total</>
                    )}
                  </p>
                )}
              </article>

              <article className="card p-5">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  Lowest · {metricConfig.label}
                </p>
                <p className="mt-2 font-display text-lg font-bold text-slate-900">
                  {metricSummary?.lowest?.length > 0
                    ? metricSummary.lowest.map((entry) => entry.name).join(" and ")
                    : "—"}
                </p>
                {metricSummary?.lowest?.[0] && (
                  <p className="mt-1 text-sm text-slate-600">
                    {formatMetricValue(metricSummary.lowest[0].value, metric)}
                  </p>
                )}
              </article>

              <article className="card p-5">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  {metric === RATE_METRIC ? "City-wide rate" : `City total · ${metricConfig.label}`}
                </p>
                <p className="mt-2 font-display text-lg font-bold text-slate-900">
                  {metric === RATE_METRIC
                    ? metricSummary?.total === null || metricSummary?.total === undefined
                      ? `Not ranked (n < ${minRateAnimals})`
                      : formatMetricValue(metricSummary.total, metric)
                    : (metricSummary?.total ?? 0)}
                </p>
                {metric === RATE_METRIC && (
                  <p className="mt-1 text-xs text-slate-500">
                    Distinct animals re-dispersed ÷ dispersed, up to the end of the period.
                  </p>
                )}
              </article>
            </section>

            {metricSummary?.sentence && (
              <p className="text-sm text-slate-600 dark:text-slate-300">{metricSummary.sentence}</p>
            )}

            {/* The bubble map with the flow layer. */}
            <section className="card p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                  Barangay map · {metricConfig.label}
                </h3>
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  Top flows drawn
                  <select
                    value={topFlows}
                    onChange={(event) => updateParams({ top: event.target.value })}
                    className="field !w-auto !px-2 !py-1 text-xs"
                    aria-label="How many of the largest flows to draw on the map"
                  >
                    {[5, 10, 15, 20, 28].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-4">
                <Suspense fallback={<SkeletonList rows={2} rowClassName="h-40" />}>
                  <BarangayFlowMap
                    rows={barangays}
                    flows={flows}
                    metric={metric}
                    metricLabel={metricConfig.label}
                    per1000={per1000}
                    minRateAnimals={minRateAnimals}
                    topFlows={topFlows}
                    includeCvo={includeCvo}
                  />
                </Suspense>
              </div>
            </section>

            {/* Ranked bars — the top and bottom 3 carry their rank number, so
                emphasis is not colour alone. */}
            <section className="card p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                  Ranked barangays · {metricConfig.label}
                </h3>
                <button
                  type="button"
                  onClick={() => updateParams({ sort: sortDir === "desc" ? "asc" : "desc" })}
                  className="btn-secondary !px-3.5 !py-1.5 text-xs"
                  aria-label={`Currently sorted ${sortDir === "desc" ? "highest first" : "lowest first"}. Reverse the order.`}
                >
                  {sortDir === "desc" ? "Highest first" : "Lowest first"}
                  <Icon name="refresh" className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-4 h-[560px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sortedRows} layout="vertical" margin={{ left: 8, right: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      tickLine={false}
                      axisLine={{ stroke: "#e2e8f0" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={116}
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(name) => {
                        const index = sortedRows.findIndex((row) => row.name === name);
                        const rank = sortDir === "desc" ? index + 1 : sortedRows.length - index;
                        return rank <= 3 || rank > sortedRows.length - 3 ? `#${rank} ${name}` : name;
                      }}
                    />
                    <ChartTooltip
                      cursor={{ fill: "rgba(85, 139, 47, 0.08)" }}
                      formatter={(value) => [formatMetricValue(value, metric), metricConfig.label]}
                      labelFormatter={(name) => name}
                      contentStyle={{ fontSize: 12, borderRadius: 12 }}
                    />
                    <Bar dataKey={metric === RATE_METRIC ? "redispersal_rate" : metric} isAnimationActive={false} radius={[0, 4, 4, 0]}>
                      {sortedRows.map((row, index) => {
                        const rank = sortDir === "desc" ? index + 1 : sortedRows.length - index;
                        const emphasized = rank <= 3 || rank > sortedRows.length - 3;
                        return (
                          <Cell
                            key={row.barangay_id}
                            fill={metric === RATE_METRIC && !row.rate_eligible ? "#cbd5e1" : emphasized ? "#33691e" : "#8bc34a"}
                          />
                        );
                      })}
                      <LabelList
                        dataKey={metric === RATE_METRIC ? "redispersal_rate" : metric}
                        position="right"
                        formatter={(value) => formatMetricValue(value, metric)}
                        style={{ fontSize: 10, fill: "#64748b" }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {metric === RATE_METRIC && (
                <p className="mt-2 text-xs text-slate-500">
                  Greyed bars: not ranked — fewer than {minRateAnimals} distinct animals dispersed (n &lt; {minRateAnimals}).
                </p>
              )}
            </section>

            {/* The barangay table: the exact data behind the map and the bars,
                and every metric at once. */}
            <section className="card p-6">
              <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                Barangay table
              </h3>
              <div className="mt-4 overflow-x-auto" tabIndex={0}>
                <table
                  className="w-full text-left text-xs"
                  aria-label="All barangay metrics"
                >
                  <caption className="sr-only">
                    Dispersed, re-dispersed and net movement per barangay, with the re-dispersal rate and its denominator.
                  </caption>
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] tracking-wide text-slate-500 uppercase dark:border-slate-700">
                      <th scope="col" className="py-2 pr-3 font-semibold">Rank</th>
                      <th scope="col" className="py-2 pr-3 font-semibold">Barangay</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Dispersed</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Re-disp. out</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Re-disp. in</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Within</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Net flow</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Rate</th>
                      <th scope="col" className="py-2 text-right font-semibold">Rate n</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row, index) => {
                      const rank = sortDir === "desc" ? index + 1 : sortedRows.length - index;
                      const emphasized = rank <= 3 || rank > sortedRows.length - 3;

                      return (
                        <tr
                          key={row.barangay_id}
                          className={`border-b border-slate-100 dark:border-slate-800 ${emphasized ? "font-semibold" : ""}`}
                        >
                          <td className="py-1.5 pr-3 tabular-nums">#{rank}</td>
                          <td className="py-1.5 pr-3">{row.name}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{row.dispersed}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{row.redispersed_out}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{row.redispersed_in}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{row.within_barangay}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">
                            {row.net_flow >= 0 ? "+" : ""}
                            {row.net_flow}
                          </td>
                          <td
                            className={`py-1.5 pr-3 text-right tabular-nums ${
                              row.redispersal_rate === null ? "text-slate-400" : ""
                            }`}
                          >
                            {row.redispersal_rate === null ? `n < ${minRateAnimals}` : formatMetricValue(row.redispersal_rate, RATE_METRIC)}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{row.rate_denominator}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* The matrix: exact numbers, works without a mouse. */}
            <section className="card p-6">
              <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                Flow matrix
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Origin rows, destination columns. The diagonal is re-dispersal
                within the same barangay — counted in the totals, never drawn as
                a flow line.
              </p>
              <FlowMatrix barangays={barangays} flows={flows} />
            </section>
          </>
        )
      )}
    </div>
  );
}
