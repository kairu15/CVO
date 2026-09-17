import { useCallback, useEffect, useMemo, useState } from "react";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { monitoringApi } from "../api/monitoringApi";
import { getErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { MonitoringTable } from "../components/MonitoringTable";
import { VisitFormModal } from "../components/VisitFormModal";
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

  const isTechnician = viewerRole === "technician";
  const canEdit = ["admin", "doctor", "technician"].includes(viewerRole);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const requests = [monitoringApi.list({ per_page: 100 })];
      if (isTechnician) requests.push(beneficiariesApi.list({ per_page: 100 }));

      const [recordsRes, beneficiariesRes] = await Promise.all(requests);

      setRecords(recordsRes.data.data ?? []);
      setBeneficiaries(beneficiariesRes?.data.data ?? []);
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

  function openEdit(record) {
    setEditingRecord(record);
    setFormOpen(true);
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
              Log a Visit
            </button>
          )}
        </div>
      </section>

      {error && (
        <div role="alert" className="card border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="card overflow-hidden">
        <MonitoringTable
          records={records}
          loading={loading}
          onEdit={canEdit ? openEdit : undefined}
        />
      </section>

      <VisitFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        beneficiaries={beneficiaries}
        record={editingRecord}
        onSaved={load}
      />
    </div>
  );
}
