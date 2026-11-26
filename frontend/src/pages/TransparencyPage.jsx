import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icons";
import { SearchField } from "../components/SearchField";
import { PublicLayout } from "../components/PublicLayout";
import { Skeleton } from "../components/Skeleton";
import { site } from "../config/site";
import { publicDocumentsApi } from "../api/publicDocumentsApi";
import { usePublicDocuments } from "../hooks/usePublicDocuments";
import { usePublicTransparency } from "../hooks/usePublicTransparency";

/**
 * Public transparency dashboard (`/transparency`).
 *
 * A session-free, aggregate-only view of the dispersal program: how many
 * ANIMALS have been dispersed (a count of animals placed, from the same
 * ownership events the admin analytics reads), across how many barangays, how
 * many were re-dispersed out, how reach has grown month over month, and how
 * current vaccination is city-wide. Every number is a count at barangay or
 * city level — no farmer or animal is identifiable, by construction. The
 * backend test PublicTransparencyTest enforces that boundary.
 *
 * Definitions are stated under the numbers: "animals dispersed" counts
 * animals placed (dispersal events); "households" counts beneficiary
 * households — separate numbers, never mixed.
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

/** Total definitions, shown as one line under each headline number. */
const TOTAL_DEFINITIONS = {
  animals_dispersed: "Animals placed by dispersal events.",
  barangays_covered: "Barangays that received at least one animal.",
  re_dispersals: "Handovers out of a barangay to the next farmer.",
};

export default function TransparencyPage() {
  const { data, loading, error, refetch } = usePublicTransparency();

  return (
    <PublicLayout>
      {/* Institutional page header: breadcrumb, purpose and the promise that
          sits behind every number below. */}
      <div className="public-on-dark border-b border-white/10 bg-cvo-navy/85 text-white">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-16">
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-2 text-xs text-white/60">
              <li>
                <Link
                  to="/"
                  className="underline-offset-2 hover:text-white hover:underline"
                >
                  Home
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-white/90">
                Transparency
              </li>
            </ol>
          </nav>

          <p className="public-eyebrow mt-6 text-cvo-glint">
            Public transparency dashboard
          </p>
          <h1 className="mt-3 font-display text-2xl font-bold text-white sm:text-4xl">
            Transparency and Public Information
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/75">
            Aggregate counts from the {site.office} dispersal program — the same
            ownership records the office's internal reports read. Individual
            farmer and farm records are never shown here.
          </p>
        </div>
      </div>

      <div className="bg-cvo-mist/85">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
        {error ? (
          <div className="public-card mt-8 p-6" role="alert">
            <p className="font-medium text-slate-900">
              The transparency data could not be loaded.
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Check your connection and try again.
            </p>
            <button type="button" onClick={() => refetch()} className="btn-secondary mt-4 !px-3.5 !py-1.5 text-xs">
              Try again
            </button>
          </div>
        ) : (
          <div className="mt-8 space-y-6">
            <Totals data={data} loading={loading} />
            <ReachChart series={data?.reach_over_time ?? []} loading={loading} />
            <Vaccination vaccination={data?.vaccination} loading={loading} />
            <PerBarangay rows={data?.per_barangay ?? []} loading={loading} />
            <PublicDocuments />
          </div>
        )}

        <p className="mt-6 text-xs text-slate-500" data-testid="as-of">
          {data?.generated_at
            ? `As of ${new Date(data.generated_at).toLocaleString()}. Figures are refreshed periodically.`
            : "Figures are refreshed periodically."}
        </p>
        </div>
      </div>
    </PublicLayout>
  );
}

