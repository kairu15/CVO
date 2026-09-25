import { Link } from "react-router-dom";
import { Modal } from "./Modal";
import { Icon } from "./Icons";

/**
 * Floating details window for one beneficiary — opened by clicking the
 * farmer's name in the admin directory.
 *
 * Renders from the row the list already loaded (the admin endpoint includes
 * technician, farmer account, coordinates and location_source), so opening
 * it never fires another request. Wraps the shared Modal for the overlay,
 * Escape handling and scroll lock.
 *
 * @param {object} props
 * @param {object|null} props.beneficiary the clicked row, or null (closed)
 * @param {() => void} props.onClose
 * @param {(id: number|null) => string} [props.technicianName] fallback
 *   resolver for the technician name from the page's own list
 */
export function BeneficiaryDetailModal({ beneficiary, onClose, technicianName }) {
  if (!beneficiary) return null;

  const sourceLabels = {
    gps: "GPS fix",
    map_pin: "Map pin",
    manual: "Manual entry",
  };

  const pairs = [
    ["Name of farmer", beneficiary.name_of_farmer],
    ["Address (barangay)", beneficiary.address],
    ["Type of animal", beneficiary.animal_type],
    [
      "Sex",
      beneficiary.sex === "M" ? "Male" : beneficiary.sex === "F" ? "Female" : beneficiary.sex,
    ],
    [
      "Farmer account",
      beneficiary.farmer?.email ?? beneficiary.farmer?.name ?? null,
    ],
    [
      "Assigned technician",
      beneficiary.technician_id
        ? (beneficiary.technician?.name ?? technicianName?.(beneficiary.technician_id) ?? null)
        : "Unassigned",
    ],
    ["Monitoring records", String(beneficiary.monitoring_records_count ?? 0)],
    ["Location captured by", sourceLabels[beneficiary.location_source] ?? null],
    [
      "Coordinates",
      beneficiary.latitude != null && beneficiary.longitude != null
        ? `${beneficiary.latitude}, ${beneficiary.longitude}`
        : null,
    ],
    ["Registered", beneficiary.created_at ? beneficiary.created_at.slice(0, 10) : null],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");

  return (
    <Modal
      open
      title="Beneficiary details"
      onClose={onClose}
    >
      <p className="-mt-2 text-xs text-slate-500">
        Everything on this record was captured at registration and is read-only
        here; monitoring records fill it in over time.
      </p>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {pairs.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="mt-0.5 font-semibold text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        {beneficiary.id ? (
          <Link
            to={`/dashboard/admin/beneficiaries/${beneficiary.id}/lineage`}
            className="btn-secondary !px-3.5 !py-1.5 text-xs"
          >
            <Icon name="route" className="h-3.5 w-3.5" />
            View dispersal lineage
          </Link>
        ) : (
          <span />
        )}
        <button type="button" className="btn-primary !px-3.5 !py-1.5 text-xs" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
