import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { ReportExportPanel } from "../components/ReportExportPanel";
import { Modal } from "../components/Modal";
import { Icon } from "../components/Icons";
import { FilterField, FilterToolbar } from "../components/FilterToolbar";
import { SearchField } from "../components/SearchField";
import { getRole } from "../config/roles";
import { CHART_COLORS, PIE_COLORS, AXIS_STYLE } from "../lib/charts";
import { useChart } from "../hooks/useChart";
import { ChartCard } from "../components/ChartCard";
import { StatCard } from "../components/StatCard";
import { downloadCsv } from "../lib/downloadCsv";

const CATEGORY_OPTIONS = [
  { value: "", label: "All animal categories" },
  { value: "livestock", label: "Livestock" },
  { value: "poultry", label: "Poultry" },
  { value: "other", label: "Other farm animals" },
];

const DISPERSAL_STATUS_OPTIONS = [
  { value: "", label: "All dispersal statuses" },
  { value: "dispersal", label: "Initial dispersal" },
  { value: "re_dispersal", label: "Re-dispersal" },
  { value: "pass_on", label: "Pass-on" },
];

const CSV_COLUMNS = [
  { key: "barangay", label: "Barangay" },
  { key: "households", label: "Beneficiaries" },
  { key: "dispersals", label: "Dispersal events" },
  { key: "livestock", label: "Livestock" },
  { key: "poultry", label: "Poultry" },
  { key: "other", label: "Other farm animals" },
  { key: "monitoring_visits", label: "Monitoring visits" },
  { key: "field_visits", label: "Field visits" },
  { key: "health_records", label: "Health records" },
];

function categoryLabel(value) {
  return CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? "All animal categories";
}

function dispersalStatusLabel(value) {
  return (
    DISPERSAL_STATUS_OPTIONS.find((option) => option.value === value)?.label ??
    "All dispersal statuses"
  );
}

function formatGeneratedAt(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

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

/**
 * On-site verification counts (Feature 1) — how the field log's geotagged
 * visits were judged against each household's registered pin. Its own card
 * because it is a count, not a chart, and it must survive a chart outage.
 */
function VerificationCard({ roleKey }) {
  const state = useChart(useCallback(() => reportsApi.verificationSummary(), []));
  const counts = state.data?.counts ?? {};
  const total = state.data?.total ?? 0;
  const review = state.data?.review_count ?? 0;

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
          Visit verification
        </h3>
        {state.data && (
          <p className="text-xs text-slate-500">
            On-site threshold: {state.data.threshold_m} m
          </p>
        )}
      </div>

      {state.loading ? (
        <div className="mt-4">
          <SkeletonList rows={2} rowClassName="h-16" />
        </div>
      ) : state.error ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <InlineAlert message={state.error} />
          <button
            type="button"
            onClick={state.refresh}
            className="btn-secondary !px-3.5 !py-1.5 text-xs"
          >
            Try again
          </button>
        </div>
      ) : total === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No field visits yet"
            description="Verdicts appear once the field team logs geotagged visits."
          />
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm text-slate-600">
            <Link
              to={`/dashboard/${roleKey}/field-visits?verification=review`}
              className="font-semibold text-brand-800 underline-offset-2 hover:underline"
            >
              {review} off-site / need review
            </Link>{" "}
            of {total} geotagged visits — open the filtered list to look at them.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="On site" value={counts.on_site ?? 0} />
            <StatCard label="Off site" value={counts.off_site ?? 0} />
            <StatCard label="Low accuracy" value={counts.low_accuracy ?? 0} />
            <StatCard label="No registered pin" value={counts.no_reference_location ?? 0} />
            <StatCard label="No GPS" value={counts.no_gps ?? 0} />
          </div>

          <p className="mt-4 text-xs text-slate-500">
            GPS can be inaccurate or spoofed, so these verdicts flag visits for
            human review — they are not proof that anyone was (or was not) on
            site, and they are not a diagnosis.
          </p>
        </>
      )}
    </section>
  );
}

