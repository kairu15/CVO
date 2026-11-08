import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
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
import { useDashboardOverview } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { CHART_COLORS, AXIS_STYLE, PIE_COLORS } from "../lib/charts";
import { labelForAction, labelForEntity } from "../lib/auditLabels";
import { StatCard } from "../components/StatCard";
import { ChartCard } from "../components/ChartCard";
import { DashboardOverviewMap } from "../components/DashboardOverviewMap";
import { VerificationBadge, verificationLabel } from "../components/VerificationBadge";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { InlineAlert } from "../components/InlineAlert";
import { SkeletonList } from "../components/Skeleton";

// MapLibre-heavy widget — fetched only when this section mounts.
const BarangayDispersalWidget = lazy(() =>
  import("../components/BarangayDispersalWidget").then((m) => ({ default: m.BarangayDispersalWidget })),
);

/**
 * Admin "Overview" — the system-wide command center at /dashboard/admin.
 *
 * ONE aggregate endpoint (`GET /api/v1/admin/dashboard`) feeds every section:
 * the server composes it from the same services the module screens read, so
 * a KPI here can never disagree with the page it links to. This page only
 * renders — no client-side counting, no per-module fan-out.
 *
 * Sections, in reading order: KPIs → Monitoring → Beneficiaries → Field
 * visits → Technicians → Geography (map) → Barangay analytics → Recent
 * activity → Reports. Each links to the module that owns its data; each
 * degrades on its own (loading skeleton, error retry, zero-data empty state)
 * so one quiet module never blanks the command center.
 */

/** Whole-number formatting — the dashboard never shows decimals. */
const num = (value) => (value ?? 0).toLocaleString();

