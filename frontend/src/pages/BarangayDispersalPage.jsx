import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
 * lowest, ties, totals, the sentence, the previous period) is computed on the
 * server: this page renders it, it never re-derives it.
 *
 * The active filters live in the URL, so a view can be shared by copying the
 * address. The map is the only canvas on the page; the barangay table is its
 * exact keyboard-reachable twin and carries every metric at once.
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

/** A historical report does not need the 30s live-widget cadence. */
const REFRESH_INTERVAL_MS = 60_000;

const COLUMNS = [
  { key: "name", label: "Barangay", align: "left" },
  { key: "population", label: "Population", align: "right" },
  { key: "dispersed", label: "Dispersal events", align: "right", per1000: true },
  { key: "redispersed_out", label: "Re-dispersals out", align: "right", per1000: true },
  { key: "redispersed_in", label: "Re-dispersals in", align: "right", per1000: true },
  { key: "within_barangay", label: "Within barangay", align: "right" },
  { key: "net_flow", label: "Net flow", align: "right", per1000: true },
  { key: RATE_METRIC, label: "Re-dispersal rate", align: "right" },
  { key: "rate_denominator", label: "Rate n (animals)", align: "right" },
];

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMetricValue(value, metric, per1000) {
  if (value === null || value === undefined) return "—";
  if (metric === RATE_METRIC) return `${(value * 100).toFixed(1)}%`;
  if (per1000) return Number(value).toFixed(1);
  return String(value);
}

function formatSigned(value, metric, per1000) {
  if (value === null || value === undefined) return "—";
  if (metric === RATE_METRIC) return `${(value * 100).toFixed(1)}%`;
  if (per1000) return `${value > 0 ? "+" : ""}${Number(value).toFixed(1)}`;
  return `${value > 0 ? "+" : ""}${value}`;
}

/** A readable cap for tied groups: “A, B and 15 others”. */
function capNames(entries, limit = 3) {
  const names = (entries ?? []).map((entry) => entry.name).filter(Boolean);
  if (names.length <= limit) return names.join(" and ");
  const others = names.length - limit;
  return `${names.slice(0, limit).join(", ")} and ${others} other${others === 1 ? "" : "s"}`;
}

