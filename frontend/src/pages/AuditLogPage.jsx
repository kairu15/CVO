import { useCallback, useEffect, useState } from "react";
import { auditApi } from "../api/auditApi";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { InlineAlert } from "../components/InlineAlert";
import { PaginationFooter } from "../components/PaginationFooter";
import { SkeletonList } from "../components/Skeleton";

/**
 * Admin "Audit Trail" — READ-ONLY.
 *
 * The log is append-only on the server (no write route exists), so this screen
 * deliberately offers no edit or delete controls: filtering and expanding a row
 * are the only things a reader can do.
 *
 * Filtering and paging happen server-side (every filter maps to a SQL WHERE),
 * so a year of history is never shipped to the browser to be sliced there.
 * A row expands into the before/after diff of exactly the fields that changed —
 * secrets are `[hidden]` and identifiers are masked before they were ever
 * stored, so what is shown here is what was recorded.
 */

/** Human copy for the action vocabulary — the same list the API validates. */
const ACTION_LABELS = {
  login: "Signed in",
  logout: "Signed out",
  logout_all: "Signed out everywhere",
  failed_login: "Failed sign-in attempt",
  account_locked: "Account locked out",
  token_issued: "Signed in (mobile token)",
  password_changed: "Password changed",
  password_reset_requested: "Password reset requested",
  password_reset_completed: "Password reset completed",
  role_changed: "Role changed",
  technician_assigned: "Technician assigned",
  user_created: "Account created",
  user_invited: "Account created — setup link sent",
  user_updated: "Account details edited",
  user_deactivated: "Account deactivated",
  user_reactivated: "Account reactivated",
  settings_updated: "Settings saved",
  permissions_updated: "Permission changed",
  reference_data_updated: "Reference data updated",
  exported: "Data exported",
  imported: "Data imported",
  restored: "Record restored",
};

/** Entity type → what the row means to a reader. */
const ENTITY_LABELS = {
  Beneficiary: "Beneficiary",
  MonitoringRecord: "Monitoring record",
  DispersalEvent: "Dispersal event",
  TechnicianAssignment: "Technician assignment",
  User: "Account",
  AnimalType: "Animal type",
  AnimalClassification: "Animal classification",
  Barangay: "Barangay",
  Purok: "Purok",
  Setting: "Setting",
  Permission: "Permission",
};

