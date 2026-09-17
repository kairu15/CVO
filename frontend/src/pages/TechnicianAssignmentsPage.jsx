import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "../api/adminApi";
import { getErrorMessage } from "../api/client";
import { Modal } from "../components/Modal";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";

/**
 * Admin "Technicians" screen.
 *
 * Lists every account holding the technician role with the beneficiaries
 * currently assigned to each, and offers reassignment per beneficiary.
 * Assignment changes are enforced server-side; this is the control surface.
 */
export default function TechnicianAssignmentsPage() {
  const [technicians, setTechnicians] = useState([]);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [assignFor, setAssignFor] = useState(null); // beneficiary being (re)assigned
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [usersRes, beneficiariesRes] = await Promise.all([
        adminApi.listUsers({ role: "technician", per_page: 100 }),
        adminApi.listBeneficiaries({ per_page: 200 }),
      ]);

      setTechnicians(usersRes.data.data ?? []);
      setBeneficiaries(beneficiariesRes.data.data ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byTechnician = useMemo(() => {
    const map = new Map();
    for (const technician of technicians) map.set(technician.id, []);
    for (const beneficiary of beneficiaries) {
      if (beneficiary.technician_id && map.has(beneficiary.technician_id)) {
        map.get(beneficiary.technician_id).push(beneficiary);
      }
    }
    return map;
  }, [technicians, beneficiaries]);

  const unassigned = useMemo(
    () => beneficiaries.filter((b) => !b.technician_id),
    [beneficiaries],
  );

  async function saveAssignment() {
    if (!assignFor) return;

    setSaving(true);
    try {
      await adminApi.assignTechnician(assignFor.id, pick === "" ? null : Number(pick));
      setAssignFor(null);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <p className="eyebrow">User Management</p>
        <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
          Technicians
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Field technicians and the beneficiaries each one is responsible for. A
          technician only sees the beneficiaries assigned here.
        </p>
      </section>

      {error && (
        <div role="alert" className="card border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card space-y-3 p-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : technicians.length === 0 ? (
        <section className="card">
          <EmptyState
            title="No technicians yet"
            description="Create a user account, then use the role controls to promote it to Field Technician."
          />
        </section>
      ) : (
        <section className="grid gap-5 lg:grid-cols-2">
          {technicians.map((technician) => {
            const assigned = byTechnician.get(technician.id) ?? [];

            return (
              <article key={technician.id} className="card p-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
                    <Icon name="map-pin" className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-display text-sm font-semibold text-slate-900">
                      {technician.name}
                    </h3>
                    <p className="text-xs text-slate-500">{technician.email}</p>
                  </div>
                  <span className="ml-auto rounded-pill bg-brand-50 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-brand-800 uppercase">
                    {assigned.length} assigned
                  </span>
                </div>

                {assigned.length === 0 ? (
                  <p className="mt-4 rounded-xl bg-slate-50 px-3.5 py-3 text-xs text-slate-500">
                    No beneficiaries assigned yet.
                  </p>
                ) : (
                  <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100">
                    {assigned.map((beneficiary) => (
                      <li
                        key={beneficiary.id}
                        className="flex items-center gap-3 px-3.5 py-2.5 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">
                            {beneficiary.name_of_farmer}
                          </p>
                          <p className="truncate text-slate-500">
                            {beneficiary.animal_type} ({beneficiary.sex}) · {beneficiary.address}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setAssignFor(beneficiary);
                            setPick(String(technician.id));
                          }}
                          className="ml-auto shrink-0 rounded-pill px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100"
                        >
                          Reassign
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </section>
      )}

      {unassigned.length > 0 && (
        <section className="card p-5">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Unassigned beneficiaries
            <span className="ml-2 rounded-pill bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700 uppercase ring-1 ring-amber-200">
              {unassigned.length}
            </span>
          </h3>
          <ul className="mt-3 divide-y divide-slate-100">
            {unassigned.map((beneficiary) => (
              <li key={beneficiary.id} className="flex items-center gap-3 py-2.5 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{beneficiary.name_of_farmer}</p>
                  <p className="truncate text-slate-500">
                    {beneficiary.animal_type} ({beneficiary.sex}) · {beneficiary.address}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAssignFor(beneficiary);
                    setPick("");
                  }}
                  className="ml-auto shrink-0 rounded-pill bg-brand-50 px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100"
                >
                  Assign technician
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal
        open={assignFor !== null}
        title={`Assign technician — ${assignFor?.name_of_farmer ?? ""}`}
        onClose={() => setAssignFor(null)}
      >
        <label htmlFor="assign-technician" className="block text-sm font-medium text-slate-700">
          Responsible technician
        </label>
        <select
          id="assign-technician"
          className="field mt-1.5"
          value={pick}
          onChange={(event) => setPick(event.target.value)}
        >
          <option value="">Unassigned (no technician)</option>
          {technicians.map((technician) => (
            <option key={technician.id} value={technician.id}>
              {technician.name}
            </option>
          ))}
        </select>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setAssignFor(null)}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={saveAssignment} disabled={saving}>
            {saving ? (
              <>
                <ButtonSpinner />
                Saving…
              </>
            ) : (
              "Save assignment"
            )}
          </button>
        </div>
      </Modal>
    </div>
  );
}
