import { Link } from "react-router-dom";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icons";
import { site } from "../config/site";
import { usePublicTransparency } from "../hooks/usePublicTransparency";

/**
 * Public transparency dashboard (`/transparency`).
 *
 * A session-free, aggregate-only view of the dispersal programme: how many
 * animals have been dispersed, across how many barangays, how many were passed
 * on, how reach has grown month over month, and how current vaccination is
 * city-wide. Every number is a count at barangay or city level — no farmer or
 * animal is identifiable, by construction. The backend test
 * PublicTransparencyTest enforces that boundary.
 */

/** Short month labels, indexed by 0–11 — fixed so tests are locale-stable. */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-07" → "Jul 2026". */
function monthLabel(month) {
  const [year, index] = month.split("-");
  return `${MONTHS[Number(index) - 1] ?? month} ${year}`;
}

export default function TransparencyPage() {
  const { data, loading, error } = usePublicTransparency();

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ------------------------------------------------------------- Nav */}
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-700">
            <Brand subtitle={`${site.city}, ${site.province}`} />
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <Link to="/" className="btn-secondary">
              Back to home
            </Link>
            <Link to="/login" className="btn-primary">
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
        <div className="max-w-3xl">
          <p className="eyebrow">Public transparency dashboard</p>
          <h1 className="mt-3 font-display text-2xl font-bold text-slate-900 sm:text-3xl">
            Livestock &amp; poultry dispersal at a glance
          </h1>
          <p className="mt-4 text-base text-slate-600">
            Aggregate, first-name-free numbers from the {site.office} dispersal
            programme. Individual farmer and farm records are never shown here.
          </p>
        </div>

        {error ? (
          <div className="card mt-8 p-6" role="alert">
            <p className="font-medium text-slate-900">
              The transparency data could not be loaded.
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Please try again shortly.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-6">
            <Totals data={data} loading={loading} />
            <ReachChart series={data?.reach_over_time ?? []} loading={loading} />
            <Vaccination vaccination={data?.vaccination} loading={loading} />
            <PerBarangay rows={data?.per_barangay ?? []} loading={loading} />
          </div>
        )}

        {data?.generated_at && (
          <p className="mt-6 text-xs text-slate-500">
            Data generated {new Date(data.generated_at).toLocaleString()}.
            Figures are refreshed periodically.
          </p>
        )}
      </main>
    </div>
  );
}

/** City-wide headline counters. */
function Totals({ data, loading }) {
  const cards = [
    { icon: "users", label: "Animals dispersed", value: data?.totals.beneficiaries },
    { icon: "map-pin", label: "Barangays covered", value: data?.totals.barangays_covered },
    { icon: "refresh", label: "Re-dispersals", value: data?.totals.re_dispersals },
  ];

  return (
    <section aria-label="Programme totals" data-testid="totals">
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <article key={card.label} className="card p-6">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700">
              <Icon name={card.icon} className="h-6 w-6" />
            </span>
            <p className="mt-4 font-display text-2xl font-bold text-slate-900">
              {loading || card.value === undefined ? "—" : card.value.toLocaleString()}
            </p>
            <p className="mt-1 text-sm text-slate-500">{card.label}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/**
 * Monthly reach trend as a CSS bar chart. Each bar's height is proportional to
 * the busiest month, so the series reads at a glance without pulling in a
 * charting library for a dozen columns.
 */
function ReachChart({ series, loading }) {
  const max = Math.max(1, ...series.map((m) => m.dispersals));

  return (
    <section className="card p-6" aria-label="Programme reach over time" data-testid="reach-chart">
      <div className="flex items-center gap-2">
        <Icon name="chart" className="h-5 w-5 text-brand-600" />
        <h2 className="font-display text-base font-semibold text-slate-900">
          Reach over the last 12 months
        </h2>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : series.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No dispersal activity recorded yet.</p>
      ) : (
        <div className="mt-6 flex h-40 items-end gap-1.5" role="img" aria-label="Monthly disbursals bar chart">
          {series.map((month) => (
            <div key={month.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div className="flex h-32 w-full items-end">
                <div
                  className="w-full rounded-t bg-brand-500 transition-all"
                  style={{ height: `${Math.round((month.dispersals / max) * 100)}%` }}
                  title={`${monthLabel(month.month)}: ${month.dispersals} dispersed`}
                  data-testid="reach-bar"
                  data-dispersals={month.dispersals}
                />
              </div>
              <span className="text-[10px] font-medium text-slate-500">
                {MONTHS[Number(month.month.split("-")[1]) - 1] ?? month.month}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Vaccination compliance for the whole city. */
function Vaccination({ vaccination, loading }) {
  const rate = vaccination?.rate;
  const percent = rate === null || rate === undefined ? null : Math.round(rate * 100);

  return (
    <section className="card p-6" aria-label="Vaccination compliance" data-testid="vaccination">
      <div className="flex items-center gap-2">
        <Icon name="medical-cross" className="h-5 w-5 text-brand-600" />
        <h2 className="font-display text-base font-semibold text-slate-900">
          Vaccination compliance
        </h2>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : vaccination?.total === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          No animals recorded yet, so compliance cannot be calculated.
        </p>
      ) : (
        <>
          <p className="mt-4 font-display text-2xl font-bold text-slate-900" data-testid="vaccination-rate">
            {percent}%{" "}
            <span className="text-sm font-medium text-slate-500">
              ({vaccination.compliant.toLocaleString()} of{" "}
              {vaccination.total.toLocaleString()} animals current)
            </span>
          </p>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-pill bg-slate-100">
            <div
              className="h-full rounded-pill bg-brand-500"
              style={{ width: `${percent}%` }}
              data-testid="vaccination-bar"
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            An animal counts as current when its most recent recorded vaccination
            falls within the programme&apos;s booster interval.
          </p>
        </>
      )}
    </section>
  );
}

/** Per-barangay breakdown, busiest first. */
function PerBarangay({ rows, loading }) {
  return (
    <section className="card overflow-hidden" aria-label="Dispersals per barangay" data-testid="per-barangay">
      <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
        <Icon name="map" className="h-5 w-5 text-brand-600" />
        <h2 className="font-display text-base font-semibold text-slate-900">
          Dispersals per barangay
        </h2>
      </div>

      {loading ? (
        <p className="px-6 py-6 text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-6 py-6 text-sm text-slate-500">
          No barangays have recorded dispersals yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-6 py-3">Barangay</th>
                <th scope="col" className="px-6 py-3 text-right">Animals dispersed</th>
                <th scope="col" className="px-6 py-3 text-right">Re-dispersals</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.name}>
                  <td className="px-6 py-3 font-medium text-slate-800">{row.name}</td>
                  <td className="px-6 py-3 text-right text-slate-600">
                    {row.beneficiaries.toLocaleString()}
                  </td>
                  <td className="px-6 py-3 text-right text-slate-600">
                    {row.re_dispersals.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
