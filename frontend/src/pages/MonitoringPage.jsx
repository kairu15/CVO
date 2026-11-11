import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  useInvalidate,
  useAssignedBeneficiaries,
  useMonitoringAnimalTypes,
  useMonitoringMonths,
  useMonitoringRecords,
  useMonitoringSummary,
} from "../api/queries";
import { useAnimalTypeGroups } from "../hooks/useAnimalTypes";
import { useBarangays } from "../hooks/useBarangays";
import { monitoringApi } from "../api/monitoringApi";
import { getErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { MONITORING_COLUMNS, MonitoringTable } from "../components/MonitoringTable";
import { MonitoringColumnMenu } from "../components/MonitoringColumnMenu";
import { MonitoringExcelToolbar } from "../components/MonitoringExcelToolbar";
import { MonthYearDropdown } from "../components/MonthYearDropdown";
import { AnimalTypeClassificationSelect } from "../components/AnimalTypeClassificationSelect";
import { VisitFormModal } from "../components/VisitFormModal";
import { DispersalDialog } from "../components/DispersalDialog";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { InlineAlert } from "../components/InlineAlert";
import { Icon } from "../components/Icons";
import { SelectAllCheckbox } from "../components/SelectAllCheckbox";
import { BulkActionBar } from "../components/BulkActionBar";
import { PaginationFooter } from "../components/PaginationFooter";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useFlashHighlight } from "../hooks/useFlashHighlight";
import { useRowSelection } from "../hooks/useRowSelection";

/** Where each administrator's column choice is remembered (per browser). */
const COLUMNS_STORAGE_KEY = "cvo.monitoring.columns.v1";

/**
 * The Compact preset: the columns an administrator scans a visit list with.
 * Everything else stays in the row payload and the Excel export — this only
 * hides it from the screen.
 */
const COMPACT_COLUMNS = [
  "name_of_farmer",
  "rsbsa_number",
  "address",
  "animal_type",
  "date_monitored",
  "last_visit",
  "assigned_technician",
];

const DEFAULT_COLUMNS = MONITORING_COLUMNS.map((column) => column.key);

