import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fieldVisitsApi } from "../api/fieldVisitsApi";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { FieldVisitFormModal, purposeLabel } from "../components/FieldVisitFormModal";
import { Modal } from "../components/Modal";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { QrScanner } from "../components/QrScanner";
import { Icon } from "../components/Icons";
import { SelectAllCheckbox } from "../components/SelectAllCheckbox";
import { BulkActionBar } from "../components/BulkActionBar";
import { useRowSelection } from "../hooks/useRowSelection";
import { useAuth } from "../context/AuthContext";
import { getRole } from "../config/roles";
import { lookupScannedAnimal } from "../lib/scanLookup";

/**
 * Technician "Field Visits" screen.
 *
 * The trip log: where the technician went, when, why, and the GPS fix captured
 * on site. Separate from Monitoring Records, which holds what was observed
 * about the animal — a visit that found nobody home is still a visit.
 *
 * Read/write access is decided server-side (FieldVisitService + Policy); the
 * controls below mirror FieldVisitPolicy so the UI never offers an action the
 * API will refuse.
 */

/** 1200 m → "1.2 km" — distance is easier to triage in km once it is large. */
function distanceText(metres) {
  if (metres === null || metres === undefined) return null;
  if (metres < 1000) return `${metres} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export default function FieldVisitsPage({ roleKey = "technician" }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const config = getRole(roleKey);

  const [visits, setVisits] = useState([]);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [purposes, setPurposes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Row selection for the bulk (select-all) delete.
  const { selected, toggle, toggleAll, clear } = useRowSelection();

  // Mirrors FieldVisitPolicy::create — only a field technician logs a trip.
  const canLog = user?.role === "technician";

  // Staff who may scan an animal to open its record. The lookup is still
  // scoped server-side, so this only decides whether to show the button.
  const canScan = ["admin", "doctor", "technician"].includes(user?.role);

  // Mirrors FieldVisitPolicy::update — the technician who went, or an admin.
  const canModify = (visit) =>
    user?.role === "admin" ||
    (user?.role === "technician" && visit.technician_id === user?.id);

  // Only visits this user may delete are selectable.
  const deletableIds = visits.filter(canModify).map((visit) => visit.id);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const [visitsRes, optionsRes] = await Promise.all([
        fieldVisitsApi.list({ per_page: 200 }),
        fieldVisitsApi.options(),
      ]);

      setVisits(visitsRes ?? []);
      setPurposes(optionsRes?.purposes ?? []);

      // The picker is only needed by someone who can log a trip.
      if (canLog) {
        setBeneficiaries((await beneficiariesApi.list({ per_page: 200 })) ?? []);
      }
    } catch (err) {
      if (!quiet) setError(getErrorMessage(err));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [canLog]);

  useEffect(() => {
    load();
  }, [load]);

  // Quietly re-fetch so visits logged elsewhere appear without a manual reload.
  useAutoRefresh(load);

  async function confirmDelete() {
    if (!deleting) return;

    setRemoving(true);
    setError(null);

    try {
      await fieldVisitsApi.remove(deleting.id);
      const removed = deleting;
      setDeleting(null);
      await load();

      // Set after load() so the refresh does not clear the message.
      setNotice(`Deleted the visit to ${removed.name_of_farmer}.`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRemoving(false);
    }
  }

  async function confirmBulkDelete() {
    if (selected.size === 0) return;

    setBulkBusy(true);
    setError(null);

    try {
      const result = await fieldVisitsApi.bulkRemove([...selected]);
      const failed = result?.failed_ids?.length ?? 0;

      setBulkOpen(false);
      clear();
      await load();

      setNotice(
        failed > 0
          ? `Deleted ${result.deleted} of ${result.deleted + failed} visits; ${failed} could not be deleted.`
          : `Deleted ${result.deleted} ${result.deleted === 1 ? "visit" : "visits"}.`,
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBulkBusy(false);
    }
  }

  /**
   * Resolve a scanned (or typed) tag to an animal and open its history. The
   * lookup is policy-scoped, so an unassigned animal is refused here exactly
   * as browsing to it would be.
   */
  async function handleScan(rawValue) {
    setScanOpen(false);
    setNotice(null);
    setError(null);

    const result = await lookupScannedAnimal(rawValue);

    if (result.status === "ok") {
      navigate(`/dashboard/${roleKey}/beneficiaries/${result.id}/lineage`);
      return;
    }

    if (result.status === "forbidden") {
      setError(
        "That animal belongs to a farmer who isn't assigned to you, so its record can't be opened.",
      );
      return;
    }

    if (result.status === "notfound") {
      setError("No animal matches that code.");
      return;
    }

    if (result.status === "invalid") {
      setError("That QR code isn't a CVO animal tag.");
      return;
    }

    setError(result.message ?? "Could not look up that animal.");
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{config?.label ?? "Field Technician"}</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Field Visits
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Every trip out — the farm visited, the date, why you went, and the
              GPS position captured on site. What you observed about the animal
              goes in Monitoring Records.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canScan && (
              <button
                type="button"
                onClick={() => setScanOpen(true)}
                className="btn-secondary"
              >
                <Icon name="qr" className="h-4 w-4" />
                Scan ear tag
              </button>
            )}

            {canLog && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                className="btn-primary"
              >
                <Icon name="route" className="h-4 w-4" />
                Log a Field Visit
              </button>
            )}
          </div>
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

      <section className="card overflow-hidden">
        {loading ? (
          <SkeletonList rows={4} />
        ) : visits.length === 0 && canLog && beneficiaries.length === 0 ? (
          // A technician with zero assigned households: an explicit boundary
          // message, not the generic "no visits yet".
          <EmptyState
            title="No farmers assigned to you yet"
            description="You haven't been assigned any farmers. Contact an administrator to be assigned households to visit."
          />
        ) : visits.length === 0 ? (
          <EmptyState
            title="No field visits yet"
            description={
              canLog
                ? "Log a visit after each trip out — even one that found nobody home."
                : "Visits appear here once the field team logs them."
            }
          />
        ) : (
          <>
          <BulkActionBar
            count={selected.size}
            noun="visit"
            onClear={clear}
            onDelete={() => setBulkOpen(true)}
            busy={bulkBusy}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-xs">
              <colgroup>
                <col className="w-10" />
                <col className="w-[10%]" />
                <col className="w-[20%]" />
                <col className="w-[12%]" />
                <col className="w-[10%]" />
                <col className="w-[14%]" />
                <col className="w-[18%]" />
                <col className="w-[10%]" />
                <col />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                  {deletableIds.length > 0 && (
                    <th scope="col" className="w-10 px-4 py-2.5">
                      <SelectAllCheckbox
                        ids={deletableIds}
                        selected={selected}
                        onToggleAll={toggleAll}
                        label="Select all field visits you can delete"
                      />
                    </th>
                  )}
                  <th scope="col" className="px-4 py-2.5 font-semibold">Date</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Farmer</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Animal</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Photo</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Purpose</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">On-site location</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Technician</th>
                  {(canLog || user?.role === "admin") && (
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visits.map((visit) => {
                  const drift = distanceText(visit.distance_from_registered_m);

                  return (
                    <tr key={visit.id} className="transition hover:bg-brand-50/40">
                      {deletableIds.length > 0 && (
                        <td className="px-4 py-2.5">
                          {canModify(visit) ? (
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded accent-brand-700"
                              aria-label={`Select visit to ${visit.name_of_farmer}`}
                              checked={selected.has(visit.id)}
                              onChange={() => toggle(visit.id)}
                            />
                          ) : null}
                        </td>
                      )}
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {formatDate(visit.visited_on)}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        <span className="block truncate">{visit.name_of_farmer}</span>
                        <span className="block truncate text-[11px] font-normal text-slate-500">
                          {visit.address}
                        </span>
                      </td>
                      <td className="truncate px-4 py-2.5 text-slate-600">
                        {visit.animal_type}
                        {visit.sex ? ` (${visit.sex})` : ""}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {visit.photo ? (
                          <a
                            href={visit.photo.image_url}
                            target="_blank"
                            rel="noreferrer"
                            title="View geotagged photo"
                            className="inline-flex items-center gap-1 font-medium text-brand-800 transition hover:text-brand-600 hover:underline"
                          >
                            <Icon name="map-pin" className="h-3.5 w-3.5" />
                            View photo
                          </a>
                        ) : (
                          <span className="text-slate-400">None</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
                          {purposeLabel(visit.purpose)}
                        </span>
                        {visit.notes && (
                          <span className="mt-1 block max-w-xs text-[11px] text-slate-500">
                            {visit.notes}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {visit.has_location ? (
                          <>
                            <span className="inline-flex items-center gap-1 font-medium text-slate-900">
                              <Icon name="locate-fixed" className="h-3.5 w-3.5 text-brand-700" />
                              Captured
                            </span>
                            {drift && (
                              <span className="mt-0.5 block text-[11px] text-slate-500">
                                {drift} from the registered pin
                              </span>
                            )}
                          </>
                        ) : (
                          // Say so rather than leaving a blank the reader has
                          // to interpret.
                          <span className="text-slate-400">Not captured</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {visit.technician?.name ?? "—"}
                      </td>
                      {(canLog || user?.role === "admin") && (
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {canModify(visit) ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditing(visit);
                                  setFormOpen(true);
                                }}
                                className="rounded-pill px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleting(visit)}
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
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

      <FieldVisitFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        beneficiaries={beneficiaries}
        purposes={purposes}
        visit={editing}
        onSaved={async () => {
          // Re-fetch immediately after a save: waiting for the 30s
          // auto-refresh tick is why a freshly logged visit looked like it
          // never appeared. Quiet, so the table updates in place instead of
          // flashing back to a skeleton.
          await load(true);
          setNotice(editing ? "Field visit updated." : "Field visit logged.");
        }}
      />

      <Modal open={deleting !== null} title="Delete field visit" onClose={() => setDeleting(null)}>
        <p className="text-sm text-slate-600">
          Delete the visit to <strong>{deleting?.name_of_farmer}</strong> on{" "}
          {formatDate(deleting?.visited_on)}? This removes it from the field log and
          cannot be undone.
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
              "Delete visit"
            )}
          </button>
        </div>
      </Modal>

      <Modal
        open={bulkOpen}
        title={`Delete ${selected.size} ${selected.size === 1 ? "field visit" : "field visits"}`}
        onClose={() => setBulkOpen(false)}
      >
        <p className="text-sm text-slate-600">
          Delete <strong>{selected.size}</strong> selected field visit
          {selected.size === 1 ? "" : "s"}? This removes them from the field log
          and cannot be undone.
        </p>

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

      <QrScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onResult={handleScan}
      />
    </div>
  );
}
