import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { reportsApi } from "../api/reportsApi";
import { monitoringApi } from "../api/monitoringApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { MonthYearDropdown } from "../components/MonthYearDropdown";
import { AnimalTypeDropdown } from "../components/AnimalTypeDropdown";
import { Icon } from "../components/Icons";
import { getRole } from "../config/roles";

/**
 * Admin "Reports" screen — the city-wide program overview, with charts.
 *
 * Read-only by construction: every number is the API's aggregate over records
 * some other screen owns. The five charts each pull from ONE dedicated
 * aggregation endpoint (see reportsApi) — the database computes the numbers,
 * this page only renders them, so a chart can never quietly disagree with the
 * per-barangay table that anchors the page.
 *
 * Filters follow each chart's own semantics rather than one global filter
 * row: the dispersal charts take the barangay + date range + animal type,
 * the type distribution takes the Monitoring Records month/year filter, and
 * workload takes the barangay slice.
 *
 * Series colours are the UI's own brand/earth palette (index.css), not the
 * charting library's defaults — a chart is part of this page, not an app
 * embedded in it.
 */

/** brand / earth tokens from index.css, as concrete values for SVG. */
const CHART_COLORS = {
  primary: "#558b2f", // brand-700
  accent: "#8bc34a", // brand-400
  deep: "#2d4d19", // brand-900
  earth: "#a1784d", // earth-500
  sand: "#d2b48c", // earth-300
  clay: "#bb9469", // earth-400
};

/** The donut's slice palette: greens for the herd, earth tones for the rest. */
const PIE_COLORS = [CHART_COLORS.primary, CHART_COLORS.accent, CHART_COLORS.earth, CHART_COLORS.sand, CHART_COLORS.deep, CHART_COLORS.clay];

const AXIS_STYLE = { fontSize: 11, fill: "#64748b" };

/** Small labelled figure used across the summary bands. */
function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3">
      <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        {label}
      </p>
      <p className="mt-1 font-display text-xl font-bold text-slate-900">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

/**
 * One chart's data lifecycle — independent fetch, independent skeleton, so a
 * slow chart never delays the page and a failed chart degrades to its own
 * empty frame instead of blanking the screen.
 */
function useChart(loader) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    loader()
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch((err) => {
        if (active) setState({ data: null, loading: false, error: getErrorMessage(err) });
      });

    return () => {
      active = false;
    };
  }, [loader, tick]);

  return { ...state, refresh: useCallback(() => setTick((t) => t + 1), []) };
}

/** Card frame: title + loading/empty/error states around the chart body. */
function ChartCard({ title, caption, state, isEmpty, emptyTitle, emptyDescription, children }) {
  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
          {title}
        </h3>
        {caption && <p className="text-xs text-slate-500">{caption}</p>}
      </div>

      {state.loading ? (
        <div className="mt-4">
          <SkeletonList rows={3} rowClassName="h-24" />
        </div>
      ) : state.error ? (
        <div className="mt-4">
          <InlineAlert message={state.error} />
        </div>
      ) : isEmpty ? (
        <div className="mt-4">
          <EmptyState title={emptyTitle} description={emptyDescription} />
        </div>
      ) : (
        <div className="mt-4 h-72">{children}</div>
      )}
    </section>
  );
}

