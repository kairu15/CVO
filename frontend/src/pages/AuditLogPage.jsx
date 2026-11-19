import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { auditApi } from "../api/auditApi";
import { getErrorMessage } from "../api/client";
import { AuditDetailDrawer } from "../components/AuditDetailDrawer";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { InlineAlert } from "../components/InlineAlert";
import { PaginationFooter } from "../components/PaginationFooter";
import { SkeletonList } from "../components/Skeleton";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import {
  labelForAction,
  labelForEntity,
  labelForModule,
} from "../lib/auditLabels";

/**
 * Admin "Audit Trail" — READ-ONLY investigation screen.
 *
 * The log is append-only on the server (no write route exists), so this screen
 * offers no edit or delete controls. Filtering and paging happen server-side;
 * the browser never receives a year of history to slice locally. Rows carry
 * only summary fields, and the drawer fetches one entry's full before/after
 * pair when it is opened.
 */

const FILTER_KEYS = [
  "action",
  "actor_id",
  "actor_role",
  "target_type",
  "module",
  "status",
  "ip_address",
  "date_from",
  "date_to",
];

const NO_FILTERS = Object.fromEntries(FILTER_KEYS.map((key) => [key, ""]));

const DATE_PRESETS = [
  { key: 1, label: "Today" },
  { key: 7, label: "7 days" },
  { key: 30, label: "30 days" },
  { key: 90, label: "90 days" },
];

const STATUS_TONES = {
  success: "bg-emerald-500",
  failed: "bg-rose-500",
  security: "bg-amber-500",
};

const STATUS_TEXT = {
  success: "Successful",
  failed: "Failed",
  security: "Security",
};

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString(undefined, { timeStyle: "short" });
}

function formatDay(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : date.toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

/** Local calendar date as the date input's YYYY-MM-DD value. */
function dateInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function filtersFromParams(params) {
  return Object.fromEntries(
    FILTER_KEYS.map((key) => [key, params.get(key) ?? ""]),
  );
}

/** Build the one active-filter object used by the list, summary and export. */
function activeFiltersFor(filters, search) {
  const active = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== ""),
  );

  if (search.trim() !== "") active.search = search.trim();

  return active;
}