/** Read the saved column set, tolerating a cleared or corrupt store. */
function readStoredColumns() {
  try {
    const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMNS;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_COLUMNS;

    const known = new Set(DEFAULT_COLUMNS);
    const filtered = parsed.filter((key) => known.has(key));

    return filtered.length > 0 ? filtered : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

/** The "needs attention" worklist filter, per household. */
const ATTENTION_OPTIONS = [
  { value: "", label: "All households" },
  { value: "never", label: "Never visited" },
  { value: "30", label: "No visit in 30 days" },
  { value: "60", label: "No visit in 60 days" },
];

/**
 * Livestock Monthly Monitoring — one shared page for every dashboard.
 *
 * The API scopes every response server-side (every staff role reads the
 * city-wide record); this page only adapts which actions are offered.
 *
 * Filters live in the URL, so a view is shareable and survives a refresh:
 * `month`, `search`, `animal_type`, `classification_id`, `barangay`,
 * `attention`, `group`, `sort`, `direction`, `page`, `per_page`.
 *
 * Data arrives through the polled React Query hooks: the table refreshes
 * itself every 20s and on tab focus, and the KPI strip every 60s, so
 * beneficiaries added by the admin and technician entries appear without a
 * manual reload.
 *
 * @param {string} roleKey dashboard this instance is rendered in (the signed-in
 *   admin sees the same page through the all-access switcher)
 */
export default function MonitoringPage({ roleKey }) {
  const { user } = useAuth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const viewerRole = roleKey ?? user?.role;
  const invalidate = useInvalidate();
  const toast = useToast();
  const [barangays] = useBarangays();

  // A notification that points here seeds the farmer to flash via router
  // state; the id clears itself so the row's tint fades back out.
  const [highlightBeneficiaryId] = useFlashHighlight(
    location.state?.highlightBeneficiaryId ?? null,
    2600,
  );

  const [beneficiaries, setBeneficiaries] = useState([]);
  const [error, setError] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [removing, setRemoving] = useState(false);
  // Id of the record whose inline MOA save is in flight (admin toggle).
  const [moaBusyId, setMoaBusyId] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // The shared DispersalDialog, opened from a record's row action.
  const [dispersal, setDispersal] = useState(null);
  // Remembered column visibility (Compact / custom).
  const [visibleColumns, setVisibleColumns] = useState(readStoredColumns);

  // Row selection for the bulk (select-all) delete.
  const { selected, toggle, toggleAll, clear } = useRowSelection();

  // ── URL-backed filters ──────────────────────────────────────────────────
  const selectedMonth = params.get("month") || null;
  const searchParam = params.get("search") ?? "";
  const animalType = params.get("animal_type") || null;
  const classificationId = params.get("classification_id") || null;
  const barangay = params.get("barangay") || null;
  const attention = params.get("attention") || "";
  const groupBy = params.get("group") === "address" ? "address" : "animal_type";
  const sortParam = params.get("sort") || null;
  const direction = params.get("direction") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(params.get("page") || 1) || 1);
  const perPage = Number(params.get("per_page") || 50) || 50;
  // Sorting is a SERVER-side ORDER BY. Without a header choice, grouping by
  // animal type orders alphabetically by type and the barangay view keeps the
  // pre-existing date order.
  const sort = sortParam ?? (groupBy === "animal_type" ? "animal_type" : "date");

  const updateParams = useCallback(
    (updates, { resetPage = true } = {}) => {
      // A filter change is a different selection; stale ids must not survive.
      clear();
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
    [setParams, clear],
  );

  // Search as you type: the field updates immediately, the 300ms debounce
  // decides when the URL (and therefore the request) changes.
  const [search, setSearch] = useState(searchParam);
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    // Guard: writing the same term back on every param change would reset
    // pagination to page 1 on unrelated filter clicks.
    if ((params.get("search") ?? "") === debouncedSearch) return;

    updateParams({ search: debouncedSearch || null });
  }, [debouncedSearch, params, updateParams]);

  useEffect(() => {
    if (searchParam === search) return;
    setSearch(searchParam);
    // Only an external change (Clear filters, browser navigation) re-seeds the
    // box; while typing, searchParam is the older value and must not overwrite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParam]);

  const isTechnician = viewerRole === "technician";
  const canEdit = ["admin", "technician"].includes(viewerRole);
  const isAdmin = viewerRole === "admin";
  // Only the roles that may actually record a handover get the row action
  // (manage_dispersal / manage_redispersal).
  const canDisperse = viewerRole === "admin" || viewerRole === "technician";

  const recordsQuery = useMonitoringRecords({
    month: selectedMonth,
    page,
    search: searchParam,
    animalType,
    classificationId,
    barangay,
    attention,
    sort,
    direction,
    groupBy,
    perPage,
  });
  const summaryQuery = useMonitoringSummary();
  const monthsQuery = useMonitoringMonths();
  const animalTypesQuery = useMonitoringAnimalTypes();
  const { groups: animalTypeGroups } = useAnimalTypeGroups();
  const beneficiaryQuery = useAssignedBeneficiaries(isTechnician);

  const records = recordsQuery.data?.data ?? [];
  const meta = recordsQuery.data?.meta ?? null;
  const groupTotals = recordsQuery.data?.group_totals ?? null;
  const months = monthsQuery.data ?? [];
  const animalTypes = animalTypesQuery.data ?? [];
  const summary = summaryQuery.data ?? {};
  const loading = recordsQuery.isPending;
  const fetchError =
    recordsQuery.error ?? monthsQuery.error ?? animalTypesQuery.error ?? beneficiaryQuery.error;

  useEffect(() => {
    setError(fetchError ? getErrorMessage(fetchError) : null);
  }, [fetchError]);

  // The technician's picker list — same data, separate hook (30s poll).
  const beneficiaryList = beneficiaryQuery.data;

  useEffect(() => {
    setBeneficiaries(beneficiaryList ?? []);
  }, [beneficiaryList]);

  /** "Updated 12s ago" — the table polls, so say so instead of leaving doubt. */
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const updatedAt = recordsQuery.dataUpdatedAt;
  const secondsAgo = updatedAt ? Math.max(0, Math.floor((clock - updatedAt) / 1000)) : null;
  const updatedLabel =
    secondsAgo === null
      ? "Not loaded yet"
      : secondsAgo < 5
        ? "Updated just now"
        : secondsAgo < 60
          ? `Updated ${secondsAgo}s ago`
          : `Updated ${Math.floor(secondsAgo / 60)}m ago`;

  /** Manual refresh after a mutation, straight into the query cache. */
  const load = useCallback(async () => {
    await recordsQuery.refetch();
    invalidate.monitoring();
    invalidate.notifications();
    // Deleting an import-created record can also remove its auto-created
    // beneficiary, so refresh the beneficiary-derived views immediately
    // rather than waiting for the next poll.
    invalidate.beneficiaries();
  }, [recordsQuery, invalidate]);

  const canLogVisit = useMemo(
    () => isTechnician && beneficiaries.length > 0,
    [isTechnician, beneficiaries],
  );

  function persistColumns(next) {
    setVisibleColumns(next);
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A blocked storage API must never break the table.
    }
  }

  /** Dropdown pick: swap the month bucket and reset to the first page. */
  const selectMonth = useCallback(
    (month) => updateParams({ month: month || null }),
    [updateParams],
  );

  /**
   * Cascading filter pick: swap the type and/or classification and start back
   * at page 1. Changing the type always clears the classification, because a
   * classification only means something inside its own type.
   */
  const selectAnimalType = useCallback(
    (type, nextClassificationId = null) =>
      updateParams({
        animal_type: type || null,
        classification_id: nextClassificationId || null,
      }),
    [updateParams],
  );

  function openCreate() {
    setEditingRecord(null);
    setFormOpen(true);
  }

  /** Delete the technician's own record (admin may delete any) — policy mirrors FieldVisit. */
  async function confirmDelete() {
    if (!deleting) return;

    setRemoving(true);

    try {
      await monitoringApi.remove(deleting.id);
      toast.success("Monitoring record deleted.");
      setDeleting(null);
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setRemoving(false);
    }
  }

  /** Bulk delete for the selected rows; each row is authorized individually. */
  async function confirmBulkDelete() {
    if (selected.size === 0) return;

    setBulkBusy(true);
    try {
      const result = await monitoringApi.bulkRemove([...selected]);
      const failed = result?.failed_ids?.length ?? 0;

      setBulkOpen(false);
      clear();
      await load();

      toast.success(
        failed > 0
          ? `Deleted ${result.deleted} of ${result.deleted + failed} records; ${failed} could not be deleted.`
          : `Deleted ${result.deleted} ${result.deleted === 1 ? "record" : "records"}.`,
      );
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBulkBusy(false);
    }
  }

  function openEdit(record) {
    setEditingRecord(record);
    setFormOpen(true);
  }

  /**
   * Admin flips the dispersal's MOA status from the table's inline switch.
   * The value is per DISPERSAL (per beneficiary), so every visit row for the
   * same household changes with it — the list is refreshed rather than just
   * the clicked row patched. The switch shows an in-flight spinner (driven by
   * `moaBusyId`) until the save settles, and a toast reports the outcome.
   */
  async function toggleMoa(record) {
    setMoaBusyId(record.id);

    try {
      // null (not on file) and false both flip to signed; true flips off.
      const next = record.moa_signed !== true;
      await monitoringApi.setMoa(record.id, next);
      toast.success(next ? "MOA marked as signed" : "MOA marked as not signed");
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setMoaBusyId(null);
    }
  }

  const summaryTiles = [
    {
      key: "households",
      label: "Households",
      value: summary.households_monitored,
      hint: "monitored this month",
    },
    {
      key: "visits",
      label: "Visits logged",
      value: summary.visits,
      hint: "this month",
    },
    {
      key: "never",
      label: "Never visited",
      value: summary.never_visited,
      hint: "assigned households",
      attention: "never",
      tone: "amber",
    },
    {
      key: "photo",
      label: "No field photo",
      value: summary.without_photo,
      hint: "this month",
    },
    {
      key: "moa",
      label: "MOA unsigned",
      value: summary.moa_unsigned,
      hint: "this month",
      tone: "amber",
    },
  ];

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Livestock Monthly Monitoring</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Monitoring records
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              {viewerRole === "technician"
                ? "All monitoring records across barangays — your visits and the health oversight view. Add clinical remarks or flag concerns on any entry."
                : "Visit history grouped per barangay, mirroring the CVO monitoring sheets. Beneficiary identity details flow from the enrolled record — they are never retyped."}
            </p>
          </div>

          {canLogVisit && (
            <button type="button" onClick={openCreate} className="btn-primary">
              <Icon name="clipboard-check" className="h-4 w-4" />
              Add monitoring record
            </button>
          )}
        </div>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}

      {/* Oversight at a glance: one aggregate request, polled slower than the
          rows. "Never visited" doubles as the worklist filter. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {summaryTiles.map((tile) => {
          const clickable = Boolean(tile.attention);
          const active = clickable && attention === tile.attention;
          const Wrapper = clickable ? "button" : "div";

          return (
            <Wrapper
              key={tile.key}
              {...(clickable
                ? {
                    type: "button",
                    onClick: () =>
                      updateParams({ attention: active ? null : tile.attention }),
                    "aria-pressed": active,
                  }
                : {})}
              className={`card px-4 py-3 text-left transition ${
                clickable ? "hover:border-brand-400 hover:bg-brand-50/40" : ""
              } ${active ? "border-brand-500 ring-1 ring-brand-500/30" : ""}`}
            >
              <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
                {tile.label}
              </p>
              <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {tile.value === undefined || tile.value === null ? "—" : tile.value}
              </p>
              {tile.hint && (
                <p className="mt-0.5 text-[11px] text-slate-500">{tile.hint}</p>
              )}
              {tile.tone === "amber" && Number(tile.value) > 0 && (
                <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
              )}
            </Wrapper>
          );
        })}
      </section>

      {/* Filter row. Every filter runs server-side, before pagination, so a
          selection shows the WHOLE matching set rather than a page slice. */}
      {(months.length > 0 || animalTypes.length > 0 || isAdmin) && !loading && (
        <section className="card px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            {months.length > 0 && (
              <div className="flex w-full flex-col gap-1.5 sm:w-56">
                <span className="block text-sm font-medium text-slate-700">
                  Month
                </span>
                <MonthYearDropdown
                  months={months}
                  selected={selectedMonth}
                  onSelect={selectMonth}
                />
              </div>
            )}

            <AnimalTypeClassificationSelect
              groups={animalTypeGroups}
              extraTypes={animalTypes}
              allowAll
              typeValue={animalType ?? ""}
              classificationValue={classificationId ?? ""}
              onChange={({ animalType: type, classificationId: id }) =>
                selectAnimalType(type || null, id ? Number(id) : null)
              }
              typeLabel="Animal type"
              typeAriaLabel="Filter by animal type"
              classificationLabel="Classification"
              classificationAriaLabel="Filter by classification"
              typeId="monitoring-animal-type"
              classificationId="monitoring-classification"
              className="w-full sm:w-80"
            />

            {/* Search as you type: the field updates immediately, the 300ms
                debounce decides when the request fires, and the page resets so
                results always start on page 1. */}
            <div className="w-full sm:w-64">
              <label
                htmlFor="monitoring-search"
                className="block text-sm font-medium text-slate-700"
              >
                Search
              </label>
              <div className="relative mt-1.5">
                <Icon
                  name="search"
                  className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-400"
                />
                <input
                  id="monitoring-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name, RSBSA #, ear tag, technician…"
                  className="field pl-9"
                  aria-label="Search monitoring records by farmer name, RSBSA number, ear tag or technician"
                />
              </div>
            </div>

            <div className="w-full sm:w-44">
              <label
                htmlFor="monitoring-barangay"
                className="block text-sm font-medium text-slate-700"
              >
                Barangay
              </label>
              <select
                id="monitoring-barangay"
                className="field mt-1.5"
                value={barangay ?? ""}
                onChange={(event) =>
                  updateParams({ barangay: event.target.value || null })
                }
                aria-label="Filter monitoring records by barangay"
              >
                <option value="">All barangays</option>
                {barangays.map((entry) => (
                  <option key={entry.id ?? entry.name} value={entry.name}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full sm:w-48">
              <label
                htmlFor="monitoring-attention"
                className="block text-sm font-medium text-slate-700"
              >
                Needs attention
              </label>
              <select
                id="monitoring-attention"
                className="field mt-1.5"
                value={attention}
                onChange={(event) =>
                  updateParams({ attention: event.target.value || null })
                }
                aria-label="Filter monitoring records by attention"
              >
                {ATTENTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1 rounded-pill border border-slate-200 bg-white p-1 text-xs font-semibold dark:border-slate-300/40 dark:bg-transparent">
              <button
                type="button"
                onClick={() => updateParams({ group: null })}
                aria-pressed={groupBy === "animal_type"}
                className={`rounded-pill px-3 py-1 transition ${
                  groupBy === "animal_type"
                    ? "bg-brand-700 text-white"
                    : "text-slate-600 hover:bg-brand-50 dark:text-slate-400"
                }`}
              >
                Group by type
              </button>
              <button
                type="button"
                onClick={() => updateParams({ group: "address" })}
                aria-pressed={groupBy === "address"}
                className={`rounded-pill px-3 py-1 transition ${
                  groupBy === "address"
                    ? "bg-brand-700 text-white"
                    : "text-slate-600 hover:bg-brand-50 dark:text-slate-400"
                }`}
              >
                Group by barangay
              </button>
            </div>

            <MonitoringColumnMenu
              columns={MONITORING_COLUMNS}
              visible={visibleColumns}
              onChange={persistColumns}
              compact={COMPACT_COLUMNS}
            />

            {isAdmin && (
              <MonitoringExcelToolbar
                month={selectedMonth}
                animalType={animalType}
                classificationId={classificationId}
              />
            )}
          </div>
        </section>
      )}

      {/* A technician with zero assignments sees an explicit boundary message,
          not a generic "no records" — the two mean different things. */}
      {isTechnician && !loading && !error && beneficiaries.length === 0 ? (
        <section className="card">
          <EmptyState
            title="No farmers assigned to you yet"
            description="You haven't been assigned any farmers. Contact an administrator to be assigned households to monitor."
          />
        </section>
      ) : (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-200/60 dark:text-slate-400">
            <span aria-live="polite">{updatedLabel}</span>
            <button
              type="button"
              onClick={load}
              disabled={recordsQuery.isFetching}
              className="rounded-pill px-3 py-1 font-semibold text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon name="refresh" className="mr-1 inline h-3.5 w-3.5" />
              {recordsQuery.isFetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {canEdit && records.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5">
              <SelectAllCheckbox
                ids={records.map((record) => record.id)}
                selected={selected}
                onToggleAll={toggleAll}
                label="Select all monitoring records on this page"
              />
              <span className="text-xs font-semibold text-slate-600">Select all</span>
            </div>
          )}

          <BulkActionBar
            count={selected.size}
            noun="record"
            onClear={clear}
            onDelete={() => setBulkOpen(true)}
            busy={bulkBusy}
          />

          <MonitoringTable
            records={records}
            loading={loading}
            onEdit={canEdit ? openEdit : undefined}
            onDelete={canEdit ? (record) => setDeleting(record) : undefined}
            selected={selected}
            onToggleRow={canEdit ? (record) => toggle(record.id) : undefined}
            // MOA is a program-oversight field: only an admin gets the inline
            // switch. Technicians see the badge read-only.
            onToggleMoa={isAdmin ? (record) => toggleMoa(record) : undefined}
            onDispersal={
              canDisperse
                ? (record) =>
                    setDispersal({
                      // The household already holds an animal, so the default
                      // action is the handover; the dialog offers "disperse a
                      // new animal" when it finds none.
                      mode: "re-disperse",
                      beneficiary: {
                        id: record.beneficiary_id,
                        name_of_farmer: record.name_of_farmer,
                        address: record.address,
                      },
                    })
                : undefined
            }
            moaBusyId={moaBusyId}
            groupBy={groupBy}
            groupTotals={groupTotals}
            visibleColumns={visibleColumns}
            sort={sort}
            direction={direction}
            onSort={(key) =>
              updateParams({
                sort: key,
                direction: sortParam === key && direction === "asc" ? "desc" : "asc",
              })
            }
            highlightBeneficiaryId={highlightBeneficiaryId}
            emptyState={
              debouncedSearch
                ? {
                    title: "No matching farmers",
                    description: `No monitoring records match “${debouncedSearch}”. Try a different name, RSBSA number, ear tag or technician, or clear the search.`,
                  }
                : attention === "never"
                  ? {
                      title: "No unvisited households",
                      description:
                        "Every assigned household has at least one dated monitoring visit.",
                    }
                  : attention
                    ? {
                        title: "No overdue households",
                        description: `No household is overdue by ${attention}+ days.`,
                      }
                    : animalType
                      ? {
                          title: `No ${animalType} records${selectedMonth ? " this month" : ""}`,
                          description: `No monitoring records for ${animalType}${selectedMonth ? " in the selected month" : ""}. Pick another animal type or clear the filter.`,
                        }
                      : selectedMonth
                        ? {
                            title: "No records this month",
                            description:
                              "No monitoring visits are recorded for this month. Choose another month or view all months.",
                          }
                        : undefined
            }
          />

          <PaginationFooter
            meta={meta}
            shown={records.length}
            noun="record"
            pageSize={perPage}
            pageSizeOptions={[25, 50]}
            onPageSizeChange={(size) =>
              updateParams({ per_page: size === 50 ? null : size })
            }
            onPageChange={(next) =>
              updateParams(
                { page: next <= 1 ? null : next },
                { resetPage: false },
              )
            }
          />
        </section>
      )}

      <DispersalDialog
        open={dispersal !== null}
        mode={dispersal?.mode ?? "re-disperse"}
        beneficiary={dispersal?.beneficiary ?? null}
        onClose={() => setDispersal(null)}
        onSaved={load}
      />

      <VisitFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        beneficiaries={beneficiaries}
        record={editingRecord}
        onSaved={load}
      />

      <Modal
        open={deleting !== null}
        title="Delete monitoring record"
        onClose={() => setDeleting(null)}
      >
        <p className="text-sm text-slate-600">
          Delete the {deleting?.date_monitored ?? ""} monitoring entry for{" "}
          <strong>{deleting?.name_of_farmer}</strong>? This removes it from the
          monitoring sheet and cannot be undone.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setDeleting(null)}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={confirmDelete} disabled={removing}>
            {removing ? (
              <>
                <ButtonSpinner />
                Deleting…
              </>
            ) : (
              "Delete record"
            )}
          </button>
        </div>
      </Modal>

      <Modal
        open={bulkOpen}
        title={`Delete ${selected.size} selected ${selected.size === 1 ? "record" : "records"}`}
        onClose={() => setBulkOpen(false)}
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            Delete <strong>{selected.size}</strong> selected monitoring
            record{selected.size === 1 ? "" : "s"}? This cannot be undone.
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setBulkOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary bg-red-600 hover:bg-red-700"
            onClick={confirmBulkDelete}
            disabled={bulkBusy}
          >
            {bulkBusy ? (
              <>
                <ButtonSpinner />
                Deleting…
              </>
            ) : (
              "Delete selected"
            )}
          </button>
        </div>
      </Modal>
    </div>
  );
}
