import { useCallback, useEffect, useMemo, useState } from "react";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { monitoringApi } from "../api/monitoringApi";
import { getErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { MonitoringTable } from "../components/MonitoringTable";
import { MonitoringExcelToolbar } from "../components/MonitoringExcelToolbar";
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
 * @param {string} roleKey dashboard this instance is rendered in (the signed-in
 *   admin sees the same page through the all-access switcher)
 */
export default function MonitoringPage({ roleKey }) {
  const { user } = useAuth();
  const viewerRole = roleKey ?? user?.role;

  const [records, setRecords] = useState([]);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [acceptingId, setAcceptingId] = useState(null);
  const toast = useToast();

  const isTechnician = viewerRole === "technician";
  const canEdit = ["admin", "doctor", "technician"].includes(viewerRole);
  const isAdmin = viewerRole === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const requests = [monitoringApi.list({ per_page: 100 })];
      if (isTechnician) requests.push(beneficiariesApi.list({ per_page: 100 }));

      const [recordsRes, beneficiariesRes] = await Promise.all(requests);

      setRecords(recordsRes ?? []);
      setBeneficiaries(beneficiariesRes ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [isTechnician]);

  useEffect(() => {
    load();
  }, [load]);

  const canLogVisit = useMemo(
    () => isTechnician && beneficiaries.length > 0,
    [isTechnician, beneficiaries],
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