export default function AuditLogPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // User Management's activity modal links here with ?actor_id=… so the trail
  // opens on that account. Every other filter is restored from the URL too,
  // which makes an investigation shareable and reload-safe.
  const [filters, setFilters] = useState(() => filtersFromParams(searchParams));
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [page, setPage] = useState(() => {
    const value = Number(searchParams.get("page"));
    return Number.isFinite(value) && value > 0 ? value : 1;
  });
  const [view, setView] = useState(() =>
    searchParams.get("view") === "timeline" ? "timeline" : "table",
  );

  const debouncedSearch = useDebouncedValue(search, 300);
  const debouncedIp = useDebouncedValue(filters.ip_address, 400);

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(false);

  const [vocab, setVocab] = useState({
    actions: [],
    target_types: [],
    actors: [],
    roles: [],
    modules: [],
    statuses: [],
  });

  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);

  const activeFilters = useMemo(
    () => activeFiltersFor({ ...filters, ip_address: debouncedIp }, debouncedSearch),
    [filters, debouncedIp, debouncedSearch],
  );

  // Keep the address bar in step with the screen. `replace` avoids flooding
  // history with one entry per keystroke.
  useEffect(() => {
    const next = new URLSearchParams();

    for (const [key, value] of Object.entries(filters)) {
      if (value !== "") next.set(key, value);
    }

    if (search.trim() !== "") next.set("search", search.trim());
    if (page > 1) next.set("page", String(page));
    if (view !== "table") next.set("view", view);

    setSearchParams(next, { replace: true });
  }, [filters, search, page, view, setSearchParams]);

  // The vocabulary changes only when new kinds of rows appear; a failed fetch
  // costs dropdown options, not the table.
  useEffect(() => {
    let live = true;

    auditApi
      .filters()
      .then((data) => {
        if (live) {
          setVocab({
            actions: data?.actions ?? [],
            target_types: data?.target_types ?? [],
            actors: data?.actors ?? [],
            roles: data?.roles ?? [],
            modules: data?.modules ?? [],
            statuses: data?.statuses ?? [],
          });
        }
      })
      .catch(() => {});

    return () => {
      live = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const result = await auditApi.list({ ...activeFilters, page });

      setRows(result.data ?? []);
      setMeta(result.meta ?? null);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(getErrorMessage(err));
      setRows([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [activeFilters, page]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // The overview follows the filters but not the page number: paging must not
  // re-query the aggregate.
  useEffect(() => {
    let live = true;

    auditApi
      .summary(activeFilters)
      .then((data) => {
        if (live) {
          setSummary(data);
          setSummaryError(false);
        }
      })
      .catch(() => {
        if (live) {
          setSummary(null);
          setSummaryError(true);
        }
      });

    return () => {
      live = false;
    };
  }, [activeFilters, refreshKey]);

  function setFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setSelectedId(null);
  }

  function applyPreset(days) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));

    setFilters((current) => ({
      ...current,
      date_from: dateInputValue(from),
      date_to: dateInputValue(to),
    }));
    setPage(1);
    setSelectedId(null);
  }

  function showSecurityEvents() {
    setFilters((current) => ({ ...current, status: "security" }));
    setPage(1);
    setSelectedId(null);
  }

  function clearAll() {
    setFilters(NO_FILTERS);
    setSearch("");
    setPage(1);
    setSelectedId(null);
  }

  const hasFilters =
    search.trim() !== "" || Object.values(filters).some((value) => value !== "");

  const closeDrawer = useCallback(() => setSelectedId(null), []);

  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;
  const selectedIndex = rows.findIndex((row) => row.id === selectedId);

  const dayGroups = useMemo(() => {
    const groups = [];

    for (const row of rows) {
      const day = formatDay(row.created_at);
      const current = groups.at(-1);

      if (current?.day === day) current.rows.push(row);
      else groups.push({ day, rows: [row] });
    }

    return groups;
  }, [rows]);

  const exportHref = auditApi.exportUrl(activeFilters);

  return (
    <div className="space-y-5">
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Administration</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl dark:text-slate-100">
              Audit Trail
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
              Who did what, to which record, and when — sign-ins, exports,
              imports, permission changes and the fields each change altered.
              The trail is append-only.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800">
              <Icon name="activity" className="h-3.5 w-3.5" />
              {meta?.total ?? rows.length} {meta?.total === 1 ? "matching entry" : "matching entries"}
            </span>

            <button
              type="button"
              onClick={() => setRefreshKey((key) => key + 1)}
              className="inline-flex items-center gap-1.5 rounded-pill border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              title="Refresh the trail"
            >
              <Icon name="refresh" className="h-3.5 w-3.5" />
              Refresh
            </button>

            <a
              href={exportHref}
              className="inline-flex items-center gap-1.5 rounded-pill border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              title="Download the filtered rows as CSV"
            >
              <Icon name="file-text" className="h-3.5 w-3.5" />
              Export CSV
            </a>
          </div>
        </div>

        {/* Overview — one summary response drives every card. */}
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label={hasFilters ? "Matching entries" : "Total entries"} value={summary?.total} />
          <StatCard label="Today" value={summary?.today} />
          <StatCard label="Successful sign-ins" value={summary?.logins} />
          <StatCard
            label="Failed sign-ins"
            value={summary?.failed_logins}
            tone={summary?.failed_logins > 0 ? "alert" : undefined}
          />
          <StatCard
            label="Critical actions"
            value={summary?.critical}
            tone={summary?.critical > 0 ? "critical" : undefined}
          />
        </div>

        {summaryError && (
          <p className="mt-2 text-[11px] text-slate-400">
            Overview figures are unavailable right now; the entries below are unaffected.
          </p>
        )}

        {summary?.security && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl bg-amber-50/70 px-3.5 py-2.5 text-[11px] text-amber-900 dark:bg-amber-100/10 dark:text-amber-200">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Icon name="shield" className="h-3.5 w-3.5" />
              Last 24 hours
            </span>
            <span>{summary.security.failed_logins_24h} failed sign-ins</span>
            <span>{summary.security.locked_accounts_24h} lockouts</span>
            <span>{summary.security.repeat_sources_24h} source(s) with repeated failures</span>
            <button
              type="button"
              onClick={showSecurityEvents}
              className="font-semibold underline decoration-amber-400 underline-offset-2 hover:text-amber-950 dark:hover:text-amber-100"
            >
              Review security events
            </button>
          </div>
        )}

        {/* Search + quick windows */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1 sm:max-w-sm">
            <Icon
              name="search"
              className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
                setSelectedId(null);
              }}
              placeholder="Search user, action, entity or IP…"
              className="field w-full pl-9 text-xs"
              aria-label="Search audit trail"
            />
          </div>

          <div
            className="inline-flex flex-wrap rounded-pill border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/60"
            role="group"
            aria-label="Date presets"
          >
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => applyPreset(preset.key)}
                className="rounded-pill px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-white hover:text-brand-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-brand-200"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={showSecurityEvents}
            className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[11px] font-semibold transition ${
              filters.status === "security"
                ? "border-amber-300 bg-amber-100 text-amber-900"
                : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <Icon name="shield" className="h-3.5 w-3.5" />
            Security
          </button>
        </div>

        {/* Server-side filters — each control maps to one query parameter. */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <Filter label="User">
            <select
              className="field w-full"
              value={filters.actor_id}
              onChange={(event) => setFilter("actor_id", event.target.value)}
            >
              <option value="">Anyone</option>
              {vocab.actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.name}
                </option>
              ))}
            </select>
          </Filter>

          <Filter label="Role at the time">
            <select
              className="field w-full"
              value={filters.actor_role}
              onChange={(event) => setFilter("actor_role", event.target.value)}
            >
              <option value="">Any role</option>
              {(vocab.roles.length
                ? vocab.roles
                : [
                    { value: "admin", label: "Admin" },
                    { value: "technician", label: "Technician" },
                  ]
              ).map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </Filter>

          <Filter label="Status">
            <select
              className="field w-full"
              value={filters.status}
              onChange={(event) => setFilter("status", event.target.value)}
            >
              <option value="">Any status</option>
              {(vocab.statuses.length
                ? vocab.statuses
                : [
                    { value: "success", label: "Successful" },
                    { value: "failed", label: "Failed" },
                    { value: "security", label: "Security events" },
                  ]
              ).map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </Filter>

          <Filter label="Module">
            <select
              className="field w-full"
              value={filters.module}
              onChange={(event) => setFilter("module", event.target.value)}
            >
              <option value="">All modules</option>
              {vocab.modules.map((module) => (
                <option key={module.value} value={module.value}>
                  {module.label}
                </option>
              ))}
            </select>
          </Filter>

          <Filter label="Action">
            <select
              className="field w-full"
              value={filters.action}
              onChange={(event) => setFilter("action", event.target.value)}
            >
              <option value="">All actions</option>
              {vocab.actions.map((action) => (
                <option key={action} value={action}>
                  {labelForAction(action)}
                </option>
              ))}
            </select>
          </Filter>

          <Filter label="Entity type">
            <select
              className="field w-full"
              value={filters.target_type}
              onChange={(event) => setFilter("target_type", event.target.value)}
            >
              <option value="">All entities</option>
              {vocab.target_types.map((type) => (
                <option key={type} value={type}>
                  {labelForEntity(type)}
                </option>
              ))}
            </select>
          </Filter>

          <Filter label="IP address">
            <input
              type="text"
              inputMode="text"
              value={filters.ip_address}
              onChange={(event) => setFilter("ip_address", event.target.value)}
              placeholder="e.g. 192.168.1.10"
              className="field w-full"
            />
          </Filter>

          <Filter label="From">
            <input
              type="date"
              className="field w-full"
              value={filters.date_from}
              onChange={(event) => setFilter("date_from", event.target.value)}
              max={filters.date_to || undefined}
            />
          </Filter>

          <Filter label="To">
            <input
              type="date"
              className="field w-full"
              value={filters.date_to}
              onChange={(event) => setFilter("date_to", event.target.value)}
              min={filters.date_from || undefined}
            />
          </Filter>
        </div>

        {hasFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center gap-1.5 rounded-pill border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Icon name="close" className="h-3.5 w-3.5" />
              Clear filters
            </button>
            {lastUpdated && (
              <span className="text-[11px] text-slate-400">
                Updated {formatTime(lastUpdated)}
              </span>
            )}
          </div>
        )}
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 dark:border-slate-200/60">
          <div className="inline-flex rounded-pill border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/60">
            {[
              { key: "table", label: "Table" },
              { key: "timeline", label: "Timeline" },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setView(option.key)}
                aria-pressed={view === option.key}
                className={`rounded-pill px-3 py-1 text-[11px] font-semibold transition ${
                  view === option.key
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {lastUpdated && (
            <span className="text-[11px] text-slate-400">
              Loaded {formatTime(lastUpdated)}
            </span>
          )}
        </div>

        {loading ? (
          <SkeletonList rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No audit entries found"
            description={
              hasFilters
                ? "No entry matches those filters. Widen the date range or clear a filter."
                : "The trail records its first entry as soon as something changes — a sign-in, an edit, an export."
            }
          />
        ) : (
          <>
            {view === "table" ? (
              <AuditTable rows={rows} onOpen={setSelectedId} selectedId={selectedId} />
            ) : (
              <AuditTimeline groups={dayGroups} onOpen={setSelectedId} />
            )}

            <PaginationFooter
              meta={meta}
              shown={rows.length}
              noun="entry"
              onPageChange={(next) => {
                setPage(next);
                setSelectedId(null);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          </>
        )}
      </section>

      <AuditDetailDrawer
        entryId={selectedId}
        summary={selectedRow}
        onClose={closeDrawer}
        hasPrevious={selectedIndex > 0}
        hasNext={selectedIndex >= 0 && selectedIndex < rows.length - 1}
        onPrevious={() => {
          if (selectedIndex > 0) setSelectedId(rows[selectedIndex - 1].id);
        }}
        onNext={() => {
          if (selectedIndex >= 0 && selectedIndex < rows.length - 1) {
            setSelectedId(rows[selectedIndex + 1].id);
          }
        }}
      />
    </div>
  );
}

function StatCard({ label, value, tone }) {
  const toneClass =
    tone === "alert"
      ? "text-rose-700"
      : tone === "critical"
        ? "text-amber-700"
        : "text-slate-900 dark:text-slate-100";

  return (
    <div className="rounded-xl border border-slate-200 px-3.5 py-2.5 dark:border-slate-200/60">
      <p className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
        {label}
      </p>
      <p className={`mt-1 font-display text-xl font-bold tabular-nums ${toneClass}`}>
        {value ?? "—"}
      </p>
    </div>
  );
}

function Filter({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

function StatusDot({ status }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-600 dark:text-slate-300">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${STATUS_TONES[status] ?? STATUS_TONES.success}`}
      />
      {STATUS_TEXT[status] ?? "Successful"}
    </span>
  );
}

