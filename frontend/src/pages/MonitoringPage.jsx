import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  useInvalidate,
  useAssignedBeneficiaries,
  useMonitoringAnimalTypes,
  useMonitoringMonths,
  useMonitoringRecords,
} from "../api/queries";
import { useAnimalTypeGroups } from "../hooks/useAnimalTypes";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { monitoringApi } from "../api/monitoringApi";
import { getErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { MonitoringTable } from "../components/MonitoringTable";
import { MonitoringExcelToolbar } from "../components/MonitoringExcelToolbar";
import { MonthYearDropdown } from "../components/MonthYearDropdown";
import { AnimalTypeClassificationSelect } from "../components/AnimalTypeClassificationSelect";
import { VisitFormModal } from "../components/VisitFormModal";
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

/**
 * Livestock Monthly Monitoring — one shared page for every dashboard.
 *
 * The API scopes every response server-side (admin: all, doctor: all,
 * technician: assigned beneficiaries); this page only adapts which actions
 * are offered.
 *
 * Data arrives through the polled React Query hooks: the table refreshes
 * itself every 20s and on tab focus, so beneficiaries added by the admin and
 * technician entries appear without a manual reload.
 *
 * @param {string} roleKey dashboard this instance is rendered in (the signed-in
 *   admin sees the same page through the all-access switcher)
 */
export default function MonitoringPage({ roleKey }) {
  const { user } = useAuth();
  const location = useLocation();
  const viewerRole = roleKey ?? user?.role;
  const invalidate = useInvalidate();

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

  // Row selection for the bulk (select-all) delete.
  const { selected, toggle, toggleAll, clear } = useRowSelection();
  // The month/year dropdown selection — a "YYYY-MM" bucket of
  // `date_monitored`, or null to see every record regardless of month.
  const [selectedMonth, setSelectedMonth] = useState(null);
  // Farmer-name search. Debounced (300ms) so typing does not fire a request
  // per keystroke, and applied server-side like the month filter.
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  // Animal-type filter (null = all types), and which field the table groups
  // under. Grouping by type is the default; admins can switch back to the
  // barangay grouping they had before.
  const [animalType, setAnimalType] = useState(null);
  // Second level of the cascade. Only meaningful once a type is picked; a
  // type change clears it (see the select's onChange).
  const [classificationId, setClassificationId] = useState(null);
  const [groupBy, setGroupBy] = useState("animal_type");
  const toast = useToast();

  const isTechnician = viewerRole === "technician";
  const canEdit = ["admin", "doctor", "technician"].includes(viewerRole);
  const isAdmin = viewerRole === "admin";

  // Polled + refetched-on-focus. `loading` maps to the FIRST fetch only, so
  // background refetches never blank the table into skeletons. The month,
  // search and page ride in the query key: changing any of them fetches from
  // the server (the filters live in the database query, before pagination),
  // so a month shows ALL of its records and a search finds every match — not
  // a slice of an unfiltered page.
  // Sorting is a SERVER-side ORDER BY: by animal type (alphabetical, then the
  // existing date order within a group) or the pre-existing date order.
  const sort = groupBy === "animal_type" ? "animal_type" : "date";

  const recordsQuery = useMonitoringRecords(
    selectedMonth,
    page,
    debouncedSearch,
    animalType,
    sort,
    true,
    classificationId,
  );
  const monthsQuery = useMonitoringMonths();
  const animalTypesQuery = useMonitoringAnimalTypes();
  // The master list supplies the category headers and the classification
  // options; the data-derived list below still supplies values that are not
  // in it (an older import), so no historical row becomes unfilterable.
  const { groups: animalTypeGroups } = useAnimalTypeGroups();
  const beneficiaryQuery = useAssignedBeneficiaries(isTechnician);

  const records = recordsQuery.data?.data ?? [];
  const meta = recordsQuery.data?.meta ?? null;
  const months = monthsQuery.data ?? [];
  const animalTypes = animalTypesQuery.data ?? [];
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

  /** Manual refresh after a mutation, straight into the query cache. */
  const load = useCallback(async () => {
    invalidate.monitoring();
    invalidate.notifications();
    // Deleting an import-created record can also remove its auto-created
    // beneficiary, so refresh the beneficiary-derived views immediately
    // rather than waiting for the next poll.
    invalidate.beneficiaries();
  }, [invalidate]);

  const canLogVisit = useMemo(
    () => isTechnician && beneficiaries.length > 0,
    [isTechnician, beneficiaries],
  );

  /** Dropdown pick: swap the month bucket and reset to the first page. */
  const selectMonth = useCallback((month) => {
    setSelectedMonth(month);
    setPage(1);
  }, []);

  /**
   * Cascading filter pick: swap the type and/or classification and start back
   * at page 1. Changing the type always clears the classification, because a
   * classification only means something inside its own type.
   */
  const selectAnimalType = useCallback((type, nextClassificationId = null) => {
    setAnimalType(type);
    setClassificationId(nextClassificationId);
    setPage(1);
  }, []);

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
              {viewerRole === "doctor"
                ? "All monitoring records across barangays for health oversight. Add clinical remarks or flag concerns on any entry."
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

      {/* Filter row — the month dropdown with the admin Excel import/export
          buttons beside it (admin only; the toolbar contributes nothing for
          other roles). Months with records appear grouped by year, and the
          filter runs server-side so a selection shows the WHOLE month. */}
      {(months.length > 0 || animalTypes.length > 0 || isAdmin) && !loading && (
        <section className="card px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            {months.length > 0 && (
              <>
                {/* Every filter field carries a label above it, so the month
                    and search controls read the same as the animal-type /
                    classification cascade instead of relying on placeholders. */}
                <div className="flex w-full flex-col gap-1.5 sm:w-72">
                  <span className="block text-sm font-medium text-slate-700">
                    Month
                  </span>
                  <MonthYearDropdown
                    months={months}
                    selected={selectedMonth}
                    onSelect={selectMonth}
                  />
                </div>

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

                {/* Search as you type: every keystroke updates the field,
                    the 300ms debounce decides when the request fires, and
                    the page resets so results always start on page 1. */}
                <div className="w-full sm:w-72">
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
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setPage(1);
                      }}
                      placeholder="Search farmer name…"
                      className="field pl-9"
                      aria-label="Search monitoring records by farmer name"
                    />
                  </div>
                </div>
              </>
            )}
            <div className="flex items-center gap-1 rounded-pill border border-slate-200 bg-white p-1 text-xs font-semibold dark:border-slate-300/40 dark:bg-transparent">
              <button
                type="button"
                onClick={() => setGroupBy("animal_type")}
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
                onClick={() => setGroupBy("address")}
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
          // switch. Doctors and technicians see the badge read-only.
          onToggleMoa={isAdmin ? (record) => toggleMoa(record) : undefined}
          moaBusyId={moaBusyId}
          groupBy={groupBy}
          highlightBeneficiaryId={highlightBeneficiaryId}
          emptyState={
            debouncedSearch
              ? {
                  title: "No matching farmers",
                  description: `No monitoring records match “${debouncedSearch}”. Try a different name or clear the search.`,
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
          onPageChange={setPage}
        />
        </section>
      )}

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