function labelForAction(action) {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  // `beneficiary_updated` → "Beneficiary updated" — legible without a table
  // entry for every model the vocabulary can grow to.
  return action
    .split("_")
    .map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function labelForEntity(type) {
  if (!type) return "System";
  return ENTITY_LABELS[type] ?? type;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Scalar, boolean, object → a cell-safe string (never a React element). */
function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** The unchanged per-row shape of the filter controls. */
const NO_FILTERS = {
  action: "",
  actor_id: "",
  target_type: "",
  date_from: "",
  date_to: "",
};

export default function AuditLogPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const [filters, setFilters] = useState(NO_FILTERS);
  const [vocab, setVocab] = useState({ actions: [], target_types: [], actors: [] });

  // The vocabulary (actions, entity types, actors) is loaded once; it changes
  // at most when new kinds of rows appear, and a failed fetch only costs the
  // dropdown options, not the table itself.
  useEffect(() => {
    let live = true;

    auditApi
      .filters()
      .then((data) => {
        if (live) setVocab(data ?? { actions: [], target_types: [], actors: [] });
      })
      .catch(() => {});

    return () => {
      live = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const params = {
        page,
        // Only send what is actually set — an empty string would be a valid
        // value for a nullable filter and quietly return nothing.
        ...Object.fromEntries(
          Object.entries(filters).filter(([, value]) => value !== ""),
        ),
      };

      const result = await auditApi.list(params);

      setRows(result.data ?? []);
      setMeta(result.meta ?? null);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
      setRows([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  function setFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setExpandedId(null);
  }

  const hasFilters = Object.values(filters).some((value) => value !== "");

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Administration</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Audit Trail
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Who did what, to which record, and when — including sign-ins,
              exports, imports and the fields each change altered. The trail is
              append-only: rows cannot be edited or removed from here.
            </p>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-pill bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800">
            <Icon name="activity" className="h-3.5 w-3.5" />
            {meta?.total ?? rows.length} {meta?.total === 1 ? "entry" : "entries"}
          </span>
        </div>

        {/* Server-side filters — each control maps to one query parameter. */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              User
            </span>
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
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Action
            </span>
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
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Entity type
            </span>
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
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              From
            </span>
            <input
              type="date"
              className="field w-full"
              value={filters.date_from}
              onChange={(event) => setFilter("date_from", event.target.value)}
              max={filters.date_to || undefined}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              To
            </span>
            <input
              type="date"
              className="field w-full"
              value={filters.date_to}
              onChange={(event) => setFilter("date_to", event.target.value)}
              min={filters.date_from || undefined}
            />
          </label>
        </div>

        {hasFilters && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => {
                setFilters(NO_FILTERS);
                setPage(1);
                setExpandedId(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-pill border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              <Icon name="close" className="h-3.5 w-3.5" />
              Clear filters
            </button>
          </div>
        )}
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}

      <section className="card overflow-hidden">
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
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <colgroup>
                  <col className="w-[22%]" />
                  <col className="w-[20%]" />
                  <col className="w-[24%]" />
                  <col className="w-[24%]" />
                  <col />
                </colgroup>
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                    <th scope="col" className="px-4 py-2.5 font-semibold">When</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">User</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Action</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Entity</th>
                    <th scope="col" className="px-4 py-2.5">
                      <span className="sr-only">Changes</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <AuditRow
                      key={row.id}
                      row={row}
                      expanded={expandedId === row.id}
                      onToggle={() =>
                        setExpandedId((current) => (current === row.id ? null : row.id))
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationFooter
              meta={meta}
              shown={rows.length}
              noun="entry"
              onPageChange={(next) => {
                setPage(next);
                setExpandedId(null);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          </>
        )}
      </section>
    </div>
  );
}

/** One trail row plus its expandable before/after diff. */
function AuditRow({ row, expanded, onToggle }) {
  const hasDiff = Boolean(
    (row.old_values && Object.keys(row.old_values).length > 0) ||
      (row.new_values && Object.keys(row.new_values).length > 0),
  );

  const fields = [
    ...new Set([
      ...Object.keys(row.old_values ?? {}),
      ...Object.keys(row.new_values ?? {}),
    ]),
  ];

  return (
    <>
      <tr
        className={`cursor-pointer transition hover:bg-brand-50/40 ${expanded ? "bg-brand-50/60" : ""}`}
        onClick={onToggle}
      >
        <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
          {formatDateTime(row.created_at)}
        </td>
        <td className="px-4 py-2.5">
          <span className="block font-semibold text-slate-800">
            {row.actor?.name ?? (row.actor_id ? `#${row.actor_id}` : "System")}
          </span>
          <span className="block text-[11px] text-slate-500">
            {row.actor?.role ?? row.actor_role ?? (row.actor_id ? "deactivated" : "no session")}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <span className="font-medium text-slate-800">{labelForAction(row.action)}</span>
          <span className="block text-[11px] text-slate-500">{row.action}</span>
        </td>
        <td className="px-4 py-2.5 text-slate-600">
          {labelForEntity(row.target_type)}
          {row.target_id ? (
            <span className="ml-1.5 text-slate-400">#{row.target_id}</span>
          ) : null}
        </td>
        <td className="px-4 py-2.5 text-right">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide changes" : "Show changes"}
            className="inline-flex items-center gap-1 rounded-pill border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-white"
          >
            {hasDiff ? "Changes" : "Details"}
            <Icon name="chevron-down" className={`h-3 w-3 transition ${expanded ? "rotate-180" : ""}`} />
          </button>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-slate-50/70">
          <td colSpan={5} className="px-4 py-4">
            <div className="space-y-3">
              <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                Changed fields
              </p>

              {fields.length === 0 ? (
                <p className="text-xs text-slate-500">
                  {row.action === "login" || row.action === "logout"
                    ? "This event records an action, not a change to a record — there is no before/after to show."
                    : "No field-level values were stored for this entry (it predates the diff columns, or the event carries no values)."}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-[10px] tracking-wider text-slate-500 uppercase">
                        <th scope="col" className="px-3 py-2 font-semibold">Field</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Before</th>
                        <th scope="col" className="px-3 py-2 font-semibold">After</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {fields.map((field) => {
                        const before = displayValue(row.old_values?.[field]);
                        const after = displayValue(row.new_values?.[field]);
                        const unchanged = before === after;

                        return (
                          <tr key={field}>
                            <td className="px-3 py-2 font-medium text-slate-700">{field}</td>
                            <td
                              className={`px-3 py-2 ${unchanged ? "text-slate-400" : "text-slate-600"}`}
                            >
                              {unchanged ? "—" : before}
                            </td>
                            <td className={`px-3 py-2 ${unchanged ? "text-slate-400" : "font-medium text-slate-900"}`}>
                              {unchanged ? "—" : after}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {row.context && Object.keys(row.context).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(row.context).map(([key, value]) => (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1.5 rounded-pill bg-white px-2.5 py-1 text-[11px] text-slate-600 ring-1 ring-slate-200"
                    >
                      <span className="font-semibold text-slate-700">{key}</span>
                      {displayValue(value)}
                    </span>
                  ))}
                </div>
              )}

              <p className="text-[11px] text-slate-500">
                {row.ip_address ? `IP ${row.ip_address}` : "No IP recorded"}
                {row.user_agent ? ` · ${row.user_agent}` : ""}
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
