import { useCallback, useEffect, useState } from "react";
import { reportsApi } from "../api/reportsApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { Icon } from "../components/Icons";
import { getRole } from "../config/roles";

/**
 * Admin "Reports" screen — the city-wide program overview.
 *
 * Read-only by construction: every number is the API's aggregate over records
 * some other screen owns, so the page offers filters (barangay, from-date)
 * but no authoring surface. The per-barangay table is the anchor — the summary
 * cards should always sum to it, which is what makes a wrong number on this
 * page noticeable instead of merely plausible.
 */

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

export default function ReportsPage({ roleKey = "admin" }) {
  const config = getRole(roleKey);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [barangay, setBarangay] = useState("");
  const [from, setFrom] = useState("");

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

  const barangays = data?.scope?.barangays ?? [];
  const program = data?.program ?? {};
  const activity = data?.activity ?? {};
  const clinical = data?.clinical ?? {};
  const rows = data?.per_barangay ?? [];
  const trend = data?.trend ?? [];

  // The busiest month leads the trend band, so the page answers "when was the
  // program most active" without anyone reading six rows.
  const peakMonth = trend.reduce(
    (best, m) => (m.dispersals > (best?.dispersals ?? -1) ? m : best),
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
            <label className="block text-xs font-semibold text-slate-600">
              Barangay
              <select
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
            </label>

            <label className="block text-xs font-semibold text-slate-600">
              Dispersals since
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="field mt-1 w-40 text-xs"
              />
            </label>
          </div>
        </div>

        {barangay && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-pill bg-brand-50 px-3.5 py-1.5 text-xs font-semibold text-brand-800">
            <Icon name="map-pin" className="h-3.5 w-3.5" />
            Scoped to {barangay}
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

          {/* Per-barangay table */}
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

          {/* Dispersal trend */}
          <section className="card p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
                Dispersals — last {trend.length} months
              </h3>
              {peakMonth && peakMonth.dispersals > 0 && (
                <p className="text-xs text-slate-500">
                  Busiest: {peakMonth.label} ({peakMonth.dispersals})
                </p>
              )}
            </div>

            {trend.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No dispersal data yet.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {trend.map((m) => {
                  const max = Math.max(...trend.map((x) => x.dispersals), 1);
                  const width = Math.round((m.dispersals / max) * 100);

                  return (
                    <div key={m.month} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-xs font-semibold text-slate-600">
                        {m.label}
                      </span>
                      <span className="h-5 min-w-8 flex-1 overflow-hidden rounded-pill bg-slate-100">
                        <span
                          className="flex h-full items-center rounded-pill bg-brand-500 px-2 text-[10px] font-bold text-white transition-all"
                          style={{ width: `${Math.max(width, m.dispersals > 0 ? 8 : 0)}%` }}
                        >
                          {m.dispersals > 0 ? m.dispersals : ""}
                        </span>
                      </span>
                      {m.re_dispersals > 0 && (
                        <span className="w-24 shrink-0 text-[11px] text-slate-500">
                          {m.re_dispersals} re-dispersal{m.re_dispersals === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
