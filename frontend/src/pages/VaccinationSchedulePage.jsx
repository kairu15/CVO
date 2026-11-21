import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { vaccinationApi } from "../api/vaccinationApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { PaginationFooter } from "../components/PaginationFooter";
import { ActionMenu } from "../components/ActionMenu";
import { Modal } from "../components/Modal";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { VaccinationRecordModal } from "../components/VaccinationRecordModal";
import { Icon } from "../components/Icons";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useBarangays } from "../hooks/useBarangays";
import { useAuth } from "../context/AuthContext";
import { getRole } from "../config/roles";

/**
 * Technician Vaccination Schedule.
 *
 * The list is a scoped read model over completed history + the household's
 * next-due override. Recording writes a real history row; rescheduling writes
 * only the override, so the administration record stays intact. All filters
 * and sorting run server-side before pagination.
 */

const STATUSES = [
  { value: "overdue", label: "Overdue" },
  { value: "due-soon", label: "Due soon" },
  { value: "scheduled", label: "Completed cycle" },
  { value: "never", label: "Never vaccinated" },
];

const STATUS_TONES = {
  overdue: "bg-red-50 text-red-700 ring-1 ring-red-200",
  "due-soon": "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  scheduled: "bg-brand-100 text-brand-900 ring-1 ring-brand-200",
  never: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

const STATUS_LABELS = {
  overdue: "Overdue",
  "due-soon": "Due soon",
  scheduled: "Completed cycle",
  never: "Never vaccinated",
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function dueText(row) {
  if (row.status === "never") return "No vaccination on record";
  if (row.next_due_date && row.days_until_due === null) return "No due date";

  const days = row.days_until_due;
  if (days === null || days === undefined) return "—";
  if (days === 0) return "Due today";
  if (days < 0) {
    const overdue = Math.abs(days);
    return `${overdue} ${overdue === 1 ? "day" : "days"} overdue`;
  }
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

function StatusBadge({ status }) {
  return (
    <span
      className={`inline-flex rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${
        STATUS_TONES[status] ?? STATUS_TONES.never
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function monthLabel(value) {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function CalendarView({ rows, month, onMonthChange, onOpen }) {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  const monthRows = rows.filter((row) => row.next_due_date?.slice(0, 7) === month);
  const byDay = useMemo(() => {
    const map = new Map();
    for (const row of monthRows) {
      const day = Number(row.next_due_date.slice(8, 10));
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(row);
    }
    return map;
  }, [monthRows]);

  function shiftMonth(delta) {
    const date = new Date(year, monthNumber - 1 + delta, 1);
    onMonthChange(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="font-display text-sm font-semibold text-slate-900">Vaccination calendar</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {monthRows.length} scheduled {monthRows.length === 1 ? "household" : "households"} in{" "}
            {monthLabel(month)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
          >
            ‹
          </button>
          <span className="min-w-36 text-center text-xs font-semibold text-slate-700">
            {monthLabel(month)}
          </span>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
      </div>

      <div className="hidden p-4 md:block">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="py-1">{day}</div>
          ))}
        </div>

        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: firstWeekday }).map((_, index) => (
            <div key={`blank-${index}`} className="min-h-20 rounded-lg bg-slate-50/40" />
          ))}

          {Array.from({ length: daysInMonth }, (_, index) => {
            const day = index + 1;
            const entries = byDay.get(day) ?? [];

            return (
              <div
                key={day}
                className={`min-h-20 rounded-lg border p-1.5 ${
                  entries.length > 0
                    ? "border-brand-200 bg-brand-50/30"
                    : "border-slate-100 bg-white"
                }`}
              >
                <span className="text-[10px] font-semibold text-slate-500">{day}</span>
                <div className="mt-1 space-y-1">
                  {entries.slice(0, 2).map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => onOpen(row)}
                      title={`${row.name_of_farmer} — ${row.vaccine_name ?? "routine vaccination"}`}
                      className={`block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium ${
                        row.status === "overdue"
                          ? "bg-red-100 text-red-800"
                          : row.status === "due-soon"
                            ? "bg-amber-100 text-amber-900"
                            : "bg-white text-slate-700 ring-1 ring-slate-200"
                      }`}
                    >
                      {row.name_of_farmer}
                    </button>
                  ))}
                  {entries.length > 2 && (
                    <span className="block px-1 text-[9px] text-slate-500">
                      +{entries.length - 2} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile agenda keeps the same month data usable without a tiny grid. */}
      <div className="divide-y divide-slate-100 md:hidden">
        {monthRows.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-slate-500">
            No scheduled vaccinations in {monthLabel(month)}.
          </p>
        ) : (
          monthRows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onOpen(row)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-brand-50/40"
            >
              <span className="w-12 shrink-0 text-center">
                <span className="block font-display text-lg font-bold text-slate-900">
                  {row.next_due_date?.slice(8, 10)}
                </span>
                <span className="block text-[9px] font-semibold text-slate-500 uppercase">
                  {new Date(`${row.next_due_date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" })}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-slate-900">
                  {row.name_of_farmer}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                  {row.vaccine_name || "Routine vaccination"} · {row.barangay ?? row.address}
                </span>
              </span>
              <StatusBadge status={row.status} />
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function HistoryDrawer({ detail, history, loading, error, canRecord, canReschedule, onClose, onRecord, onReschedule, roleKey }) {
  return (
    <Modal
      open={detail !== null}
      title="Vaccination details"
      onClose={onClose}
      contentClassName="max-w-3xl"
    >
      {detail && (
        <div className="space-y-5 text-sm">
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                  Beneficiary
                </p>
                <p className="mt-1 font-display text-base font-bold text-slate-900">
                  {detail.name_of_farmer}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {detail.barangay ?? detail.address}
                  {detail.rsbsa_number ? ` · RSBSA ${detail.rsbsa_number}` : ""}
                  {detail.ear_tag_number ? ` · Ear tag ${detail.ear_tag_number}` : ""}
                </p>
              </div>
              <Link
                to={`/dashboard/${roleKey}/beneficiaries/${detail.beneficiary_id}/lineage`}
                className="btn-secondary !px-3 !py-1.5 text-xs"
              >
                Open household
              </Link>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
            {[
              ["Animal", `${detail.animal_type ?? "—"}${detail.sex ? ` (${detail.sex})` : ""}`],
              ["Current vaccine", detail.vaccine_name || "None recorded"],
              ["Last administered", formatDate(detail.last_vaccination_date)],
              ["Next dose due", formatDate(detail.next_due_date)],
              ["Follow-up", dueText(detail)],
              ["Status", STATUS_LABELS[detail.status] ?? detail.status],
              ["Quantity last record", detail.quantity ?? 1],
              ["Batch / lot", detail.batch_number || "—"],
              ["Technician", detail.technician?.name || "Unassigned"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-slate-500">{label}</dt>
                <dd className="mt-0.5 font-semibold text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>

          {error && <InlineAlert message={error} />}

          <div className="rounded-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h4 className="font-display text-sm font-semibold text-slate-900">
                  Vaccination history
                </h4>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Completed doses are preserved even when the next visit is rescheduled.
                </p>
              </div>
              <span className="rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                {history.length} {history.length === 1 ? "record" : "records"}
              </span>
            </div>

            {loading ? (
              <p className="px-4 py-4 text-xs text-slate-500">Loading history…</p>
            ) : history.length === 0 ? (
              <p className="px-4 py-4 text-xs text-slate-500">
                No completed vaccination has been recorded for this household yet.
              </p>
            ) : (
              <ol className="divide-y divide-slate-100">
                {history.map((item) => (
                  <li key={item.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-slate-900">
                          {item.vaccine_name}
                          <span className="ml-2 font-normal text-slate-500">
                            {formatDate(item.administered_on)}
                          </span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {item.quantity} {item.quantity === 1 ? "animal" : "animals"}
                          {item.batch_number ? ` · Batch ${item.batch_number}` : ""}
                          {item.technician?.name ? ` · ${item.technician.name}` : ""}
                        </p>
                      </div>
                      {item.next_due_on && (
                        <span className="text-[11px] text-slate-500">
                          Next {formatDate(item.next_due_on)}
                        </span>
                      )}
                    </div>
                    {item.notes && (
                      <p className="mt-1 text-xs text-slate-600">{item.notes}</p>
                    )}
                    {item.photo_url && (
                      <a
                        href={item.photo_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-[11px] font-semibold text-brand-800 underline-offset-2 hover:underline"
                      >
                        View supporting photo
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
            {canReschedule && (
              <button
                type="button"
                className="btn-secondary !px-3.5 !py-1.5 text-xs"
                onClick={() => onReschedule(detail)}
              >
                Reschedule next dose
              </button>
            )}
            {canRecord && (
              <button
                type="button"
                className="btn-primary !px-3.5 !py-1.5 text-xs"
                onClick={() => onRecord(detail)}
              >
                Record vaccination
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function VaccinationSchedulePage({ roleKey = "technician" }) {
  const { user } = useAuth();
  const config = getRole(roleKey);
  const [params, setParams] = useSearchParams();
  const [barangays] = useBarangays();

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [summary, setSummary] = useState({});
  const [options, setOptions] = useState({ protocol_days: 180, vaccine_names: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [view, setView] = useState("list");
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const [recordRow, setRecordRow] = useState(null);
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [rescheduleRow, setRescheduleRow] = useState(null);
  const [rescheduleForm, setRescheduleForm] = useState({ next_due_on: "", reason: "" });
  const [rescheduleBusy, setRescheduleBusy] = useState(false);

  const searchTerm = params.get("search") ?? "";
  const statusFilter = params.get("status") ?? "all";
  const barangayFilter = params.get("barangay") ?? "";
  const sort = params.get("sort") ?? "due";
  const direction = params.get("direction") ?? "asc";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const perPage = Number(params.get("per_page") ?? "15") || 15;

  const canRecord = user?.role === "technician";
  const canReschedule = ["admin", "technician"].includes(user?.role);
  // The calendar is a month map, not a paginated table: fetch the full
  // server-capped page so switching from page 4 of the list cannot show a
  // month with only the tail of its households.
  const calendarMode = view === "calendar";

  const updateParams = useCallback(
    (updates, { resetPage = true } = {}) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          for (const [key, value] of Object.entries(updates)) {
            if (value === null || value === undefined || value === "") next.delete(key);
            else next.set(key, String(value));
          }
          if (resetPage) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const [searchInput, setSearchInput] = useState(searchTerm);
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if ((params.get("search") ?? "") === debouncedSearch) return;
    updateParams({ search: debouncedSearch || null });
  }, [debouncedSearch, params, updateParams]);

  useEffect(() => {
    if (searchTerm === searchInput) return;
    setSearchInput(searchTerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const filters = useMemo(
    () => ({
      search: searchTerm || undefined,
      status: statusFilter !== "all" ? statusFilter : undefined,
      barangay: barangayFilter || undefined,
      sort,
      direction,
    }),
    [searchTerm, statusFilter, barangayFilter, sort, direction],
  );

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);

      try {
        const [scheduleRes, summaryRes] = await Promise.all([
          vaccinationApi.schedule({
            ...filters,
            per_page: calendarMode ? 50 : perPage,
            page: calendarMode ? 1 : page,
          }),
          vaccinationApi.summary().catch(() => null),
        ]);

        setRows(scheduleRes?.data ?? []);
        setMeta(scheduleRes?.meta ?? null);
        if (summaryRes) setSummary(summaryRes);
      } catch (err) {
        if (!quiet) setError(getErrorMessage(err));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [filters, perPage, page, calendarMode],
  );

  useEffect(() => {
    load();
  }, [load]);

  useAutoRefresh(load);

  useEffect(() => {
    let active = true;

    vaccinationApi
      .options()
      .then((result) => {
        if (active && result) setOptions(result);
      })
      .catch(() => {
        // The form still works with the program default.
      });

    return () => {
      active = false;
    };
  }, []);

  async function openDetail(row) {
    setDetail(row);
    setHistory([]);
    setHistoryError(null);
    setHistoryLoading(true);

    try {
      const result = await vaccinationApi.history(row.beneficiary_id ?? row.id);
      setHistory(result ?? []);
    } catch (err) {
      setHistoryError(getErrorMessage(err));
    } finally {
      setHistoryLoading(false);
    }
  }

  function openRecord(row) {
    setDetail(null);
    setRecordRow(row);
  }

  function openReschedule(row) {
    setRescheduleRow(row);
    setRescheduleForm({
      next_due_on: row.next_due_date ?? "",
      reason: "",
    });
  }

  async function submitReschedule(event) {
    event.preventDefault();
    if (!rescheduleForm.next_due_on || rescheduleBusy) return;

    setRescheduleBusy(true);
    setError(null);

    try {
      const saved = await vaccinationApi.reschedule(rescheduleRow.id, {
        next_due_on: rescheduleForm.next_due_on,
        reason: rescheduleForm.reason.trim() || null,
      });

      setRescheduleRow(null);
      setDetail((previous) =>
        previous && previous.id === saved.id
          ? { ...previous, ...saved, history }
          : previous,
      );
      await load(true);
      setNotice("Vaccination schedule updated.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRescheduleBusy(false);
    }
  }

  function rowMenuItems(row) {
    const items = [
      { label: "View history", onClick: () => openDetail(row) },
      {
        label: "Open household",
        to: `/dashboard/${roleKey}/beneficiaries/${row.beneficiary_id ?? row.id}/lineage`,
      },
    ];

    if (canRecord) {
      items.push({
        label: "Record vaccination",
        ariaLabel: `Record vaccination for ${row.name_of_farmer}`,
        onClick: () => openRecord(row),
      });
    }
    if (canReschedule) {
      items.push({
        label: "Reschedule next dose",
        ariaLabel: `Reschedule vaccination for ${row.name_of_farmer}`,
        onClick: () => openReschedule(row),
      });
    }

    return items;
  }

  const overview = [
    {
      key: "total",
      label: "Total scheduled",
      value: summary.total_scheduled,
      hint: "households in the schedule",
      status: null,
    },
    {
      key: "upcoming",
      label: "Upcoming",
      value: summary.upcoming,
      hint: "inside the due window",
      status: "due-soon",
    },
    {
      key: "completed",
      label: "Completed",
      value: summary.completed,
      hint: "current cycle complete",
      status: "scheduled",
    },
    {
      key: "overdue",
      label: "Overdue",
      value: summary.overdue,
      hint: "past the next-dose date",
      status: "overdue",
    },
  ];

  const hasFilters = Boolean(
    searchTerm || statusFilter !== "all" || barangayFilter,
  );

  function clearFilters() {
    setSearchInput("");
    updateParams({ search: null, status: null, barangay: null });
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{config?.label ?? "Technician"}</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Vaccination Schedule
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Current doses due, completed vaccination history, and follow-up dates for
              program animals. Rescheduling never rewrites a completed record.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-pill border border-slate-200 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={() => setView("list")}
                aria-pressed={view === "list"}
                className={`rounded-pill px-3 py-1.5 text-xs font-semibold transition ${
                  view === "list" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                }`}
              >
                <Icon name="clipboard" className="mr-1 inline h-3.5 w-3.5" />
                List
              </button>
              <button
                type="button"
                onClick={() => setView("calendar")}
                aria-pressed={view === "calendar"}
                className={`rounded-pill px-3 py-1.5 text-xs font-semibold transition ${
                  view === "calendar" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                }`}
              >
                <Icon name="calendar" className="mr-1 inline h-3.5 w-3.5" />
                Calendar
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {overview.map((tile) => {
            const active = tile.status === null
              ? statusFilter === "all"
              : statusFilter === tile.status;

            return (
              <button
                key={tile.key}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  updateParams({ status: tile.status === null ? null : tile.status })
                }
                className={`rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:border-brand-400 hover:bg-brand-50/40 ${
                  active ? "border-brand-500 ring-1 ring-brand-500/30" : ""
                }`}
              >
                <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
                  {tile.label}
                </p>
                <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
                  {tile.value ?? "—"}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">{tile.hint}</p>
              </button>
            );
          })}
        </div>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}
      {notice && (
        <InlineAlert
          tone="success"
          message={notice}
          onDismiss={() => setNotice(null)}
          autoDismiss={5000}
        />
      )}

      <section className="card px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-64">
            <label htmlFor="vaccine-search" className="block text-sm font-medium text-slate-700">
              Search
            </label>
            <div className="relative mt-1.5">
              <Icon
                name="search"
                className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-400"
              />
              <input
                id="vaccine-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Farmer, RSBSA #, vaccine, batch…"
                className="field pl-9"
              />
            </div>
          </div>

          <div className="w-full sm:w-44">
            <label htmlFor="vaccine-status" className="block text-sm font-medium text-slate-700">
              Status
            </label>
            <select
              id="vaccine-status"
              className="field mt-1.5"
              value={statusFilter}
              onChange={(event) =>
                updateParams({ status: event.target.value === "all" ? null : event.target.value })
              }
            >
              <option value="all">All statuses</option>
              {STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-44">
            <label htmlFor="vaccine-barangay" className="block text-sm font-medium text-slate-700">
              Barangay
            </label>
            <select
              id="vaccine-barangay"
              className="field mt-1.5"
              value={barangayFilter}
              onChange={(event) => updateParams({ barangay: event.target.value || null })}
            >
              <option value="">All barangays</option>
              {barangays.map((barangay) => (
                <option key={barangay.name} value={barangay.name}>
                  {barangay.name}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-48">
            <label htmlFor="vaccine-sort" className="block text-sm font-medium text-slate-700">
              Sort
            </label>
            <select
              id="vaccine-sort"
              className="field mt-1.5"
              value={`${sort}:${direction}`}
              onChange={(event) => {
                const [nextSort, nextDirection] = event.target.value.split(":");
                updateParams({ sort: nextSort, direction: nextDirection });
              }}
            >
              <option value="due:asc">Next dose — soonest</option>
              <option value="due:desc">Next dose — latest</option>
              <option value="name:asc">Farmer A–Z</option>
              <option value="name:desc">Farmer Z–A</option>
              <option value="last_vaccination:desc">Recently vaccinated</option>
              <option value="barangay:asc">Barangay A–Z</option>
            </select>
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-pill px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              Clear filters
            </button>
          )}
        </div>
      </section>

      {view === "calendar" ? (
        loading ? (
          <section className="card"><SkeletonList rows={3} /></section>
        ) : (
          <CalendarView rows={rows} month={month} onMonthChange={setMonth} onOpen={openDetail} />
        )
      ) : (
        <section className="card overflow-hidden">
          {loading ? (
            <SkeletonList rows={4} />
          ) : rows.length === 0 ? (
            <EmptyState
              title={hasFilters ? "No schedules match these filters" : "Nothing due"}
              description={
                hasFilters
                  ? "Clear the filters to see the full schedule."
                  : "No animals to schedule yet — they appear here once beneficiaries are registered."
              }
            />
          ) : (
            <>
              <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-[11px] text-slate-500">
                <span className="font-semibold text-slate-700">
                  {meta?.total ?? rows.length}{" "}
                  {(meta?.total ?? rows.length) === 1 ? "household" : "households"}
                </span>{" "}
                · current cycle and follow-up
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-white">
                    <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                      <th scope="col" className="px-4 py-2.5 font-semibold">Beneficiary</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Animal</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Barangay</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Vaccine</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Next dose</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                      <th scope="col" className="w-16 px-4 py-2.5 text-right font-semibold">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row) => (
                      <tr key={row.id} className="transition hover:bg-brand-50/40">
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => openDetail(row)}
                            className="block max-w-[15rem] truncate text-left font-medium text-slate-900 underline-offset-2 hover:text-brand-800 hover:underline"
                          >
                            {row.name_of_farmer}
                          </button>
                          <span className="mt-0.5 block text-[11px] text-slate-500">
                            {row.rsbsa_number
                              ? `RSBSA ${row.rsbsa_number}`
                              : row.ear_tag_number
                                ? `Ear tag ${row.ear_tag_number}`
                                : "—"}
                          </span>
                        </td>

                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                          {row.animal_type}
                          {row.sex ? ` (${row.sex})` : ""}
                          <span className="mt-0.5 block text-[11px] text-slate-500">
                            {row.quantity ?? 1} {(row.quantity ?? 1) === 1 ? "animal" : "animals"}
                          </span>
                        </td>

                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                          {row.barangay ?? row.address}
                        </td>

                        <td className="px-4 py-2.5 text-slate-600">
                          {row.vaccine_name || "Routine vaccination"}
                          <span className="mt-0.5 block text-[11px] text-slate-500">
                            Last {formatDate(row.last_vaccination_date)}
                            {row.history_count ? ` · ${row.history_count} record${row.history_count === 1 ? "" : "s"}` : ""}
                          </span>
                        </td>

                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {row.next_due_date ? (
                            <>
                              <span className="font-medium text-slate-900">
                                {formatDate(row.next_due_date)}
                              </span>
                              <span
                                className={`mt-0.5 block text-[11px] ${
                                  row.status === "overdue"
                                    ? "font-semibold text-red-700"
                                    : "text-slate-500"
                                }`}
                              >
                                {dueText(row)}
                              </span>
                            </>
                          ) : (
                            <span className="text-[11px] text-slate-500">{dueText(row)}</span>
                          )}
                        </td>

                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <StatusBadge status={row.status} />
                        </td>

                        <td className="px-4 py-2.5 text-right">
                          <ActionMenu
                            label={`Actions for ${row.name_of_farmer}`}
                            items={rowMenuItems(row)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <PaginationFooter
                meta={meta}
                shown={rows.length}
                noun="household"
                onPageChange={(next) =>
                  updateParams({ page: next <= 1 ? null : next }, { resetPage: false })
                }
                pageSize={perPage}
                pageSizeOptions={[15, 25, 50]}
                onPageSizeChange={(size) =>
                  updateParams({ per_page: size === 15 ? null : size })
                }
              />
            </>
          )}
        </section>
      )}

      <VaccinationRecordModal
        open={recordRow !== null}
        row={recordRow}
        protocolDays={options.protocol_days}
        vaccineNames={options.vaccine_names}
        onClose={() => setRecordRow(null)}
        onSaved={async () => {
          await load(true);
          setNotice("Vaccination recorded.");
        }}
      />

      <HistoryDrawer
        detail={detail}
        history={history}
        loading={historyLoading}
        error={historyError}
        canRecord={canRecord}
        canReschedule={canReschedule}
        onClose={() => setDetail(null)}
        onRecord={openRecord}
        onReschedule={openReschedule}
        roleKey={roleKey}
      />

      <Modal
        open={rescheduleRow !== null}
        title="Reschedule next dose"
        onClose={() => setRescheduleRow(null)}
      >
        <p className="text-sm text-slate-600">
          Move the next dose for <strong>{rescheduleRow?.name_of_farmer}</strong>. Completed
          vaccination records stay unchanged.
        </p>

        <form onSubmit={submitReschedule} className="mt-4 space-y-3">
          <div>
            <label htmlFor="reschedule-date" className="block text-sm font-medium text-slate-700">
              New next-dose date
            </label>
            <input
              id="reschedule-date"
              type="date"
              className="field mt-1.5"
              value={rescheduleForm.next_due_on}
              onChange={(event) =>
                setRescheduleForm((previous) => ({ ...previous, next_due_on: event.target.value }))
              }
              required
            />
          </div>
          <div>
            <label htmlFor="reschedule-reason" className="block text-sm font-medium text-slate-700">
              Reason
            </label>
            <input
              id="reschedule-reason"
              type="text"
              className="field mt-1.5"
              placeholder="Optional, e.g. vaccine supply"
              maxLength={255}
              value={rescheduleForm.reason}
              onChange={(event) =>
                setRescheduleForm((previous) => ({ ...previous, reason: event.target.value }))
              }
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setRescheduleRow(null)}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={rescheduleBusy || !rescheduleForm.next_due_on}
            >
              {rescheduleBusy ? (
                <>
                  <ButtonSpinner />
                  Saving…
                </>
              ) : (
                "Save new date"
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
