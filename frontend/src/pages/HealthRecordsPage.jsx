import { useCallback, useEffect, useState } from "react";
import { healthRecordsApi } from "../api/healthRecordsApi";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { getErrorMessage } from "../api/client";
import { HealthRecordFormModal, outcomeLabel } from "../components/HealthRecordFormModal";
import { Modal } from "../components/Modal";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { Icon } from "../components/Icons";
import { useAuth } from "../context/AuthContext";
import { getRole } from "../config/roles";

/**
 * Doctor "Health Records" screen.
 *
 * Clinical diagnoses authored by a veterinarian, kept separate from the
 * monthly monitoring workbook. Which rows a user receives is decided
 * server-side (HealthRecordService); the controls below mirror
 * HealthRecordPolicy so the UI does not offer an action the API will refuse —
 * a mirror, not a substitute for the server check.
 */

/** Outcome badge tones — the closed-out states read differently at a glance. */
const OUTCOME_TONES = {
  recovered: "bg-brand-100 text-brand-900",
  improving: "bg-sky-50 text-sky-800",
  ongoing: "bg-amber-50 text-amber-800",
  referred: "bg-slate-100 text-slate-700",
  deceased: "bg-red-50 text-red-700",
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export default function HealthRecordsPage({ roleKey = "doctor" }) {
  const { user } = useAuth();
  const config = getRole(roleKey);

  const [records, setRecords] = useState([]);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [outcomes, setOutcomes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [removing, setRemoving] = useState(false);

  // Mirrors HealthRecordPolicy::create — only a veterinarian authors records.
  const canAuthor = user?.role === "doctor";

  // Mirrors HealthRecordPolicy::update — the author, or an administrator.
  const canModify = (record) =>
    user?.role === "admin" ||
    (user?.role === "doctor" && record.doctor_id === user?.id);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [recordsRes, optionsRes] = await Promise.all([
        healthRecordsApi.list({ per_page: 200 }),
        healthRecordsApi.options(),
      ]);

      setRecords(recordsRes ?? []);
      setOutcomes(optionsRes?.outcomes ?? []);

      // The picker is only needed by someone who can author a record.
      if (canAuthor) {
        setBeneficiaries((await beneficiariesApi.list({ per_page: 200 })) ?? []);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [canAuthor]);

  useEffect(() => {
    load();
  }, [load]);

  async function confirmDelete() {
    if (!deleting) return;

    setRemoving(true);
    setError(null);

    try {
      await healthRecordsApi.remove(deleting.id);
      const removed = deleting;
      setDeleting(null);
      await load();

      // Set after load() so the refresh does not clear the message.
      setNotice(`Deleted the record for ${removed.name_of_farmer}.`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRemoving(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(record) {
    setEditing(record);
    setFormOpen(true);
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{config?.label ?? "Veterinarian"}</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Health Records
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Diagnoses and treatments recorded by the attending veterinarian.
              These are clinical entries and are kept separate from the monthly
              monitoring report.
            </p>
          </div>

          {canAuthor && (
            <button type="button" onClick={openCreate} className="btn-primary">
              <Icon name="medical-cross" className="h-4 w-4" />
              New record
            </button>
          )}
        </div>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}
      {notice && (
        <InlineAlert tone="success" message={notice} onDismiss={() => setNotice(null)} />
      )}

      <section className="card overflow-hidden">
        {loading ? (
          <SkeletonList rows={4} />
        ) : records.length === 0 ? (
          <EmptyState
            title="No health records yet"
            description={
              canAuthor
                ? "Records you author appear here, and are visible to the farmer and the assigned technician."
                : "Health records appear here once a veterinarian has examined an animal."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Date</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Farmer</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Animal</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Diagnosis</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Outcome</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Attending vet</th>
                  {(canAuthor || user?.role === "admin") && (
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((record) => (
                  <tr key={record.id} className="transition hover:bg-brand-50/40">
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                      {formatDate(record.date_recorded)}
                    </td>
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap text-slate-900">
                      {record.name_of_farmer}
                      <span className="block text-[11px] font-normal text-slate-500">
                        {record.address}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                      {record.animal_type}
                      {record.sex ? ` (${record.sex})` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {record.diagnosis}
                      {record.treatment && (
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          {record.treatment}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {record.outcome ? (
                        <span
                          className={`rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${
                            OUTCOME_TONES[record.outcome] ?? OUTCOME_TONES.referred
                          }`}
                        >
                          {outcomeLabel(record.outcome)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">Open</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                      {record.doctor?.name ?? "—"}
                    </td>
                    {(canAuthor || user?.role === "admin") && (
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {canModify(record) ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openEdit(record)}
                              className="rounded-pill px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleting(record)}
                              className="rounded-pill px-3 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <HealthRecordFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        beneficiaries={beneficiaries}
        outcomes={outcomes}
        record={editing}
        onSaved={() => setNotice(editing ? "Health record updated." : "Health record saved.")}
      />

      <Modal
        open={deleting !== null}
        title="Delete health record"
        onClose={() => setDeleting(null)}
      >
        <p className="text-sm text-slate-600">
          Delete the record for <strong>{deleting?.name_of_farmer}</strong> dated{" "}
          {formatDate(deleting?.date_recorded)}? This removes the diagnosis from the
          animal's history and cannot be undone.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setDeleting(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={confirmDelete}
            disabled={removing}
          >
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