function deltaLabel(current, previous, metric, per1000) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return null;
  }

  const diff = current - previous;

  if (metric === RATE_METRIC) {
    return `${diff > 0 ? "+" : ""}${(diff * 100).toFixed(1)} pts vs previous period`;
  }

  if (per1000) {
    return `${diff > 0 ? "+" : ""}${diff.toFixed(1)} per 1,000 vs previous period`;
  }

  return `${diff > 0 ? "+" : ""}${Math.round(diff)} vs previous period`;
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
  const sortDir = params.get("dir") === "asc" ? "asc" : "desc";
  const explicitSort = params.get("sort") ?? "";
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
      event_types: eventTypes,
      per_1000: per1000 || undefined,
      include_cvo: includeCvo || undefined,
    }),
    [from, to, animalTypeId, classificationId, eventTypes, per1000, includeCvo],
  );

  const [summaryData, setSummaryData] = useState(null);
  const [flowsData, setFlowsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [flowsError, setFlowsError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [tick, setTick] = useState(0);

  // The summary and the flow layer fail independently: a broken flow query
  // must not blank the barangay table, and vice versa. Only a failed summary
  // stops the report.
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);
      setFlowsError(null);

      const [summaryResult, flowsResult] = await Promise.allSettled([
        analyticsApi.barangayDispersal(query),
        analyticsApi.barangayFlows(query),
      ]);

      if (summaryResult.status === "fulfilled") {
        setSummaryData(summaryResult.value);
        setFetchedAt(new Date());
      } else if (!quiet) {
        setError(getErrorMessage(summaryResult.reason));
      }

      if (flowsResult.status === "fulfilled") {
        setFlowsData(flowsResult.value);
      } else {
        setFlowsError(getErrorMessage(flowsResult.reason));
      }

      if (!quiet) setLoading(false);
    },
    [query],
  );

  useEffect(() => {
    load();
  }, [load, tick]);

  useAutoRefresh(load, { interval: REFRESH_INTERVAL_MS });

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

  // Stable identities: these feed useMemo dependencies below, and a fresh
  // [] on every render would defeat every one of them.
  const barangays = useMemo(() => summaryData?.barangays ?? [], [summaryData]);
  const summary = summaryData?.summary ?? {};
  const minRateAnimals = summaryData?.min_rate_animals ?? 5;
  const coverage = summaryData?.population_coverage ?? null;
  const previous = summaryData?.previous ?? null;
  const previousPeriod = summaryData?.previous_period ?? null;
  const flows = useMemo(() => flowsData?.flows ?? [], [flowsData]);

  const metricConfig = METRICS.find((m) => m.key === metric);
  const metricSummary = summary[metric];
  const sortKey = explicitSort || metric;

  // The rank is the active metric's ranking, independent of which column the
  // table is currently sorted by. Ties share a rank.
  const rankById = useMemo(() => {
    const valueOf = (row) => {
      if (metric === RATE_METRIC) return row.redispersal_rate;
      return per1000 ? row[`${metric}_per_1000`] ?? null : row[metric];
    };

    const rankable = barangays.filter(
      (row) => valueOf(row) !== null && (metric !== RATE_METRIC || row.rate_eligible),
    );
    const ranked = [...rankable].sort((a, b) => valueOf(b) - valueOf(a));
    const ranks = new Map();
    let previousValue;
    let previousRank = 0;

    ranked.forEach((row, index) => {
      const value = valueOf(row);
      const rank = value === previousValue ? previousRank : index + 1;
      ranks.set(row.barangay_id, rank);
      previousValue = value;
      previousRank = rank;
    });

    return ranks;
  }, [barangays, metric, per1000]);

  const [search, setSearch] = useState("");

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = needle
      ? barangays.filter((row) => String(row.name ?? "").toLowerCase().includes(needle))
      : barangays;

    const valueOf = (row) => {
      if (sortKey === "name") return row.name;
      if (sortKey === "population") return row.population;
      if (sortKey === RATE_METRIC) return row.redispersal_rate;
      if (per1000 && sortKey !== "within_barangay" && sortKey !== "rate_denominator") {
        return row[`${sortKey}_per_1000`] ?? null;
      }
      return row[sortKey];
    };

    return [...matches].sort((a, b) => {
      const aValue = valueOf(a);
      const bValue = valueOf(b);

      // Unknown values sort last whichever direction is active.
      const aMissing = aValue === null || aValue === undefined;
      const bMissing = bValue === null || bValue === undefined;
      if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;

      const comparison =
        typeof aValue === "string" ? aValue.localeCompare(bValue) : aValue - bValue;
      return sortDir === "asc" ? comparison : -comparison;
    });
  }, [barangays, search, sortKey, sortDir, per1000]);

  const toggleSort = useCallback(
    (key) => {
      const nextDir =
        sortKey === key ? (sortDir === "desc" ? "asc" : "desc") : key === "name" ? "asc" : "desc";
      updateParams({ sort: key === metric ? "" : key, dir: nextDir });
    },
    [sortKey, sortDir, metric, updateParams],
  );

  /* ---------------------------- comparison ----------------------------- */

  const [compareIds, setCompareIds] = useState(["", "", ""]);

  const compareRows = useMemo(() => {
    const seen = new Set();
    return compareIds
      .filter(Boolean)
      .map((id) => barangays.find((row) => String(row.barangay_id) === String(id)))
      .filter((row) => {
        if (!row || seen.has(row.barangay_id)) return false;
        seen.add(row.barangay_id);
        return true;
      });
  }, [compareIds, barangays]);

  const setCompareAt = (index, value) => {
    setCompareIds((current) => current.map((id, i) => (i === index ? value : id)));
  };

  // An empty period: nothing dispersed, nothing re-dispersed, anywhere.
  const isEmpty =
    !loading &&
    !error &&
    barangays.length > 0 &&
    barangays.every(
      (row) => row.dispersed === 0 && row.redispersed_out === 0 && row.redispersed_in === 0,
    );

  const anyPopulation = barangays.some((row) => row.population !== null);
  const populationSum = barangays.reduce((sum, row) => sum + (row.population ?? 0), 0);
  const withinTotal = barangays.reduce((sum, row) => sum + (row.within_barangay ?? 0), 0);

  /* ------------------------------ export ------------------------------- */

  const [exporting, setExporting] = useState(false);

  const exportExcel = useCallback(async () => {
    setExporting(true);

    try {
      const { blob, filename } = await analyticsApi.exportExcel({ ...query, metric });
      saveBlob(blob, filename);
      toast.success(`Downloaded: ${filename}`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }, [query, metric, toast]);

  /* ------------------------------ render ------------------------------- */

  const preset = (days) => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    updateParams({ from: toIsoDate(start), to: toIsoDate(today) });
  };

  const thisYear = () => {
    const today = new Date();
    updateParams({ from: `${today.getFullYear()}-01-01`, to: toIsoDate(today) });
  };

  const periodLabel =
    from && to
      ? `${from} to ${to}`
      : from
        ? `From ${from}`
        : to
          ? `Through ${to}`
          : "All records";

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

          <div className="flex flex-wrap items-center gap-2">
            {fetchedAt && (
              <p className="text-xs text-slate-500">
                Updated {fetchedAt.toLocaleTimeString()}
              </p>
            )}
            <button
              type="button"
              onClick={refresh}
              className="btn-secondary !px-3.5 !py-1.5 text-xs"
              aria-label="Refresh the report"
            >
              <Icon name="refresh" className="h-3.5 w-3.5" />
              Refresh
            </button>
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

        {/* Period presets — the explicit "All records" state is a button too. */}
        <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Period presets">
          <span className="text-xs font-semibold text-slate-600">Period</span>
          {[
            { key: "30", label: "Last 30 days", onClick: () => preset(30) },
            { key: "90", label: "Last 90 days", onClick: () => preset(90) },
            { key: "year", label: "This year", onClick: thisYear },
            { key: "all", label: "All records", onClick: () => updateParams({ from: "", to: "" }) },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={option.onClick}
              className="rounded-pill border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-800 dark:border-slate-700 dark:text-slate-300"
            >
              {option.label}
            </button>
          ))}
          <span className="text-xs text-slate-500">Showing: {periodLabel}</span>
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
          <label
            className="flex items-center gap-1.5 text-xs text-slate-600"
            title={anyPopulation ? undefined : "Add barangay populations in System Settings first"}
          >
            <input
              type="checkbox"
              checked={per1000}
              disabled={!anyPopulation}
              onChange={(event) => updateParams({ per_1000: event.target.checked ? 1 : "" })}
            />
            Per 1,000 residents
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

      {flowsError && !error && (
        <InlineAlert
          tone="info"
          message={`Flow lines could not be loaded (${flowsError}). The barangay table and summary are unaffected.`}
          onDismiss={() => setFlowsError(null)}
        />
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
                    ? capNames(metricSummary.highest)
                    : "—"}
                </p>
                {metricSummary?.highest?.[0] && (
                  <p className="mt-1 text-sm text-slate-600">
                    {formatMetricValue(metricSummary.highest[0].value, metric, per1000)}
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
                    ? capNames(metricSummary.lowest)
                    : "—"}
                </p>
                {metricSummary?.lowest?.[0] && (
                  <p className="mt-1 text-sm text-slate-600">
                    {formatMetricValue(metricSummary.lowest[0].value, metric, per1000)}
                    {metricSummary.lowest.length > 3 && (
                      <span className="text-slate-500"> · {metricSummary.lowest.length} barangays tied</span>
                    )}
                  </p>
                )}
              </article>

              <article className="card p-5">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  {metric === RATE_METRIC
                    ? "City-wide rate"
                    : `City total · ${metricConfig.label}${per1000 ? " per 1,000" : ""}`}
                </p>
                <p className="mt-2 font-display text-lg font-bold text-slate-900">
                  {metric === RATE_METRIC
                    ? metricSummary?.total === null || metricSummary?.total === undefined
                      ? `Not ranked (n < ${minRateAnimals})`
                      : formatMetricValue(metricSummary.total, metric, per1000)
                    : formatSigned(metricSummary?.total ?? 0, metric, per1000)}
                </p>
                {metric === RATE_METRIC ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Distinct animals re-dispersed ÷ dispersed, up to the end of the period.
                  </p>
                ) : metric === "net_flow" ? (
                  <p className="mt-1 text-xs text-slate-500">
                    In {formatMetricValue(metricSummary?.in_total ?? 0, metric, false)}
                    {per1000 && metricSummary?.in_total_per_1000 !== undefined
                      ? ` (${Number(metricSummary.in_total_per_1000).toFixed(1)}/1,000)`
                      : ""}
                    {" · "}
                    Out {formatMetricValue(metricSummary?.out_total ?? 0, metric, false)}
                    {per1000 && metricSummary?.out_total_per_1000 !== undefined
                      ? ` (${Number(metricSummary.out_total_per_1000).toFixed(1)}/1,000)`
                      : ""}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    Active events, not unique animals.
                  </p>
                )}
                {previousPeriod && (
                  <p className="mt-2 text-xs text-slate-500">
                    {deltaLabel(metricSummary?.total, previous?.[metric], metric, per1000) ??
                      "No previous-period comparison"}{" "}
                    <span className="text-slate-400">
                      ({previousPeriod.from} to {previousPeriod.to})
                    </span>
                  </p>
                )}
              </article>
            </section>

            {metricSummary?.sentence && (
              <p className="text-sm text-slate-600 dark:text-slate-300">{metricSummary.sentence}</p>
            )}

            {per1000 && coverage && !coverage.complete && (
              <InlineAlert
                tone="info"
                message={`Population is recorded for ${coverage.recorded} of ${coverage.total} barangays. Per-1,000 values are blank where population is missing, so city totals cover only the recorded barangays.`}
              />
            )}

            {/* The bubble map with the flow layer. */}
            <section className="card p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                    Barangay map · {metricConfig.label}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Click or tap a barangay for its animal mix and handovers.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
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
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      checked={includeCvo}
                      onChange={(event) => updateParams({ include_cvo: event.target.checked ? 1 : "" })}
                    />
                    Include CVO as a source
                  </label>
                </div>
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
                    detailQuery={query}
                  />
                </Suspense>
              </div>
            </section>

            {/* Compare up to three barangays side by side. */}
            <section className="card p-6">
              <details open={compareRows.length > 0}>
                <summary className="cursor-pointer font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                  Compare barangays
                </summary>
                <div className="mt-4 flex flex-wrap gap-3">
                  {[0, 1, 2].map((index) => (
                    <div key={index}>
                      <label
                        htmlFor={`bd-compare-${index}`}
                        className="block text-xs font-semibold text-slate-600"
                      >
                        Barangay {index + 1}
                      </label>
                      <select
                        id={`bd-compare-${index}`}
                        value={compareIds[index]}
                        onChange={(event) => setCompareAt(index, event.target.value)}
                        className="field mt-1 w-48 text-xs"
                      >
                        <option value="">None</option>
                        {barangays.map((row) => (
                          <option key={row.barangay_id} value={row.barangay_id}>
                            {row.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                {compareRows.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-xs" aria-label="Barangay comparison">
                      <caption className="sr-only">
                        The selected barangays compared across every metric, in the current display unit.
                      </caption>
                      <thead>
                        <tr className="border-b border-slate-200 text-[11px] tracking-wide text-slate-500 uppercase dark:border-slate-700">
                          <th scope="col" className="py-2 pr-3 font-semibold">Metric</th>
                          {compareRows.map((row) => (
                            <th key={row.barangay_id} scope="col" className="py-2 pr-3 text-right font-semibold">
                              {row.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { key: "population", label: "Population", per1000: false },
                          { key: "dispersed", label: "Dispersal events" },
                          { key: "redispersed_out", label: "Re-dispersals out" },
                          { key: "redispersed_in", label: "Re-dispersals in" },
                          { key: "within_barangay", label: "Within barangay", per1000: false },
                          { key: "net_flow", label: "Net flow" },
                          { key: RATE_METRIC, label: "Re-dispersal rate" },
                          { key: "rate_denominator", label: "Rate n (animals)", per1000: false },
                        ].map((row) => (
                          <tr key={row.key} className="border-b border-slate-100 dark:border-slate-800">
                            <th scope="row" className="py-1.5 pr-3 font-medium text-slate-700 dark:text-slate-300">
                              {row.label}
                              {row.key === "rate_denominator" ? "" : per1000 && row.per1000 !== false ? " /1,000" : ""}
                            </th>
                            {compareRows.map((barangay) => {
                              const value =
                                row.key === "rate_denominator" || row.per1000 === false
                                  ? barangay[row.key]
                                  : per1000 && row.key !== RATE_METRIC
                                    ? barangay[`${row.key}_per_1000`]
                                    : barangay[row.key];
                              return (
                                <td key={barangay.barangay_id} className="py-1.5 pr-3 text-right tabular-nums">
                                  {row.key === RATE_METRIC && value === null
                                    ? `n < ${minRateAnimals}`
                                    : formatMetricValue(value, row.key, per1000)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            </section>

            {/* The barangay table: the exact data behind the map, every
                metric at once, sortable by any column. */}
            <section className="card p-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                    Barangay table
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Counts are active events, not unique animals. The rate uses distinct animals.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="bd-search" className="sr-only">
                    Search barangays
                  </label>
                  <div className="relative">
                    <Icon
                      name="search"
                      className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      id="bd-search"
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search barangays"
                      className="field !w-52 !py-1.5 !pl-8 text-xs"
                    />
                  </div>
                  <p className="text-xs text-slate-500" aria-live="polite">
                    {filteredRows.length} of {barangays.length}
                  </p>
                </div>
              </div>

              <div className="mt-4 max-h-[70vh] overflow-auto" tabIndex={0}>
                <table
                  className="w-full text-left text-xs"
                  aria-label="All barangay metrics"
                >
                  <caption className="sr-only">
                    Dispersed, re-dispersed and net movement per barangay, with the re-dispersal rate and its denominator. Click a column heading to sort.
                  </caption>
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] tracking-wide text-slate-500 uppercase dark:border-slate-700">
                      <th scope="col" className="sticky left-0 top-0 z-20 w-14 bg-white py-2 pr-3 font-semibold dark:bg-slate-900">
                        Rank
                      </th>
                      {COLUMNS.map((column) => {
                        const active = sortKey === column.key;
                        return (
                          <th
                            key={column.key}
                            scope="col"
                            aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                            className={`sticky top-0 z-10 bg-white py-2 pr-3 font-semibold dark:bg-slate-900 ${
                              column.align === "right" ? "text-right" : "text-left"
                            } ${column.key === "name" ? "left-14 z-20" : ""}`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleSort(column.key)}
                              className="inline-flex items-center gap-1 hover:text-brand-800"
                            >
                              {column.label}
                              {per1000 && column.per1000 ? " /1,000" : ""}
                              {active && (
                                <span aria-hidden="true" className="text-brand-700">
                                  {sortDir === "asc" ? "↑" : "↓"}
                                </span>
                              )}
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const rank = rankById.get(row.barangay_id);
                      const highlighted = rank !== undefined && rank <= 3;

                      return (
                        <tr
                          key={row.barangay_id}
                          className={`border-b border-slate-100 dark:border-slate-800 ${highlighted ? "font-semibold" : ""}`}
                        >
                          <td className="sticky left-0 z-10 w-14 bg-white py-1.5 pr-3 tabular-nums dark:bg-slate-900">
                            {rank === undefined ? "—" : `#${rank}`}
                          </td>
                          <th scope="row" className="sticky left-14 z-10 bg-white py-1.5 pr-3 text-left font-medium dark:bg-slate-900">
                            {row.name}
                          </th>
                          <td className="py-1.5 pr-3 text-right tabular-nums">
                            {row.population ?? "—"}
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">
                            {formatMetricValue(per1000 ? row.dispersed_per_1000 : row.dispersed, "dispersed", per1000)}
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">
                            {formatMetricValue(per1000 ? row.redispersed_out_per_1000 : row.redispersed_out, "redispersed_out", per1000)}
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">
                            {formatMetricValue(per1000 ? row.redispersed_in_per_1000 : row.redispersed_in, "redispersed_in", per1000)}
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{row.within_barangay}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">
                            {formatSigned(per1000 ? row.net_flow_per_1000 : row.net_flow, "net_flow", per1000)}
                          </td>
                          <td
                            className={`py-1.5 pr-3 text-right tabular-nums ${
                              row.redispersal_rate === null ? "text-slate-400" : ""
                            }`}
                          >
                            {row.redispersal_rate === null
                              ? `n < ${minRateAnimals}`
                              : formatMetricValue(row.redispersal_rate, RATE_METRIC, per1000)}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{row.rate_denominator}</td>
                        </tr>
                      );
                    })}
                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={COLUMNS.length + 1} className="py-6 text-center text-slate-500">
                          No barangay matches “{search}”.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-300 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                      <td className="sticky left-0 z-10 w-14 bg-white py-2 pr-3 dark:bg-slate-900" />
                      <th scope="row" className="sticky left-14 z-10 bg-white py-2 pr-3 text-left dark:bg-slate-900">
                        City total
                      </th>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {populationSum > 0 ? populationSum : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatMetricValue(summary.dispersed?.total, "dispersed", per1000)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatMetricValue(summary.redispersed_out?.total, "redispersed_out", per1000)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatMetricValue(summary.redispersed_in?.total, "redispersed_in", per1000)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{withinTotal}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatSigned(summary.net_flow?.total, "net_flow", per1000)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {summary.redispersal_rate?.total === null || summary.redispersal_rate?.total === undefined
                          ? `n < ${minRateAnimals}`
                          : formatMetricValue(summary.redispersal_rate.total, RATE_METRIC, per1000)}
                      </td>
                      <td className="py-2 text-right tabular-nums">—</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            {/* Definitions — the same wording the Excel summary sheet uses. */}
            <section className="card p-6">
              <details>
                <summary className="cursor-pointer font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                  How these numbers are defined
                </summary>
                <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs text-slate-600 sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold text-slate-700">Dispersal events</dt>
                    <dd>Active dispersal events delivered into the barangay (CVO → household). Events, not unique animals.</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-700">Re-dispersals out / in</dt>
                    <dd>Household-to-household handovers, counted for the origin and the destination. Events, not unique animals.</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-700">Within barangay</dt>
                    <dd>Handovers whose source and destination are the same barangay. Counted in and out, never drawn as a flow line.</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-700">Net flow</dt>
                    <dd>Re-dispersals in minus re-dispersals out. Initial CVO dispersals are not part of it.</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-700">Cumulative re-dispersal rate</dt>
                    <dd>Distinct animals re-dispersed out divided by distinct animals dispersed in, from the beginning of records through the period end. Not ranked below {minRateAnimals} dispersed animals.</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-700">Per 1,000 residents</dt>
                    <dd>Count divided by barangay population, multiplied by 1,000. Blank when population is not recorded.</dd>
                  </div>
                </dl>
              </details>
            </section>

            {/* The matrix: exact numbers, works without a mouse. Collapsed by
                default — the map and top flows already cover the common case. */}
            <section className="card p-6">
              <details>
                <summary className="cursor-pointer font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                  Flow matrix
                </summary>
                <p className="mt-2 text-xs text-slate-500">
                  Origin rows, destination columns. The diagonal is re-dispersal
                  within the same barangay — counted in the totals, never drawn as
                  a flow line.
                </p>
                {flowsError ? (
                  <p className="mt-3 text-sm text-slate-500">Flow data could not be loaded.</p>
                ) : (
                  <FlowMatrix barangays={barangays} flows={flows} />
                )}
              </details>
            </section>
          </>
        )
      )}
    </div>
  );
}