export default function ReportsPage({ roleKey = "admin" }) {
  const config = getRole(roleKey);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [barangay, setBarangay] = useState("");
  const [from, setFrom] = useState("");
  const [animalType, setAnimalType] = useState(null);
  const [month, setMonth] = useState(null);
  const [typeOptions, setTypeOptions] = useState([]);
  const [monthOptions, setMonthOptions] = useState([]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const report = await reportsApi.cityWide({
        barangay: barangay || undefined,
        from: from || undefined,
      });

      setData(report);
    } catch (err) {
      if (!quiet) setError(getErrorMessage(err));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [barangay, from]);

  useEffect(() => {
    load();
  }, [load]);

  // Quietly re-fetch so the figures track records logged elsewhere.
  useAutoRefresh(load);

  // The Monitoring Records filters' own option sources — the same lists that
  // screen uses, so the filters cannot offer a value the data never had.
  useEffect(() => {
    let active = true;

    monitoringApi.animalTypes().then((types) => active && setTypeOptions(types)).catch(() => {});
    monitoringApi.months().then((months) => active && setMonthOptions(months)).catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  // Chart loaders — each re-runs when ITS filters move.
  const trendState = useChart(
    useCallback(
      () =>
        reportsApi.dispersalTrend({
          barangay: barangay || undefined,
          animal_type: animalType ?? undefined,
          from: from || undefined,
        }),
      [barangay, animalType, from],
    ),
  );
  const byBarangayState = useChart(
    useCallback(
      () => reportsApi.animalsByBarangay({ animal_type: animalType ?? undefined, from: from || undefined }),
      [animalType, from],
    ),
  );
  const complianceState = useChart(
    useCallback(
      () =>
        reportsApi.vaccinationCompliance({
          barangay: barangay || undefined,
          animal_type: animalType ?? undefined,
        }),
      [barangay, animalType],
    ),
  );
  const distributionState = useChart(
    useCallback(
      () => reportsApi.animalTypeDistribution({ month: month ?? undefined, from: from || undefined }),
      [month, from],
    ),
  );
  const workloadState = useChart(
    useCallback(() => reportsApi.technicianWorkload({ barangay: barangay || undefined }), [barangay]),
  );

  const barangays = data?.scope?.barangays ?? [];
  const program = data?.program ?? {};
  const activity = data?.activity ?? {};
  const clinical = data?.clinical ?? {};
  const rows = data?.per_barangay ?? [];

  const trend = trendState.data ?? [];
  const byBarangay = byBarangayState.data ?? [];
  const compliance = complianceState.data ?? [];
  const distribution = distributionState.data ?? [];
  const workload = workloadState.data ?? [];

  // Chart-empty predicates: a chart with rows but no signal (all zeros) is an
  // empty chart too — an empty frame beats a flat line at the axis floor.
  const trendEmpty = trend.length === 0 || trend.every((m) => m.dispersals === 0 && m.re_dispersals === 0);
  const byBarangayEmpty = byBarangay.length === 0 || byBarangay.every((b) => b.dispersals === 0);
  const complianceEmpty = compliance.length === 0 || compliance.every((m) => m.rate === null);
  const distributionEmpty = distribution.length === 0;
  const workloadEmpty = workload.length === 0;

  // The busiest month leads the trend band, so the page answers "when was the
  // program most active" without anyone reading twelve points.
  const peakMonth = trend.reduce(
    (best, m) => (m.dispersals > (best?.dispersals ?? -1) ? m : best),
    null,
  );
  const topBarangay = byBarangay.reduce(
    (best, b) => (b.dispersals > (best?.dispersals ?? -1) ? b : best),
    null,
  );

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{config?.label ?? "Administrator"}</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Reports
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              City-wide program reporting: households served, field activity and
              clinical load, per barangay and across the whole city. Every
              figure is drawn live from the records — nothing is encoded here.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="reports-barangay"
                className="block text-xs font-semibold text-slate-600"
              >
                Barangay
              </label>
              <select
                id="reports-barangay"
                value={barangay}
                onChange={(event) => setBarangay(event.target.value)}
                className="field mt-1 w-44 text-xs"
              >
                <option value="">All barangays</option>
                {barangays.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="reports-from"
                className="block text-xs font-semibold text-slate-600"
              >
                Dispersals since
              </label>
              <input
                id="reports-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="field mt-1 w-40 text-xs"
              />
            </div>

            {/* The Monitoring Records filters, where they apply. */}
            <AnimalTypeDropdown
              types={typeOptions}
              selected={animalType}
              onSelect={setAnimalType}
            />
            <MonthYearDropdown
              months={monthOptions}
              selected={month}
              onSelect={setMonth}
            />
          </div>
        </div>

        {(barangay || animalType || month) && (
          <p className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-pill bg-brand-50 px-3.5 py-1.5 text-xs font-semibold text-brand-800">
            <Icon name="map-pin" className="h-3.5 w-3.5" />
            Scoped to: {[barangay || "all barangays", animalType ?? "all types", month ? `month ${month}` : "all months"].join(" · ")}
          </p>
        )}
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}

      {loading ? (
        <section className="card overflow-hidden">
          <SkeletonList rows={3} rowClassName="h-16" />
        </section>
      ) : !data ? (
        <section className="card">
          <EmptyState
            title="Report unavailable"
            description="The report could not be loaded. Check the connection and try again."
          />
        </section>
      ) : (
        <>
          {/* Program size */}
          <section className="card p-6">
            <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
              Program
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Households" value={program.households ?? 0} />
              <Stat label="Animals tagged" value={program.animals ?? 0} />
              <Stat
                label="With technician"
                value={program.with_technician ?? 0}
                hint="Actively monitored"
              />
              <Stat
                label="Unassigned"
                value={program.unassigned ?? 0}
                hint="Awaiting a technician"
              />
            </div>
          </section>

          {/* Field activity + clinical load */}
          <section className="grid gap-6 lg:grid-cols-2">
            <div className="card p-6">
              <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                Field activity
              </h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Stat label="Monitoring visits" value={activity.monitoring_visits ?? 0} />
                <Stat label="Field visits" value={activity.field_visits ?? 0} />
                <Stat
                  label="Visits with GPS fix"
                  value={activity.field_visits_with_location ?? 0}
                  hint="Of the field visits above"
                />
                <Stat label="Dispersals" value={activity.dispersals ?? 0} />
                <Stat label="Re-dispersals" value={activity.re_dispersals ?? 0} />
                {"dispersals_since" in activity && (
                  <Stat label="Dispersals since filter date" value={activity.dispersals_since ?? 0} />
                )}
              </div>
            </div>

            <div className="card p-6">
              <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                Clinical
              </h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Stat label="Health records" value={clinical.health_records ?? 0} />
                <Stat
                  label="Open cases"
                  value={clinical.open_cases ?? 0}
                  hint="No outcome, or still improving"
                />
                <Stat label="Case notes" value={clinical.case_notes ?? 0} />
                <Stat label="Vaccinations logged" value={clinical.vaccinations ?? 0} />
              </div>

              {Object.keys(clinical.by_outcome ?? {}).length > 0 && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                    Outcomes
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(clinical.by_outcome).map(([outcome, count]) => (
                      <span
                        key={outcome}
                        className="rounded-pill bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700 capitalize"
                      >
                        {outcome}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Chart 1 — dispersal trend over time */}
          <ChartCard
            title="Dispersal trend"
            caption={
              peakMonth && peakMonth.dispersals > 0
                ? `Busiest: ${peakMonth.label} (${peakMonth.dispersals})`
                : undefined
            }
            state={trendState}
            isEmpty={trendEmpty}
            emptyTitle="No dispersals in this window"
            emptyDescription="Once animals are dispersed, the monthly trend draws itself here."
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} />
                <YAxis allowDecimals={false} tick={AXIS_STYLE} tickLine={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="dispersals"
                  name="Dispersals"
                  stroke={CHART_COLORS.primary}
                  strokeWidth={2}
                  dot={{ r: 3, fill: CHART_COLORS.primary }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="re_dispersals"
                  name="Re-dispersals"
                  stroke={CHART_COLORS.earth}
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={{ r: 3, fill: CHART_COLORS.earth }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Charts 2 + 3 side by side */}
          <section className="grid gap-6 xl:grid-cols-2">
            <ChartCard
              title="Animals dispersed by barangay"
              caption={
                topBarangay && topBarangay.dispersals > 0
                  ? `Most: ${topBarangay.barangay} (${topBarangay.dispersals})`
                  : undefined
              }
              state={byBarangayState}
              isEmpty={byBarangayEmpty}
              emptyTitle="No dispersals match the filter"
              emptyDescription="Every covered barangay appears here — with zero where nothing has been dispersed yet."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byBarangay} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="barangay"
                    tick={{ ...AXIS_STYLE, fontSize: 10 }}
                    tickLine={false}
                    interval={0}
                    angle={-40}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis allowDecimals={false} tick={AXIS_STYLE} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="dispersals" name="Dispersals" fill={CHART_COLORS.accent} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Vaccination compliance"
              caption="Share of animals inside the vaccination cycle, per month"
              state={complianceState}
              isEmpty={complianceEmpty}
              emptyTitle="No compliance data yet"
              emptyDescription="The rate appears once animals are registered — before that there is nothing to be compliant with."
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={compliance} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} />
                  <YAxis
                    domain={[0, 100]}
                    tick={AXIS_STYLE}
                    tickLine={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip formatter={(value) => [`${value}%`, "Compliant"]} />
                  <Line
                    type="monotone"
                    dataKey="rate"
                    name="Compliant (%)"
                    stroke={CHART_COLORS.primary}
                    strokeWidth={2}
                    dot={{ r: 3, fill: CHART_COLORS.primary }}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          {/* Charts 4 + 5 side by side */}
          <section className="grid gap-6 xl:grid-cols-2">
            <ChartCard
              title="Animal type distribution"
              caption={month ? `Monitoring records in ${month}` : "All monitoring records"}
              state={distributionState}
              isEmpty={distributionEmpty}
              emptyTitle="No monitoring records match"
              emptyDescription="The donut fills in as monitoring visits are logged."
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={distribution}
                    dataKey="animals"
                    nameKey="animal_type"
                    innerRadius="55%"
                    outerRadius="85%"
                    paddingAngle={2}
                  >
                    {distribution.map((entry, index) => (
                      <Cell key={entry.animal_type} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Technician workload"
              caption="Households currently assigned, per technician"
              state={workloadState}
              isEmpty={workloadEmpty}
              emptyTitle="No technicians yet"
              emptyDescription="Technician accounts appear here as they are created under User Management."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={workload}
                  layout="vertical"
                  margin={{ top: 8, right: 24, bottom: 0, left: 24 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={AXIS_STYLE} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="technician"
                    width={120}
                    tick={{ ...AXIS_STYLE, fontSize: 10 }}
                    tickLine={false}
                  />
                  <Tooltip />
                  <Bar dataKey="households" name="Households" fill={CHART_COLORS.earth} radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          {/* Per-barangay table — the anchor the charts must agree with */}
          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
              <h3 className="font-display text-xs font-semibold tracking-wide text-slate-700 uppercase">
                Per barangay
              </h3>
            </div>

            {rows.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No households in this scope"
                  description="No beneficiary records match the current filter yet."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <colgroup>
                    <col className="w-[25%]" />
                    {Array.from({ length: 5 }, (_, i) => (
                      <col key={i} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] tracking-wide text-slate-500 uppercase">
                      <th className="px-4 py-2.5 font-semibold">Barangay</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Households</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Monitoring</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Field visits</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Health records</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Dispersals</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row) => (
                      <tr key={row.barangay} className="transition hover:bg-brand-50/40">
                        <td className="px-4 py-3 font-semibold text-slate-900">{row.barangay}</td>
                        <td className="px-4 py-3 text-right">{row.households}</td>
                        <td className="px-4 py-3 text-right">{row.monitoring_visits}</td>
                        <td className="px-4 py-3 text-right">{row.field_visits}</td>
                        <td className="px-4 py-3 text-right">{row.health_records}</td>
                        <td className="px-4 py-3 text-right">{row.dispersals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