/** City-wide headline counters — one definition line under each number. */
function Totals({ data, loading }) {
  const totals = data?.totals;

  const cards = [
    {
      icon: "map-pin",
      label: "Animals dispersed",
      definition: TOTAL_DEFINITIONS.animals_dispersed,
      value: totals?.animals_dispersed,
    },
    {
      icon: "map",
      label: "Barangays covered",
      definition: TOTAL_DEFINITIONS.barangays_covered,
      value: totals?.barangays_covered,
    },
    {
      icon: "refresh",
      label: "Re-dispersals",
      definition: TOTAL_DEFINITIONS.re_dispersals,
      value: totals?.re_dispersals,
    },
  ];

  return (
    <section aria-label="Program totals" data-testid="totals">
      <h2 className="sr-only">Program totals</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <article key={card.label} className="public-card p-6">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-cvo-mist text-cvo-teal">
              <Icon name={card.icon} className="h-6 w-6" />
            </span>
            <p
              className="mt-4 font-display text-2xl font-bold text-slate-900"
              data-testid={`total-${card.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {loading || card.value === undefined ? "—" : card.value.toLocaleString()}
            </p>
            <p className="mt-1 text-sm text-slate-500">{card.label}</p>
            <p className="mt-0.5 text-xs text-slate-400">{card.definition}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/**
 * Monthly dispersal trend as a CSS bar chart with the value on each bar, a
 * text alternative for screen readers, and a visible data-table toggle for
 * exact numbers. A series too small to chart (fewer than two months with any
 * dispersal) is stated honestly instead of drawn.
 */
function ReachChart({ series, loading }) {
  const [showTable, setShowTable] = useState(false);
  const max = Math.max(1, ...series.map((m) => m.animals_dispersed));
  const activeMonths = series.filter((m) => m.animals_dispersed > 0).length;
  const tooSmallToChart = series.length > 0 && activeMonths < 2;

  return (
    <section className="public-card p-6" aria-label="Dispersals over time" data-testid="reach-chart">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon name="chart" className="h-5 w-5 text-cvo-teal" />
          <h2 className="font-display text-base font-semibold text-slate-900">
            Animals dispersed over the last 12 months
          </h2>
        </div>

        {!loading && series.length > 0 && (
          <button
            type="button"
            onClick={() => setShowTable((prev) => !prev)}
            aria-pressed={showTable}
            className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-300 transition hover:bg-cvo-mist hover:text-cvo-navy"
          >
            <Icon name={showTable ? "chart" : "file-text"} className="h-3.5 w-3.5" />
            {showTable ? "Show chart" : "Show as table"}
          </button>
        )}
      </div>

      {loading ? (
        <div className="mt-6">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : series.length === 0 || tooSmallToChart ? (
        <p className="mt-6 text-sm text-slate-500">
          {series.length === 0
            ? "No dispersal activity recorded yet."
            : "Not enough months with recorded dispersals to draw a trend yet — the counts below are the record so far."}
        </p>
      ) : showTable ? (
        <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[22rem] text-left text-sm">
          <caption className="sr-only">
            Animals dispersed per month over the last 12 months
          </caption>
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
            <tr>
              <th scope="col" className="px-3 py-2">Month</th>
              <th scope="col" className="px-3 py-2 text-right">Animals dispersed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {series.map((month) => (
              <tr key={month.month}>
                <td className="px-3 py-2 text-slate-700">{monthLabel(month.month)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {month.animals_dispersed}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : (
        <div
          className="mt-6 flex h-40 items-end gap-1.5"
          role="img"
          aria-label={`Bar chart of animals dispersed per month over the last 12 months; busiest month ${max} animals.`}
        >
          {series.map((month) => (
            <div key={month.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div className="flex h-32 w-full items-end">
                <div
                  className="w-full rounded-t bg-cvo-teal-accent transition-all"
                  style={{ height: `${Math.round((month.animals_dispersed / max) * 100)}%` }}
                  title={`${monthLabel(month.month)}: ${month.animals_dispersed} dispersed`}
                  data-testid="reach-bar"
                  data-animals-dispersed={month.animals_dispersed}
                />
              </div>
              {/* The value on each bar keeps the chart readable without hover. */}
              <span className="text-[10px] font-semibold tabular-nums text-slate-600">
                {month.animals_dispersed}
              </span>
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
    <section className="public-card p-6" aria-label="Vaccination compliance" data-testid="vaccination">
      <div className="flex items-center gap-2">
        <Icon name="medical-cross" className="h-5 w-5 text-cvo-teal" />
        <h2 className="font-display text-base font-semibold text-slate-900">
          Vaccination compliance
        </h2>
      </div>

      {loading ? (
        <div className="mt-6">
          <Skeleton className="h-8 w-40" />
        </div>
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
              className="h-full rounded-pill bg-cvo-teal-accent"
              style={{ width: `${percent}%` }}
              data-testid="vaccination-bar"
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            An animal counts as current when its most recent recorded vaccination
            falls within the program's booster interval. Counts are per
            household's animals, from the office's monitoring records.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Downloadable public documents — real files uploaded by the administrator
 * (annual/accomplishment reports, budget and procurement disclosures).
 *
 * Search by title, filter by the categories actually present in the data,
 * and download through the browser's own PDF viewer — a plain link, no PDF
 * viewer library. The section exists only when there is something to
 * download: an office that has published nothing yet sees no empty box, and
 * a failed load degrades to the same hidden section (the figures above are
 * the page's substance; the files are supplementary).
 */
function PublicDocuments() {
  const { data, loading, error } = usePublicDocuments();
  const documents = data ?? NO_DOCUMENTS;
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const categories = useMemo(() => {
    const seen = new Map();
    for (const document of documents) {
      if (!seen.has(document.category)) {
        seen.set(document.category, document.category_label);
      }
    }
    return [...seen.entries()].map(([key, label]) => ({ key, label }));
  }, [documents]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return documents.filter((document) => {
      if (category !== "all" && document.category !== category) return false;
      return needle
        ? document.title.toLowerCase().includes(needle) ||
            (document.description ?? "").toLowerCase().includes(needle)
        : true;
    });
  }, [documents, search, category]);

  if (loading || error || documents.length === 0) return null;

  return (
    <section
      className="public-card overflow-hidden"
      aria-label="Downloadable public documents"
      data-testid="public-documents"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-2">
          <Icon name="file-text" className="h-5 w-5 text-cvo-teal" />
          <h2 className="font-display text-base font-semibold text-slate-900">
            Downloadable documents
          </h2>
          <span className="rounded-pill bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
            {documents.length}
          </span>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <SearchField
            id="public-document-search"
            value={search}
            onChange={setSearch}
            label={null}
            placeholder="Search documents…"
            ariaLabel="Search documents"
            className="w-full sm:w-56"
          />
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <span className="sr-only">Filter by category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="field w-full sm:w-auto"
            >
              <option value="all">All categories</option>
              {categories.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="px-6 py-6 text-sm text-slate-500">
          No documents match that search or filter.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {visible.map((document) => (
            <li
              key={document.id}
              className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-slate-800">{document.title}</p>
                  <span className="rounded-pill bg-cvo-mist px-2 py-0.5 text-[11px] font-semibold text-cvo-navy">
                    {document.category_label}
                  </span>
                </div>
                {document.description && (
                  <p className="mt-0.5 text-sm text-slate-600">{document.description}</p>
                )}
                <p className="mt-1 text-xs text-slate-400">
                  {new Date(document.published_at).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}{" "}
                  · {formatBytes(document.size_bytes)} · PDF
                </p>
              </div>

              <a
                href={publicDocumentsApi.resolveDownload(document.download_url)}
                target="_blank"
                rel="noreferrer"
                className="public-btn-secondary shrink-0 !px-3.5 !py-1.5 text-xs"
              >
                <Icon name="file-text" className="h-3.5 w-3.5" />
                Download
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Stable empty-list identity for the documents section's memo deps. */
const NO_DOCUMENTS = [];

/** "184320" → "180 KB" — the size line under each document title. */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Per-barangay breakdown with search, sorting (barangay / animals dispersed /
 * re-dispersals) and a sticky header while the rows scroll.
 */
function PerBarangay({ rows, loading }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("animals_dispersed");
  const [sortAsc, setSortAsc] = useState(false);

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = rows.filter((row) =>
      needle ? row.name.toLowerCase().includes(needle) : true,
    );
    return [...filtered].sort((a, b) => {
      const valueOf = (row) =>
        sortKey === "name" ? row.name.toLowerCase() : row[sortKey];
      const compared = sortKey === "name"
        ? valueOf(a).localeCompare(valueOf(b))
        : valueOf(a) - valueOf(b);
      return sortAsc ? compared : -compared;
    });
  }, [rows, search, sortKey, sortAsc]);

  const columns = [
    { key: "name", label: "Barangay", numeric: false },
    { key: "animals_dispersed", label: "Animals dispersed", numeric: true },
    { key: "re_dispersals", label: "Re-dispersals", numeric: true },
  ];

  function toggleSort(key) {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(key === "name");
    }
  }

  return (
    <section className="public-card overflow-hidden" aria-label="Dispersals per barangay" data-testid="per-barangay">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-2">
          <Icon name="map" className="h-5 w-5 text-cvo-teal" />
          <h2 className="font-display text-base font-semibold text-slate-900">
            Dispersals per barangay
          </h2>
        </div>
        <SearchField
          id="public-barangay-search"
          value={search}
          onChange={setSearch}
          label={null}
          placeholder="Search barangay…"
          ariaLabel="Search barangays"
          className="w-full sm:w-56"
        />
      </div>

      {loading ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="px-6 py-6 text-sm text-slate-500">
          No barangays have recorded dispersals yet.
        </p>
      ) : visibleRows.length === 0 ? (
        <p className="px-6 py-6 text-sm text-slate-500">
          No barangays match that search.
        </p>
      ) : (
        <div
          className="max-h-[26rem] overflow-auto"
          // Sticky header while the rows scroll on small screens.
          style={{ scrollbarGutter: "stable" }}
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Animals dispersed and re-dispersals per barangay, sortable
            </caption>
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold text-slate-500 uppercase shadow-[0_1px_0_#e2e8f0]">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      sortKey === column.key
                        ? sortAsc
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className={`px-6 py-3 ${column.numeric ? "text-right" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className="inline-flex items-center gap-1 uppercase hover:text-cvo-navy"
                    >
                      {column.label}
                      {sortKey === column.key && <span aria-hidden="true">{sortAsc ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.map((row) => (
                <tr key={row.name}>
                  <td className="px-6 py-3 font-medium text-slate-800">{row.name}</td>
                  <td className="px-6 py-3 text-right tabular-nums text-slate-600">
                    {row.animals_dispersed.toLocaleString()}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums text-slate-600">
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
