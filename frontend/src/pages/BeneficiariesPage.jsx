import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "../api/adminApi";
import { getErrorMessage } from "../api/client";
import { Modal } from "../components/Modal";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { InlineAlert } from "../components/InlineAlert";
import { Icon } from "../components/Icons";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

/**
 * Admin "Beneficiaries" screen — the full directory with per-row and bulk
 * (per-barangay) technician assignment.
 *
 * The search box is debounced (300ms) so typing does not fire a request per
 * keystroke, and bulk assignment is one transactional API call whose
 * partial failures are surfaced per row.
 */
export default function BeneficiariesPage() {
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const [selected, setSelected] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTechnician, setBulkTechnician] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [beneficiariesRes, usersRes] = await Promise.all([
        adminApi.listBeneficiaries({
          per_page: 200,
          search: debouncedSearch || undefined,
        }),
        adminApi.listUsers({ role: "technician", per_page: 100 }),
      ]);

      setBeneficiaries(beneficiariesRes ?? []);
      setTechnicians(usersRes ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const beneficiary of beneficiaries) {
      if (!map.has(beneficiary.address)) map.set(beneficiary.address, []);
      map.get(beneficiary.address).push(beneficiary);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [beneficiaries]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleBarangay(rows) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = rows.every((row) => next.has(row.id));
      for (const row of rows) {
        if (allSelected) {
          next.delete(row.id);
        } else {
          next.add(row.id);
        }
      }
      return next;
    });
  }

  async function saveBulk() {
    setSaving(true);
    setError(null);

    try {
      const technicianId = bulkTechnician === "" ? null : Number(bulkTechnician);
      const result = await adminApi.bulkAssignTechnician([...selected], technicianId);

      const failedIds = new Set(result?.failed_ids ?? []);
      let partialMessage = null;

      if (failedIds.size > 0) {
        const failedNames = beneficiaries
          .filter((b) => failedIds.has(b.id))
          .map((b) => b.name_of_farmer);
        partialMessage = `Assigned ${result.updated} of ${result.updated + failedIds.size} beneficiaries, but ${failedIds.size} failed: ${failedNames.join(", ")}`;
      }

      setSelected(new Set());
      setBulkOpen(false);
      await load();

      // Set after load() so the refresh does not clear the message.
      if (partialMessage) setError(partialMessage);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const technicianName = (id) =>
    technicians.find((t) => t.id === id)?.name ?? "—";

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Beneficiary Records</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Beneficiaries
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Every dispersed animal registered with the program. Assign a
              technician per beneficiary or select a whole barangay for bulk
              assignment.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Icon name="search" className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search farmer or barangay…"
                className="field w-64 pl-9"
                aria-label="Search beneficiaries"
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={selected.size === 0}
              onClick={() => setBulkOpen(true)}
            >
              Assign ({selected.size})
            </button>
          </div>
        </div>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}

      <section className="card overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : beneficiaries.length === 0 ? (
          <EmptyState
            title="No beneficiaries yet"
            description="Beneficiaries appear here when farmers register their dispersed animals."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {grouped.map(([barangay, rows]) => (
              <div key={barangay}>
                <div className="flex items-center gap-3 bg-slate-50/60 px-4 py-2.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded accent-brand-700"
                    aria-label={`Select all in ${barangay}`}
                    checked={rows.every((row) => selected.has(row.id))}
                    onChange={() => toggleBarangay(rows)}
                  />
                  <Icon name="map-pin" className="h-4 w-4 text-brand-700" />
                  <span className="font-display text-sm font-semibold text-slate-900">
                    {barangay}
                  </span>
                  <span className="rounded-pill bg-white px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase ring-1 ring-slate-200">
                    {rows.length}
                  </span>
                </div>

                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                      <th scope="col" className="w-10 px-4 py-2" />
                      <th scope="col" className="px-4 py-2.5 font-semibold">Name of Farmer</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Animal</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Sex</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Technician</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((beneficiary) => (
                      <tr key={beneficiary.id} className="transition hover:bg-brand-50/40">
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded accent-brand-700"
                            aria-label={`Select ${beneficiary.name_of_farmer}`}
                            checked={selected.has(beneficiary.id)}
                            onChange={() => toggle(beneficiary.id)}
                          />
                        </td>
                        <td className="px-4 py-2.5 font-medium whitespace-nowrap text-slate-900">
                          {beneficiary.name_of_farmer}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                          {beneficiary.animal_type}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                          {beneficiary.sex}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                          {beneficiary.technician_id
                            ? technicianName(beneficiary.technician_id)
                            : <span className="font-medium text-amber-700">Unassigned</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={bulkOpen}
        title={`Assign technician to ${selected.size} ${selected.size === 1 ? "beneficiary" : "beneficiaries"}`}
        onClose={() => setBulkOpen(false)}
      >
        <label htmlFor="bulk-technician" className="block text-sm font-medium text-slate-700">
          Technician
        </label>
        <select
          id="bulk-technician"
          className="field mt-1.5"
          value={bulkTechnician}
          onChange={(event) => setBulkTechnician(event.target.value)}
        >
          <option value="">Unassigned (clear assignment)</option>
          {technicians.map((technician) => (
            <option key={technician.id} value={technician.id}>
              {technician.name}
            </option>
          ))}
        </select>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setBulkOpen(false)}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={saveBulk} disabled={saving}>
            {saving ? (
              <>
                <ButtonSpinner />
                Saving…
              </>
            ) : (
              "Apply"
            )}
          </button>
        </div>
      </Modal>
    </div>
  );
}