export default function ReportsPage({ roleKey = "admin" }) {
  const config = getRole(roleKey);
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [barangay, setBarangay] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState("");
  const [animalType, setAnimalType] = useState(null);
  const [beneficiary, setBeneficiary] = useState("");
  const [dispersalType, setDispersalType] = useState("");
  const [month, setMonth] = useState(null);
  const [typeOptions, setTypeOptions] = useState([]);
  const [monthOptions, setMonthOptions] = useState([]);
  const [sort, setSort] = useState({ key: "barangay", dir: "asc" });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recent, setRecent] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const report = await reportsApi.cityWide({
        barangay: barangay || undefined,
        from: from || undefined,
        to: to || undefined,
        category: category || undefined,
        animal_type: animalType ?? undefined,
        beneficiary: beneficiary.trim() || undefined,
        dispersal_type: dispersalType || undefined,
      });

      setData(report);
    } catch (err) {
      if (!quiet) setError(getErrorMessage(err));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [barangay, from, to, category, animalType, beneficiary, dispersalType]);

  useEffect(() => {
    load();
  }, [load]);

  const loadRecent = useCallback(async () => {
    try {
      setRecent(await reportsApi.recentExports());
    } catch {
      // A history outage must never hide the live report.
      setRecent([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

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
          category: category || undefined,
          beneficiary: beneficiary.trim() || undefined,
          dispersal_type: dispersalType || undefined,
          from: from || undefined,
          to: to || undefined,
        }),
      [barangay, animalType, category, beneficiary, dispersalType, from, to],
    ),
  );
  const byBarangayState = useChart(
    useCallback(
      () =>
        reportsApi.animalsByBarangay({
          animal_type: animalType ?? undefined,
          category: category || undefined,
          beneficiary: beneficiary.trim() || undefined,
          dispersal_type: dispersalType || undefined,
          from: from || undefined,
          to: to || undefined,
        }),
      [animalType, category, beneficiary, dispersalType, from, to],
    ),
  );
  const complianceState = useChart(
    useCallback(
      () =>
        reportsApi.vaccinationCompliance({
          barangay: barangay || undefined,
          animal_type: animalType ?? undefined,
          beneficiary: beneficiary.trim() || undefined,
        }),
      [barangay, animalType, beneficiary],
    ),
  );
  const distributionState = useChart(
    useCallback(
      () =>
        reportsApi.animalTypeDistribution({
          month: month ?? undefined,
          from: from || undefined,
          beneficiary: beneficiary.trim() || undefined,
        }),
      [month, from, beneficiary],
    ),
  );
  const workloadState = useChart(
    useCallback(
      () =>
        reportsApi.technicianWorkload({
          barangay: barangay || undefined,
          beneficiary: beneficiary.trim() || undefined,
        }),
      [barangay, beneficiary],
    ),
  );

  const barangays = data?.scope?.barangays ?? [];
  const program = data?.program ?? {};
  const activity = data?.activity ?? {};
  const clinical = data?.clinical ?? {};
  const rows = useMemo(() => data?.per_barangay ?? [], [data]);

  const sortedRows = useMemo(() => {
    const value = (row) => row[sort.key];

    return [...rows].sort((a, b) => {
      const result =
        typeof value(a) === "string"
          ? value(a).localeCompare(value(b))
          : (value(a) ?? 0) - (value(b) ?? 0);

      return sort.dir === "asc" ? result : -result;
    });
  }, [rows, sort]);

  function toggleSort(key) {
    setSort((current) => {
      if (current.key === key) {
        return { key, dir: current.dir === "desc" ? "asc" : "desc" };
      }
      return { key, dir: key === "barangay" ? "asc" : "desc" };
    });
  }

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

  const dispersals = data?.dispersals ?? {};
  const filterSummary = [
    barangay || "all barangays",
    categoryLabel(category),
    animalType ?? "all types",
    dispersalType ? dispersalStatusLabel(dispersalType) : null,
    beneficiary.trim() ? `beneficiary “${beneficiary.trim()}”` : null,
    month ? `month ${month}` : "all months",
    from || to ? `${from || "earliest"} to ${to || "today"}` : "all dates",
  ]
    .filter(Boolean)
    .join(" · ");

  function exportTableCsv() {
    if (sortedRows.length === 0) return;

    const scope = [barangay || "all-barangays", category || "all-categories", from || "all-dates", to || "today"]
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    downloadCsv(sortedRows, CSV_COLUMNS, `cvo-barangay-report-${scope}.csv`);
  }

  function applyRecentFilters(report) {
    const filters = report.filters ?? {};

    setBarangay(filters.barangay ?? "");
    setFrom(filters.from ?? "");
    setTo(filters.to ?? "");
    setCategory(filters.category ?? "");
    setAnimalType(filters.animal_type ?? null);
    setBeneficiary(filters.beneficiary ?? "");
    setDispersalType(filters.dispersal_type ?? "");
    setMonth(filters.month ?? null);
    document.getElementById("report-overview")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
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

          <FilterToolbar
            className="w-full min-w-0 xl:max-w-4xl"
            collapsible
            search={
              <SearchField
                id="reports-beneficiary"
                value={beneficiary}
                onChange={setBeneficiary}
                label="Beneficiary"
                placeholder="Name or RSBSA #"
              />
            }
            onReset={() => {
              setBarangay("");
              setBeneficiary("");
              setCategory("");
              setDispersalType("");
              setFrom("");
              setTo("");
              setAnimalType("");
              setMonth(null);
            }}
          >
            <FilterField label="Barangay" htmlFor="reports-barangay">
              <select
                id="reports-barangay"
                value={barangay}
                onChange={(event) => setBarangay(event.target.value)}
                className="field"
              >
                <option value="">All barangays</option>
                {barangays.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Animal category" htmlFor="reports-category">
              <select
                id="reports-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="field"
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Dispersal status" htmlFor="reports-status">
              <select
                id="reports-status"
                value={dispersalType}
                onChange={(event) => setDispersalType(event.target.value)}
                className="field"
              >
                {DISPERSAL_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Dispersals from" htmlFor="reports-from">
              <input
                id="reports-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="field"
              />
            </FilterField>

            <FilterField label="To" htmlFor="reports-to">
              <input
                id="reports-to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
                className="field"
              />
            </FilterField>

            {/* The Monitoring Records filters, where they apply. */}
            <FilterField label="Animal type" htmlFor="reports-animal-type">
              <AnimalTypeDropdown
                id="reports-animal-type"
                types={typeOptions}
                selected={animalType}
                onSelect={setAnimalType}
              />
            </FilterField>
            <FilterField label="Month">
              <MonthYearDropdown
                months={monthOptions}
                selected={month}
                onSelect={setMonth}
              />
            </FilterField>
          </FilterToolbar>
        </div>

        <nav aria-label="Report categories" className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <span className="mr-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            Report categories
          </span>
          {[
            { label: "Overview", href: "#report-overview" },
            { label: "Beneficiaries", to: `/dashboard/${roleKey}/beneficiaries` },
            { label: "Livestock dispersal", category: "livestock" },
            { label: "Poultry dispersal", category: "poultry" },
            { label: "Barangay comparison", href: "#report-barangay" },
            { label: "Field visits", to: `/dashboard/${roleKey}/field-visits` },
            { label: "Monitoring", to: `/dashboard/${roleKey}/monitoring` },
          ].map((item) => {
            if (item.to) {
              return (
                <Link key={item.label} to={item.to} className="rounded-pill border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-brand-300 hover:text-brand-800">
                  {item.label}
                </Link>
              );
            }

            if (item.category) {
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setCategory(category === item.category ? "" : item.category)}
                  aria-pressed={category === item.category}
                  className={`rounded-pill border px-3 py-1 text-xs font-semibold transition ${
                    category === item.category
                      ? "border-brand-300 bg-brand-50 text-brand-800"
                      : "border-slate-200 text-slate-700 hover:border-brand-300 hover:text-brand-800"
                  }`}
                >
                  {item.label}
                </button>
              );
            }

            return (
              <a
                key={item.label}
                href={item.href}
                className="rounded-pill border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-brand-300 hover:text-brand-800"
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        {(barangay || animalType || beneficiary || dispersalType || month || from || to || category) && (
          <p className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-pill bg-brand-50 px-3.5 py-1.5 text-xs font-semibold text-brand-800">
            <Icon name="map-pin" className="h-3.5 w-3.5" />
            Filters: {filterSummary}
          </p>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          The overview and per-barangay comparison use active ownership events;
          program totals follow the barangay, category and type scope. Each chart
          states the filters it applies in its caption.
        </p>

        {/* The printable report: the office's own template, filled for the
            filters above, under an editable report name. */}
        <ReportExportPanel
          barangay={barangay}
          month={month}
          animalType={animalType}
          category={category}
          beneficiary={beneficiary.trim()}
          dispersalType={dispersalType}
          from={from}
          to={to}
          onExported={loadRecent}
        />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportTableCsv}
            disabled={sortedRows.length === 0}
            className="btn-secondary !px-3.5 !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="clipboard" className="h-3.5 w-3.5" />
            CSV table
          </button>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            disabled={!data}
            className="btn-secondary !px-3.5 !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="printer" className="h-3.5 w-3.5" />
            Preview &amp; print / PDF
          </button>

          {/* Barangay dispersal analytics — its own tab, with the bubble map,
              flow matrix and per-barangay ranking. */}
          <Link
            to={`/dashboard/${roleKey}/reports/barangay-dispersal`}
            className="btn-secondary !px-3.5 !py-1.5 text-xs"
          >
            Barangay dispersal analytics
            <Icon name="arrow-right" className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {error && (
        <div className="flex flex-wrap items-center gap-3">
          <InlineAlert message={error} onDismiss={() => setError(null)} />
          <button type="button" onClick={() => load()} className="btn-secondary !px-3.5 !py-1.5 text-xs">
            Try again
          </button>
        </div>
      )}

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
          {/* Overview — the five questions an administrator asks first. */}
          <section id="report-overview" className="card p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                Report overview
              </h3>
              <p className="text-[11px] text-slate-500">Active dispersal records, not estimates</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="Beneficiaries"
                value={program.households ?? 0}
                hint={`${program.with_technician ?? 0} with a technician`}
                to={`/dashboard/${roleKey}/beneficiaries`}
                icon="users"
              />
              <StatCard
                label="Livestock distributed"
                value={dispersals.livestock ?? 0}
                hint="Carabao, cattle, swine, goats, sheep…"
                icon="livestock"
              />
              <StatCard
                label="Poultry distributed"
                value={dispersals.poultry ?? 0}
                hint="Chicken, duck, quail, turkey…"
                icon="sprout"
              />
              <StatCard
                label="Completed dispersals"
                value={dispersals.total ?? 0}
                hint={`${dispersals.initial ?? 0} initial · ${dispersals.re_dispersals ?? 0} re-dispersals · ${dispersals.pass_ons ?? 0} pass-ons`}
                icon="shield"
              />
              <StatCard
                label="Pending follow-up"
                value={program.pending_follow_up ?? 0}
                hint={`Unassigned or no contact in ${program.follow_up_days ?? 60} days`}
                to={`/dashboard/${roleKey}/beneficiaries?monitoring=overdue`}
                icon="clock"
                tone="warning"
              />
            </div>
            {(dispersals.unclassified ?? 0) > 0 && (
              <p className="mt-3 text-[11px] text-slate-500">
                {dispersals.unclassified} delivery record(s) use an animal type not yet mapped to the master list.
              </p>
            )}
          </section>

          {/* Field activity + clinical load */}
          <section className="grid gap-6 lg:grid-cols-2">
            <div className="card p-6">
              <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                Field activity
              </h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <StatCard label="Monitoring visits" value={activity.monitoring_visits ?? 0} />
                <StatCard label="Field visits" value={activity.field_visits ?? 0} />
                <StatCard
                  label="Visits with GPS fix"
                  value={activity.field_visits_with_location ?? 0}
                  hint="Of the field visits above"
                />
                <StatCard label="Dispersals" value={activity.dispersals ?? 0} />
                <StatCard label="Re-dispersals" value={activity.re_dispersals ?? 0} />
              </div>
            </div>

            <div className="card p-6">
              <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                Clinical
              </h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <StatCard label="Health records" value={clinical.health_records ?? 0} />
                <StatCard
                  label="Open cases"
                  value={clinical.open_cases ?? 0}
                  hint="No outcome, or still improving"
                />
                <StatCard label="Case notes" value={clinical.case_notes ?? 0} />
                <StatCard label="Vaccinations logged" value={clinical.vaccinations ?? 0} />
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

          {/* On-site verification counts (Feature 1) */}
          <VerificationCard roleKey={roleKey} />

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
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e2d9" />
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
              title="Dispersal events by barangay"
              caption={
                topBarangay && topBarangay.dispersals > 0
                  ? `Most: ${topBarangay.barangay} (${topBarangay.dispersals}) · click a bar for records`
                  : "Click a bar to open its records"
              }
              state={byBarangayState}
              isEmpty={byBarangayEmpty}
              emptyTitle="No dispersals match the filter"
              emptyDescription="Every covered barangay appears here — with zero where nothing has been dispersed yet."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byBarangay} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e2d9" vertical={false} />
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
                  <Bar
                    dataKey="dispersals"
                    name="Dispersals"
                    fill={CHART_COLORS.accent}
                    radius={[4, 4, 0, 0]}
                    cursor="pointer"
                    onClick={(entry) => {
                      const name = entry?.barangay ?? entry?.payload?.barangay;
                      if (!name) return;
                      navigate(`/dashboard/${roleKey}/beneficiaries?barangay=${encodeURIComponent(name)}`);
                    }}
                  />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e2d9" />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e2d9" horizontal={false} />
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

          {/* Per-barangay comparison — the anchor the charts must agree with */}
          <section id="report-barangay" className="card overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
              <h3 className="font-display text-xs font-semibold tracking-wide text-slate-700 uppercase">
                Barangay comparison
              </h3>
              <p className="text-[11px] text-slate-500">
                Sort any column; open a barangay to see its beneficiary records.
              </p>
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
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] tracking-wide text-slate-500 uppercase">
                      {[
                        { key: "barangay", label: "Barangay" },
                        { key: "households", label: "Beneficiaries" },
                        { key: "dispersals", label: "Dispersals" },
                        { key: "livestock", label: "Livestock" },
                        { key: "poultry", label: "Poultry" },
                        { key: "other", label: "Other" },
                        { key: "monitoring_visits", label: "Monitoring" },
                        { key: "field_visits", label: "Field visits" },
                      ].map((column) => (
                        <th
                          key={column.key}
                          scope="col"
                          aria-sort={
                            sort.key === column.key
                              ? sort.dir === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                          className={`px-3 py-2.5 font-semibold ${
                            column.key === "barangay" ? "" : "text-right"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(column.key)}
                            className={`inline-flex items-center gap-1 uppercase transition hover:text-brand-800 ${
                              sort.key === column.key ? "text-brand-800" : ""
                            }`}
                          >
                            {column.label}
                            <span aria-hidden="true" className="text-[9px]">
                              {sort.key === column.key ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                            </span>
                          </button>
                        </th>
                      ))}
                      <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                        Records
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sortedRows.map((row) => (
                      <tr key={row.barangay} className="transition hover:bg-brand-50/40">
                        <td className="px-3 py-3 font-semibold text-slate-900">{row.barangay}</td>
                        <td className="px-3 py-3 text-right">{row.households}</td>
                        <td className="px-3 py-3 text-right">{row.dispersals}</td>
                        <td className="px-3 py-3 text-right">{row.livestock ?? 0}</td>
                        <td className="px-3 py-3 text-right">{row.poultry ?? 0}</td>
                        <td className="px-3 py-3 text-right">{row.other ?? 0}</td>
                        <td className="px-3 py-3 text-right">{row.monitoring_visits}</td>
                        <td className="px-3 py-3 text-right">{row.field_visits}</td>
                        <td className="px-3 py-3 text-right">
                          <Link
                            to={`/dashboard/${roleKey}/beneficiaries?barangay=${encodeURIComponent(row.barangay)}`}
                            className="text-xs font-semibold text-brand-800 underline-offset-2 hover:underline"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Recent exports are read from the audit trail — not a new table. */}
          <section id="report-recent" className="card overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
              <h3 className="font-display text-xs font-semibold tracking-wide text-slate-700 uppercase">
                Recent reports
              </h3>
              <p className="text-[11px] text-slate-500">From the audit trail · latest 8 exports</p>
            </div>

            {recentLoading ? (
              <SkeletonList rows={2} rowClassName="h-12" />
            ) : recent.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No report exports yet"
                  description="Excel, CSV and printable report generations will appear here with their filters."
                />
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recent.map((item) => {
                  const itemFilters = item.filters ?? {};
                  const hasFilters = Object.keys(itemFilters).length > 0;

                  return (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {item.category} · {formatGeneratedAt(item.generated_at)}
                          {item.actor ? ` · ${item.actor}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => applyRecentFilters(item)}
                        disabled={!hasFilters}
                        className="btn-secondary !px-3 !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Use filters
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <Modal
            open={previewOpen}
            title="Report preview"
            onClose={() => setPreviewOpen(false)}
            contentClassName="max-w-5xl"
          >
            <div className="print-area rounded-xl border border-slate-200 bg-white p-6 text-slate-900">
              <p className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase">
                City Veterinary Office · Bayawan City
              </p>
              <h2 className="mt-1 font-display text-xl font-bold">Livestock and Poultry Dispersal Report</h2>
              <p className="mt-1 text-xs text-slate-600">{filterSummary}</p>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                {[
                  ["Beneficiaries", program.households ?? 0],
                  ["Livestock", dispersals.livestock ?? 0],
                  ["Poultry", dispersals.poultry ?? 0],
                  ["Dispersals", dispersals.total ?? 0],
                  ["Follow-up", program.pending_follow_up ?? 0],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-slate-200 p-2">
                    <p className="text-[9px] font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
                    <p className="text-lg font-bold">{value}</p>
                  </div>
                ))}
              </div>

              <table className="mt-4 w-full text-[10px]">
                <thead>
                  <tr className="border-b border-slate-300 text-left">
                    {CSV_COLUMNS.map((column) => (
                      <th key={column.key} className="px-1 py-1 font-semibold">{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr key={row.barangay} className="border-b border-slate-100">
                      {CSV_COLUMNS.map((column) => (
                        <td key={column.key} className="px-1 py-1">{row[column.key] ?? 0}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-4 text-[9px] text-slate-500">
                Generated {new Date().toLocaleString()} from active program records.
              </p>
            </div>

            <div className="no-print mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setPreviewOpen(false)} className="btn-secondary">
                Close
              </button>
              <button type="button" onClick={() => window.print()} className="btn-primary">
                <Icon name="printer" className="h-4 w-4" />
                Print / Save as PDF
              </button>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
