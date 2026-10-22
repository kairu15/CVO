import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "../api/adminApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { Modal } from "../components/Modal";
import { BeneficiaryDetailModal } from "../components/BeneficiaryDetailModal";
import { BeneficiaryFormModal } from "../components/BeneficiaryFormModal";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { Icon } from "../components/Icons";
import { SelectAllCheckbox } from "../components/SelectAllCheckbox";
import { BulkActionBar } from "../components/BulkActionBar";
import { PaginationFooter } from "../components/PaginationFooter";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useBarangays } from "../hooks/useBarangays";
import { useToast } from "../context/ToastContext";

/**
 * Admin "Beneficiaries" screen — the directory administrators enrol and
 * maintain, with per-row and bulk (per-barangay) technician assignment.
 *
 * Beneficiaries are program records, not accounts: "Add beneficiary" creates
 * the household (and its first monitoring record) with no login, no password
 * and no approval step. The search box is debounced (300ms) so typing does not
 * fire a request per keystroke, and bulk assignment is one transactional API
 * call whose partial failures are surfaced per row.
 */
export default function BeneficiariesPage() {
  const toast = useToast();
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [barangayFilter, setBarangayFilter] = useState("");

  // The add/edit dialog. `editing` null means "add" — the form then creates
  // the record and its monitoring row server-side.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [barangays] = useBarangays();

  const [selected, setSelected] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTechnician, setBulkTechnician] = useState("");
  const [saving, setSaving] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // The floating details window — the clicked row itself, so opening it
  // never fires another request (the list payload carries every field).

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const [beneficiariesRes, usersRes] = await Promise.all([
        adminApi.listBeneficiariesPage({
          per_page: 50,
          page,
          search: debouncedSearch || undefined,
          barangay: barangayFilter || undefined,
        }),
        adminApi.listUsers({ role: "technician", per_page: 50 }),
      ]);

      setBeneficiaries(beneficiariesRes?.data ?? []);
      setMeta(beneficiariesRes?.meta ?? null);
      setTechnicians(usersRes ?? []);
    } catch (err) {
      if (!quiet) setError(getErrorMessage(err));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [debouncedSearch, barangayFilter, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Quietly re-fetch so rows added elsewhere appear without a manual reload.
  useAutoRefresh(load);

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

  /** Global "Select all": tick every loaded beneficiary, or clear them all. */
  function toggleAll(ids) {
    setSelected((prev) => {
      if (ids.length === 0) return prev;

      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));

      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }

      return next;
    });
  }

  const [detail, setDetail] = useState(null);

  async function saveBulk() {
    setSaving(true);

    try {
      const technicianId = bulkTechnician === "" ? null : Number(bulkTechnician);
      const result = await adminApi.bulkAssignTechnician([...selected], technicianId);

      const failedIds = new Set(result?.failed_ids ?? []);

      setSelected(new Set());
      setBulkOpen(false);
      await load();

      // Action feedback is a global toast (fires after the refresh so it is
      // not cleared by it); page-level load failures stay inline.
      if (failedIds.size > 0) {
        const failedNames = beneficiaries
          .filter((b) => failedIds.has(b.id))
          .map((b) => b.name_of_farmer);
        toast.error(
          `Assigned ${result.updated} of ${result.updated + failedIds.size} beneficiaries, but ${failedIds.size} failed: ${failedNames.join(", ")}`,
        );
      } else {
        toast.success(
          `Technician assigned to ${result.updated} ${result.updated === 1 ? "beneficiary" : "beneficiaries"}.`,
        );
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Bulk delete the selected households. Admin-only server-side; each row
   * takes its whole history with it, same as the single delete, so the
   * confirmation spells that out before this runs.
   */
  async function confirmBulkDelete() {
    if (selected.size === 0) return;

    setBulkBusy(true);
    try {
      const result = await beneficiariesApi.bulkRemove([...selected]);
      const failed = result?.failed_ids?.length ?? 0;

      setBulkDeleteOpen(false);
      setSelected(new Set());
      await load();

      toast.success(
        failed > 0
          ? `Deleted ${result.deleted} of ${result.deleted + failed} beneficiaries; ${failed} could not be deleted.`
          : `Deleted ${result.deleted} ${result.deleted === 1 ? "beneficiary" : "beneficiaries"}.`,
      );
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBulkBusy(false);
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
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Icon name="plus" className="h-4 w-4" />
              Add beneficiary
            </button>
            {beneficiaries.length > 0 && (
              <label className="mr-1 flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
                <SelectAllCheckbox
                  ids={beneficiaries.map((beneficiary) => beneficiary.id)}
                  selected={selected}
                  onToggleAll={toggleAll}
                  label="Select all beneficiaries"
                />
                Select all
              </label>
            )}
            <select
              className="field w-full sm:w-44"
              value={barangayFilter}
              onChange={(event) => {
                setBarangayFilter(event.target.value);
                setSelected(new Set());
                setPage(1);
              }}
              aria-label="Filter by barangay"
            >
              <option value="">All barangays</option>
              {barangays.map((barangay) => (
                <option key={barangay.name} value={barangay.name}>
                  {barangay.name}
                </option>
              ))}
            </select>
            <div className="relative">
              <Icon name="search" className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search name, RSBSA #, barangay…"
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

      <BulkActionBar
        count={selected.size}
        noun="beneficiary"
        plural="beneficiaries"
        onClear={() => setSelected(new Set())}
        onDelete={() => setBulkDeleteOpen(true)}
        busy={bulkBusy}
      >
        <button
          type="button"
          className="rounded-pill bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => setBulkOpen(true)}
          disabled={bulkBusy}
        >
          Assign technician
        </button>
      </BulkActionBar>

      <section className="card overflow-hidden">
        {loading ? (
          <SkeletonList rows={4} />
        ) : beneficiaries.length === 0 ? (
          <EmptyState
            title="No beneficiaries yet"
            description="Beneficiaries appear here once an administrator enrols them."
          />
        ) : (
          <>
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

                {/* Shared widths nudge every barangay group's columns onto a
                    similar grid; columns still auto-size to content so long
                    values scroll the wrapper instead of overlapping. */}
                <table className="w-full text-left text-xs">
                  <colgroup>
                    <col className="w-10" />
                    <col className="w-[30%]" />
                    <col className="w-[18%]" />
                    <col className="w-[18%]" />
                    <col className="w-[8%]" />
                    <col />
                    <col className="w-20" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                      <th scope="col" className="px-4 py-2" />
                      <th scope="col" className="px-4 py-2.5 font-semibold">Name of Farmer</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">RSBSA #</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Animal</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Sex</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Technician</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Actions</th>
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
                        <td className="px-4 py-2.5 font-medium">
                          <button
                            type="button"
                            onClick={() => setDetail(beneficiary)}
                            title="View details"
                            className="text-slate-900 underline-offset-2 transition hover:text-brand-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                          >
                            {beneficiary.name_of_farmer}
                          </button>
                        </td>
                        <td className="truncate px-4 py-2.5 text-slate-600">
                          {beneficiary.rsbsa_number || <span className="text-slate-400">—</span>}
                        </td>
                        <td className="truncate px-4 py-2.5 text-slate-600">
                          {beneficiary.animal_type}
                          {beneficiary.animal_classification && (
                            <span className="block text-[10px] font-medium text-slate-500">
                              {beneficiary.animal_classification}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                          {beneficiary.sex}
                        </td>
                        <td className="truncate px-4 py-2.5 text-slate-600">
                          {beneficiary.technician_id
                            ? technicianName(beneficiary.technician_id)
                            : <span className="font-medium text-amber-700">Unassigned</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(beneficiary);
                              setFormOpen(true);
                            }}
                            className="text-xs font-semibold text-brand-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                            aria-label={`Edit ${beneficiary.name_of_farmer}`}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <PaginationFooter
            meta={meta}
            shown={beneficiaries.length}
            noun="beneficiary"
            plural="beneficiaries"
            onPageChange={setPage}
          />
          </>
        )}
      </section>

      <BeneficiaryDetailModal
        beneficiary={detail}
        onClose={() => setDetail(null)}
        technicianName={technicianName}
      />

      {/* Mounted only while open: the form pulls auth/offline context and the
          map picker, neither of which the directory itself needs. */}
      {formOpen && (
        <BeneficiaryFormModal
          open
          beneficiary={editing}
          onClose={() => setFormOpen(false)}
          onSaved={load}
        />
      )}

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

      <Modal
        open={bulkDeleteOpen}
        title={`Delete ${selected.size} selected ${selected.size === 1 ? "beneficiary" : "beneficiaries"}`}
        onClose={() => setBulkDeleteOpen(false)}
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            This removes <strong>{selected.size}</strong> selected
            household{selected.size === 1 ? "" : "s"} and all associated records —
            monitoring history, health records, case notes, field visits, visit
            photos, technician assignments and notifications.
          </p>
          <p>
            The records are archived (not erased) for the office's audit and
            retention, and can only be restored by a database administrator.
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setBulkDeleteOpen(false)}>
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
