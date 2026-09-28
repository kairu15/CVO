import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useInvalidate,
  useAssignedBeneficiaries,
  useMonitoringMonths,
  useMonitoringRecords,
} from "../api/queries";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { monitoringApi } from "../api/monitoringApi";
import { getErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { MonitoringTable } from "../components/MonitoringTable";
import { MonitoringExcelToolbar } from "../components/MonitoringExcelToolbar";
import { MonthYearTabs } from "../components/MonthYearTabs";
import { VisitFormModal } from "../components/VisitFormModal";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { InlineAlert } from "../components/InlineAlert";
import { Icon } from "../components/Icons";

/**
 * Livestock Monthly Monitoring — one shared page for all four dashboards.
 *
 * The API scopes every response server-side (admin: all, doctor: all,
 * technician: assigned beneficiaries, farmer: own animals); this page only
 * adapts which actions are offered.
 *
 * Data arrives through the polled React Query hooks: the table refreshes
 * itself every 20s and on tab focus, so new registrations, technician
 * entries and acceptances from other users appear without a manual reload.
 *
 * @param {string} roleKey dashboard this instance is rendered in (the signed-in
 *   admin sees the same page through the all-access switcher)
 */
export default function MonitoringPage({ roleKey }) {
  const { user } = useAuth();
  const viewerRole = roleKey ?? user?.role;
  const invalidate = useInvalidate();

  const [beneficiaries, setBeneficiaries] = useState([]);
  const [error, setError] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [acceptingId, setAcceptingId] = useState(null);
  // The month/year tab selection — a "YYYY-MM" bucket of `date_monitored`,
  // or null to see every record regardless of month.
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [page, setPage] = useState(1);
  const toast = useToast();

  const isTechnician = viewerRole === "technician";
  const canEdit = ["admin", "doctor", "technician"].includes(viewerRole);
  const isAdmin = viewerRole === "admin";

  // Polled + refetched-on-focus. `loading` maps to the FIRST fetch only, so
  // background refetches never blank the table into skeletons. The month and
  // page ride in the query key: switching a tab fetches that month from the
  // server (the filter lives in the database query, before pagination), so a
  // month shows ALL of its records — not a slice of an unfiltered page.
  const recordsQuery = useMonitoringRecords(selectedMonth, page);
  const monthsQuery = useMonitoringMonths();
  const beneficiaryQuery = useAssignedBeneficiaries(isTechnician);

  const records = recordsQuery.data?.data ?? [];
  const meta = recordsQuery.data?.meta ?? null;
  const months = monthsQuery.data ?? [];
  const loading = recordsQuery.isPending;
  const fetchError = recordsQuery.error ?? monthsQuery.error ?? beneficiaryQuery.error;

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
  }, [invalidate]);

  const canLogVisit = useMemo(
    () => isTechnician && beneficiaries.length > 0,
    [isTechnician, beneficiaries],
  );

  /** Tab click: swap the month bucket and reset to the first page. */
  const selectMonth = useCallback((month) => {
    setSelectedMonth(month);
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

  function openEdit(record) {
    setEditingRecord(record);
    setFormOpen(true);
  }

  /** Admin accepts a registration-created record — keeps "New" until midnight. */
  async function confirmAccept(record) {
    setAcceptingId(record.id);

    try {
      await monitoringApi.acceptRegistration(record.id);
      toast.success("Marked as accepted");
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setAcceptingId(null);
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
              {viewerRole === "farmer"
                ? "Your animal's visit history — vitamins, deworming, vaccination and condition scores logged by the CVO field team."
                : viewerRole === "doctor"
                  ? "All monitoring records across barangays for health oversight. Add clinical remarks or flag concerns on any entry."
                  : "Visit history grouped per barangay, mirroring the CVO monitoring sheets. Farmer identity details flow from registration — they are never retyped."}
            </p>
          </div>

          {canLogVisit && (
            <button type="button" onClick={openCreate} className="btn-primary">
              <Icon name="clipboard-check" className="h-4 w-4" />
              Add monitoring record
            </button>
          )}
        </div>

        {isAdmin && (
          <div className="mt-5 border-t border-slate-100 pt-5">
            <MonitoringExcelToolbar />
          </div>
        )}
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}

      {/* Month/year tabs — the same months the Excel export emits one sheet
          for. Only months with records appear, oldest → newest, and the
          filter runs server-side so a tab shows the WHOLE month. */}
      {!loading && months.length > 0 && (
        <section className="card px-4 py-3">
          <MonthYearTabs
            months={months}
            selected={selectedMonth}
            onSelect={selectMonth}
          />
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
        <MonitoringTable
          records={records}
          loading={loading}
          onEdit={canEdit ? openEdit : undefined}
          onDelete={canEdit ? (record) => setDeleting(record) : undefined}
          onAccept={isAdmin ? (record) => confirmAccept(record) : undefined}
          acceptingId={acceptingId}
          emptyState={
            selectedMonth
              ? {
                  title: "No records this month",
                  description:
                    "No monitoring visits are recorded for this month. Choose another month or view all months.",
                }
              : undefined
          }
        />

        {meta && meta.last_page > 1 && (
          <div className="flex items-center justify-between gap-4 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
            <span>
              Showing {records.length} of {meta.total} record
              {meta.total === 1 ? "" : "s"}
              {selectedMonth ? " in this month" : ""}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="chevron-down" className="h-3.5 w-3.5 -rotate-90" />
                Prev
              </button>
              <span className="tabular-nums">
                Page {meta.current_page} of {meta.last_page}
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(meta.last_page, current + 1))}
                disabled={page >= meta.last_page}
                className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
                <Icon name="chevron-down" className="h-3.5 w-3.5 rotate-90" />
              </button>
            </div>
          </div>
        )}
        </section>
      )}

      <VisitFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        beneficiaries={beneficiaries}
        record={editingRecord}
        onSaved={load}
      />

      <Modal open={deleting !== null} title="Delete monitoring record" onClose={() => setDeleting(null)}>
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
    </div>
  );
}