function formatDay(iso) {
  const parsed = new Date(`${iso}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatStamp(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Compact relative age for the activity strip ("3h ago"). */
function timeAgo(iso) {
  const date = new Date(iso);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (Number.isNaN(seconds)) return "—";
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

/** Month series → chart rows with a short label. */
const monthly = (series = []) =>
  series.map((row) => ({ ...row, short: row.label?.replace(/ \d{4}$/, "") ?? row.month }));

/** Section shell: heading + quick-access link + consistent spacing. */
function Section({ title, description, to, linkLabel, children }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-bold text-slate-900">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
        </div>
        {to && (
          <Link
            to={to}
            className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-[11px] font-semibold text-brand-800 hover:bg-brand-100"
          >
            {linkLabel ?? "Open module"}
            <Icon name="arrow-right" className="h-3 w-3" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export default function AdminOverviewPage() {
  const { data, isLoading, error, refetch, isFetching } = useDashboardOverview();

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <section className="card p-6">
          <SkeletonList rows={2} />
        </section>
        <SkeletonList rows={1} rowClassName="h-28" />
        <SkeletonList rows={2} rowClassName="h-48" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6">
        <p className="eyebrow">Admin overview</p>
        <h2 className="mt-2 font-display text-xl font-bold text-slate-900">Command center</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <InlineAlert message={getErrorMessage(error)} />
          <button type="button" onClick={() => refetch()} className="btn-secondary !px-3.5 !py-1.5 text-xs">
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { kpis, monitoring, beneficiaries, field_visits, technicians, dispersal, distribution, per_barangay, audit } = data;
  const hasProgramData = (kpis?.beneficiaries?.total ?? 0) > 0;
  const verification = field_visits?.verification ?? { counts: {}, review_count: 0, total: 0 };
  const categories = monitoring?.by_category ?? {};
  const topBarangays = [...(per_barangay ?? [])]
    .sort((a, b) => (b.households ?? 0) - (a.households ?? 0))
    .slice(0, 8);

  return (
    <div className="space-y-8">
      {/* -------------------------------------------------------- Header */}
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Administrator</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              System overview
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              The whole program on one screen — coverage, field activity,
              monitoring load and the newest audit events. Every figure links
              to the module that owns it.
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Data as of
            </p>
            <p className="text-sm font-semibold text-slate-700">{formatStamp(data.generated_at)}</p>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="btn-secondary mt-2 !px-3.5 !py-1.5 text-xs"
            >
              <Icon name="refresh" className="h-3.5 w-3.5" />
              {isFetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
      </section>

      {!hasProgramData && (
        <section className="card">
          <EmptyState
            title="No program data yet"
            description="Once beneficiaries and their records are enrolled, the KPIs, charts and tables below fill in automatically."
          />
        </section>
      )}

      {/* ----------------------------------------------------------- KPIs */}
      <Section
        title="Key performance indicators"
        description="The six numbers that answer “how is the program doing right now?”"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label="Beneficiaries"
            value={num(kpis?.beneficiaries?.total)}
            hint={`${num(kpis?.beneficiaries?.geo_tagged)} geo-tagged`}
            icon="clipboard"
            to="/dashboard/admin/beneficiaries"
          />
          <StatCard
            label="Active technicians"
            value={num(kpis?.technicians_active)}
            hint={`${num(technicians?.deactivated)} deactivated`}
            icon="users"
            to="/dashboard/admin/technicians"
          />
          <StatCard
            label="Field visits · 30 days"
            value={num(kpis?.field_visits_last_30_days)}
            hint={`${num(kpis?.field_visits_total)} all time`}
            icon="route"
            to="/dashboard/admin/field-visits"
          />
          <StatCard
            label="Monitoring records"
            value={num(kpis?.monitoring_records)}
            icon="clipboard-check"
            to="/dashboard/admin/monitoring"
          />
          <StatCard
            label="Dispersal records"
            value={num(kpis?.dispersal_records)}
            icon="truck"
            to="/dashboard/admin/map"
          />
          <StatCard
            label="Visits to review"
            value={num(kpis?.visits_needing_review)}
            hint="Off-site or unverifiable"
            icon="alert-circle"
            tone={(kpis?.visits_needing_review ?? 0) > 0 ? "warning" : "default"}
            to="/dashboard/admin/field-visits?verification=review"
          />
        </div>
      </Section>

      {/* -------------------------------------------- Monitoring overview */}
      <Section
        title="Monitoring overview"
        description="Livestock and poultry visit records — the monthly CVO reporting workbook."
        to="/dashboard/admin/monitoring"
        linkLabel="Open monitoring"
      >
        {hasProgramData ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Visit records" value={num(monitoring?.total_records)} />
              <StatCard label="Households monitored" value={num(monitoring?.monitored_households)} />
              <StatCard
                label="Livestock households"
                value={num(categories.livestock?.households)}
                hint={`${num(categories.livestock?.records)} records`}
              />
              <StatCard
                label="Poultry households"
                value={num(categories.poultry?.households)}
                hint={`${num(categories.poultry?.records)} records`}
              />
            </div>
            {(categories.other?.records ?? 0) > 0 || (categories.unspecified?.records ?? 0) > 0 ? (
              <p className="text-xs text-slate-500">
                {num((categories.other?.records ?? 0) + (categories.unspecified?.records ?? 0))}{" "}
                record(s) outside the livestock/poultry split — households enrolled before the
                animal-type master list.
              </p>
            ) : null}
            <ChartCard
              title="Monitoring records by month"
              caption="Trailing 12 months"
              state={{ loading: false, error: null, refresh: undefined }}
              isEmpty={(monitoring?.records_by_month ?? []).every((row) => row.total === 0)}
              emptyTitle="No dated records in the window"
              emptyDescription="Records carry this chart only when their monitoring date falls in the trailing 12 months."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly(monitoring?.records_by_month)} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="short" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
                  <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip formatter={(value) => [num(value), "Records"]} />
                  <Bar dataKey="total" fill={CHART_COLORS.accent} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </>
        ) : null}
      </Section>

      {/* ------------------------------------------ Beneficiary overview */}
      <Section
        title="Beneficiary overview"
        description="Household coverage, enrolment trend and where the program reaches."
        to="/dashboard/admin/beneficiaries"
        linkLabel="Open beneficiaries"
      >
        {hasProgramData ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <StatCard
                  label="With technician"
                  value={num(beneficiaries?.with_technician)}
                  tone="brand"
                />
                <StatCard
                  label="Unassigned"
                  value={num(beneficiaries?.unassigned)}
                  tone={(beneficiaries?.unassigned ?? 0) > 0 ? "warning" : "default"}
                />
                <StatCard label="Geo-tagged" value={num(beneficiaries?.geo_tagged)} />
                <StatCard
                  label="Barangays reached"
                  value={num(topBarangays.length > 0 ? per_barangay.length : 0)}
                />
              </div>
              <ChartCard
                title="New beneficiary registrations"
                caption="Trailing 12 months"
                state={{ loading: false, error: null, refresh: undefined }}
                isEmpty={(beneficiaries?.registrations_by_month ?? []).every((row) => row.total === 0)}
                emptyTitle="No registrations in the window"
                emptyDescription="Enrolments land here the day they are recorded."
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly(beneficiaries?.registrations_by_month)} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="short" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
                    <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip formatter={(value) => [num(value), "Enrolled"]} />
                    <Bar dataKey="total" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <div className="card overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50/60 px-4 py-3">
                <h4 className="font-display text-sm font-semibold text-slate-900">
                  Barangays by coverage
                </h4>
                <p className="text-xs text-slate-500">Top {topBarangays.length} of {num(per_barangay?.length ?? 0)}</p>
              </div>
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-2.5">Barangay</th>
                    <th className="px-3 py-2.5 text-right">Households</th>
                    <th className="px-3 py-2.5 text-right">Monitoring</th>
                    <th className="px-3 py-2.5 text-right">Field visits</th>
                    <th className="px-4 py-2.5 text-right">Dispersals</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topBarangays.map((row) => (
                    <tr key={row.barangay} className="transition hover:bg-brand-50/40">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{row.barangay}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{num(row.households)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{num(row.monitoring_visits)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{num(row.field_visits)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{num(row.dispersals)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Section>

      {/* ------------------------------------------ Field visit activity */}
      <Section
        title="Field visit activities"
        description="What the field team logged, and how the geotagged evidence verified."
        to="/dashboard/admin/field-visits"
        linkLabel="Open field visits"
      >
        {hasProgramData ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="On site" value={num(verification.counts?.on_site)} tone="brand" />
              <StatCard
                label="Needs review"
                value={num(verification.review_count)}
                tone={(verification.review_count ?? 0) > 0 ? "warning" : "default"}
              />
              <StatCard label="Off site" value={num(verification.counts?.off_site)} />
              <StatCard label="Low accuracy" value={num(verification.counts?.low_accuracy)} />
              <StatCard label="No registered pin" value={num(verification.counts?.no_reference_location)} />
              <StatCard label="No GPS" value={num(verification.counts?.no_gps)} />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <ChartCard
                title="Visits by month"
                caption="Trailing 12 months"
                state={{ loading: false, error: null, refresh: undefined }}
                isEmpty={(field_visits?.by_month ?? []).every((row) => row.total === 0)}
                emptyTitle="No field visits yet"
                emptyDescription="Trips logged by technicians appear here."
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly(field_visits?.by_month)} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="short" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
                    <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip formatter={(value) => [num(value), "Visits"]} />
                    <Bar dataKey="total" fill={CHART_COLORS.earth} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <div className="card overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-4 py-3">
                  <h4 className="font-display text-sm font-semibold text-slate-900">
                    Latest technician trips
                  </h4>
                  <Link
                    to="/dashboard/admin/field-visits?verification=review"
                    className="inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-[11px] font-semibold text-brand-800 hover:bg-brand-100"
                  >
                    Review flagged visits
                    <Icon name="arrow-right" className="h-3 w-3" />
                  </Link>
                </div>
                {(field_visits?.recent ?? []).length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      title="No visits logged yet"
                      description="The most recent technician trips appear here."
                    />
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {field_visits.recent.map((visit) => (
                      <li key={visit.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {visit.beneficiary_name ?? "Unknown household"}
                            <span className="ml-2 text-xs font-normal text-slate-500">
                              {visit.beneficiary_address}
                            </span>
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {visit.visited_on ? formatDay(visit.visited_on) : "—"} ·{" "}
                            {visit.purpose ?? "Visit"} · {visit.technician_name ?? "—"}
                            {visit.has_photo ? " · photo attached" : ""}
                          </p>
                        </div>
                        <VerificationBadge status={visit.verification_status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Section>

      {/* ---------------------------------------- Technician performance */}
      <Section
        title="Technician performance"
        description="Who covers what, and the field work each technician has actually logged."
        to="/dashboard/admin/technicians"
        linkLabel="Manage assignments"
      >
        {hasProgramData ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Active" value={num(technicians?.active)} tone="brand" />
              <StatCard label="Deactivated" value={num(technicians?.deactivated)} />
              <StatCard
                label="Visits in the last 30 days"
                value={num(kpis?.field_visits_last_30_days)}
              />
            </div>

            {(technicians?.roster ?? []).length === 0 ? (
              <div className="card p-6">
                <EmptyState
                  title="No technicians on the roster"
                  description="Create technician accounts on the User Management screen, then assign households."
                />
              </div>
            ) : (
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="card overflow-hidden">
                  <div className="border-b border-slate-200 bg-slate-50/60 px-4 py-3">
                    <h4 className="font-display text-sm font-semibold text-slate-900">Roster</h4>
                    {(technicians.active ?? 0) > technicians.roster.length && (
                      <p className="text-xs text-slate-500">
                        Showing {technicians.roster.length} of {num(technicians.active)} — the full
                        workload chart is on Reports.
                      </p>
                    )}
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                      <tr>
                        <th className="px-4 py-2.5">Technician</th>
                        <th className="px-3 py-2.5 text-right">Households</th>
                        <th className="px-3 py-2.5 text-right">Visits · 30d</th>
                        <th className="px-3 py-2.5 text-right">All time</th>
                        <th className="px-4 py-2.5 text-right">Last visit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {technicians.roster.map((tech) => (
                        <tr key={tech.id} className="transition hover:bg-brand-50/40">
                          <td className="px-4 py-2.5">
                            <p className="font-semibold text-slate-900">{tech.name}</p>
                            <p className="text-[11px] text-slate-500">
                              {tech.last_login_at ? `Signed in ${timeAgo(tech.last_login_at)}` : "Never signed in"}
                            </p>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{num(tech.assigned_households)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{num(tech.visits_last_30_days)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{num(tech.visits_total)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {tech.last_visit_on ? formatDay(tech.last_visit_on) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <ChartCard
                  title="Visits logged · last 30 days"
                  caption="Per technician"
                  state={{ loading: false, error: null, refresh: undefined }}
                  isEmpty={technicians.roster.every((tech) => tech.visits_last_30_days === 0)}
                  emptyTitle="No visits in the last 30 days"
                  emptyDescription="Field activity for the trailing month draws here."
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[...technicians.roster]
                        .sort((a, b) => b.visits_last_30_days - a.visits_last_30_days)
                        .map((tech) => ({ name: tech.name, visits: tech.visits_last_30_days }))}
                      layout="vertical"
                      margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                      <XAxis type="number" tick={AXIS_STYLE} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={120}
                        tick={AXIS_STYLE}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip formatter={(value) => [num(value), "Visits"]} />
                      <Bar dataKey="visits" fill={CHART_COLORS.earth} radius={[0, 4, 4, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            )}
          </div>
        ) : null}
      </Section>

      {/* ------------------------------------ Geographical overview (map) */}
      <Section
        title="Geographical overview"
        description="Where the program's animals stand today — barangay coverage and dispersal distribution."
        to="/dashboard/admin/map"
        linkLabel="Open the dispersal map"
      >
        <DashboardOverviewMap roleKey="admin" />
      </Section>

      {/* ----------------------------- Barangay dispersal analytics (widget) */}
      <Section
        title="Barangay dispersal analytics"
        description="Top and bottom barangays for dispersal, re-dispersal and the per-1000 rate."
        to="/dashboard/admin/reports/barangay-dispersal"
        linkLabel="Open full analytics"
      >
        <Suspense fallback={<SkeletonList rows={1} rowClassName="h-48" />}>
          <BarangayDispersalWidget roleKey="admin" />
        </Suspense>
      </Section>

      {/* --------------------------------------- Recent system activities */}
      <Section
        title="Recent system activities"
        description="Administrative actions, technician activity and security events from the audit trail."
        to="/dashboard/admin/audit"
        linkLabel="Open the audit trail"
      >
        <div className="card overflow-hidden">
          {(audit ?? []).length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No activity recorded yet"
                description="Sign-ins, edits and exports land here as they happen."
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {audit.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{labelForAction(entry.action)}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {entry.actor_name ?? "System"}
                      {entry.actor_role ? ` (${entry.actor_role})` : ""}
                      {entry.target_type && entry.target_id != null
                        ? ` — ${labelForEntity(entry.target_type)} #${entry.target_id}`
                        : entry.target_type
                          ? ` — ${labelForEntity(entry.target_type)}`
                          : ""}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
                    <Icon name="clock" className="h-3 w-3" />
                    {timeAgo(entry.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {/* ------------------------------------------- Reports & analytics */}
      <Section
        title="Reports and analytics"
        description="The program's trajectory — the full report, export and five charts live on the Reports screen."
        to="/dashboard/admin/reports"
        linkLabel="Open reports"
      >
        <div className="grid gap-6 xl:grid-cols-2">
          <ChartCard
            title="Dispersal trend"
            caption="Trailing 12 months · initial vs re-dispersals"
            state={{ loading: false, error: null, refresh: undefined }}
            isEmpty={(dispersal?.trend ?? []).every((row) => row.dispersals === 0 && row.re_dispersals === 0)}
            emptyTitle="No dispersals recorded yet"
            emptyDescription="Recorded dispersals trend here month by month."
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthly(dispersal?.trend)} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="short" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="dispersals"
                  name="Dispersals"
                  stroke={CHART_COLORS.primary}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="re_dispersals"
                  name="Re-dispersals"
                  stroke={CHART_COLORS.earth}
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Animal type distribution"
            caption="Monitoring records by animal type"
            state={{ loading: false, error: null, refresh: undefined }}
            isEmpty={(distribution ?? []).every((row) => row.animals === 0)}
            emptyTitle="No monitoring records yet"
            emptyDescription="The herd's composition draws from the monitoring workbook."
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={distribution ?? []}
                  dataKey="animals"
                  nameKey="animal_type"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={2}
                >
                  {(distribution ?? []).map((entry, index) => (
                    <Cell key={entry.animal_type} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [num(value), "Records"]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </Section>

      <p className="pb-2 text-center text-xs text-slate-400">
        Figures cover every barangay city-wide. Verification verdicts judge geotagged fixes against
        each household's registered pin — {verificationLabel("on_site").toLowerCase()} means the fix
        landed inside the configured on-site radius.
      </p>
    </div>
  );
}
