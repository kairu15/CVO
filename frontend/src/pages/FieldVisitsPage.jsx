import { useCallback, useEffect, useState } from "react";
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
import { Icon } from "../components/Icons";
import { useAuth } from "../context/AuthContext";
import { getRole } from "../config/roles";

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
  const config = getRole(roleKey);

  const [visits, setVisits] = useState([]);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [purposes, setPurposes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [removing, setRemoving] = useState(false);

  // Mirrors FieldVisitPolicy::create — only a field technician logs a trip.
  const canLog = user?.role === "technician";

  // Mirrors FieldVisitPolicy::update — the technician who went, or an admin.
  const canModify = (visit) =>
    user?.role === "admin" ||
    (user?.role === "technician" && visit.technician_id === user?.id);

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
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}
      {notice && (
        <InlineAlert tone="success" message={notice} onDismiss={() => setNotice(null)} />
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-xs">
              <colgroup>
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
        )}
      </section>

      <FieldVisitFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        beneficiaries={beneficiaries}
        purposes={purposes}
        visit={editing}
        onSaved={() => setNotice(editing ? "Field visit updated." : "Field visit logged.")}
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
    </div>
  );
}