function ActorCell({ row }) {
  return (
    <>
      <span className="block font-semibold text-slate-800 dark:text-slate-100">
        {row.actor?.name ?? (row.actor_id ? `#${row.actor_id}` : "System")}
      </span>
      <span className="block text-[11px] text-slate-500">
        {row.actor_role ?? row.actor?.role ?? (row.actor_id ? "deactivated" : "no session")}
      </span>
    </>
  );
}

function AuditTable({ rows, onOpen, selectedId }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
          <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase dark:border-slate-200/60">
            <th scope="col" className="px-4 py-2.5 font-semibold">When</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">User</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Action</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Module / entity</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
            <th scope="col" className="px-4 py-2.5">
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((row) => (
            <tr
              key={row.id}
              tabIndex={0}
              onClick={() => onOpen(row.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(row.id);
                }
              }}
              className={`cursor-pointer transition hover:bg-brand-50/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-700 ${
                selectedId === row.id ? "bg-brand-50/60" : ""
              }`}
            >
              <td className="px-4 py-2.5 whitespace-nowrap text-slate-600 dark:text-slate-300">
                {formatDateTime(row.created_at)}
              </td>
              <td className="px-4 py-2.5">
                <ActorCell row={row} />
              </td>
              <td className="px-4 py-2.5">
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {labelForAction(row.action)}
                </span>
                <span className="block text-[11px] text-slate-500">{row.action}</span>
              </td>
              <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                <span className="block">{row.module_label ?? labelForModule(row.module)}</span>
                <span className="block text-[11px] text-slate-500">
                  {labelForEntity(row.target_type)}
                  {row.target_id ? ` #${row.target_id}` : ""}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <StatusDot status={row.status} />
              </td>
              <td className="px-4 py-2.5 text-right">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(row.id);
                  }}
                  aria-label={`Open details for ${labelForAction(row.action)}`}
                  className="inline-flex items-center gap-1 rounded-pill border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Details
                  <Icon name="arrow-right" className="h-3 w-3" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTimeline({ groups, onOpen }) {
  return (
    <div className="space-y-5 px-4 py-4 sm:px-5">
      {groups.map((group) => (
        <section key={group.day}>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
            {group.day}
          </h3>
          <ol className="relative space-y-1 border-l border-slate-200 pl-4 dark:border-slate-700">
            {group.rows.map((row) => (
              <li key={row.id} className="relative">
                <span
                  aria-hidden="true"
                  className={`absolute top-3 -left-[21px] h-2 w-2 rounded-full ring-2 ring-white dark:ring-slate-900 ${
                    STATUS_TONES[row.status] ?? STATUS_TONES.success
                  }`}
                />
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className="w-full rounded-xl px-3 py-2 text-left transition hover:bg-brand-50/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 dark:hover:bg-slate-800/60"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[11px] font-semibold tabular-nums text-slate-400">
                      {formatTime(row.created_at)}
                    </span>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                      {labelForAction(row.action)}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      · {row.actor?.name ?? (row.actor_id ? `User #${row.actor_id}` : "System")}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {row.module_label ?? labelForModule(row.module)}
                    {row.target_id ? ` · #${row.target_id}` : ""}
                    {row.ip_address ? ` · ${row.ip_address}` : ""}
                  </p>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
