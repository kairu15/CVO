import { useMemo, useState } from "react";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icons";
import { SkeletonList } from "./Skeleton";
import { PhotoLightbox } from "./PhotoLightbox";

/**
 * Table columns mirroring the CVO's Excel monitoring sheet, in order.
 *
 * The first four columns are the beneficiary identity fields — read-only
 * text for every role, since they come from the beneficiary record and are
 * never edited from this table.
 */
const COLUMNS = [
  { key: "name_of_farmer", label: "Name of Farmer" },
  { key: "address", label: "Address" },
  { key: "animal_type", label: "Type of Animal" },
  { key: "sex", label: "Sex" },
  { key: "date_monitored", label: "Date Monitored" },
  { key: "date_vits_supp", label: "Date of Vits Supp." },
  { key: "deworming_date", label: "Deworming" },
  { key: "vaccination_date", label: "Vaccination" },
  { key: "date_breed", label: "Date Breed" },
  { key: "date_calved", label: "Date Calved" },
  { key: "bcs", label: "BCS" },
  { key: "farmers_signature", label: "Farmer's Signature" },
  { key: "remarks", label: "Remarks" },
  // Admin oversight columns: who is assigned to this farmer, and when the
  // most recent geotagged visit photo was captured.
  { key: "assigned_technician", label: "Technician" },
  { key: "capture_timestamp", label: "Timestamp" },
];

/** Blank visit cells render as an em dash, never null/undefined/NaN. */
function cellValue(record, key) {
  const value = record[key];
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

/**
 * Capture date/time of a record's most recent field-visit photo, in the
 * same toLocale* style the rest of the app formats dates with. The server
 * ranks the photos; here we only render the structured stored fields.
 */
function captureTimestamp(photo) {
  if (!photo?.capture_date) return null;

  const date = new Date(
    `${photo.capture_date}T${photo.capture_time ?? "00:00:00"}`,
  );
  if (Number.isNaN(date.getTime())) return null;

  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/**
 * Livestock monitoring table, shared by all four dashboards.
 *
 * Rows come role-scoped from the API; this component only renders. Rows are
 * grouped by barangay (Address) with collapsible headers, matching how the
 * CVO organises one Excel sheet per barangay.
 *
 * @param {object} props
 * @param {Array<object>} props.records
 * @param {boolean} [props.loading]
 * @param {(record: object) => void} [props.onEdit] renders an actions column when given
 * @param {(record: object) => void} [props.onDelete] renders a Delete action beside Edit
 */
export function MonitoringTable({ records = [], loading = false, onEdit, onDelete }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [photoRecord, setPhotoRecord] = useState(null);

  const groups = useMemo(() => {
    const byBarangay = new Map();

    for (const record of records) {
      const key = record.address || "Unlisted address";
      if (!byBarangay.has(key)) byBarangay.set(key, []);
      byBarangay.get(key).push(record);
    }

    return [...byBarangay.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
  }, [records]);

  function toggle(barangay) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(barangay)) {
        next.delete(barangay);
      } else {
        next.add(barangay);
      }
      return next;
    });
  }

  if (loading) {
    return <SkeletonList rows={4} />;
  }

  if (records.length === 0) {
    return (
      <EmptyState
        title="No monitoring records yet"
        description="Once technicians log field visits, the monthly monitoring table will appear here — grouped per barangay like the CVO's Excel sheets."
      />
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      {groups.map(([barangay, rows]) => {
        const isCollapsed = collapsed.has(barangay);

        return (
          <section key={barangay}>
            <button
              type="button"
              onClick={() => toggle(barangay)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-2.5 bg-slate-50/60 px-4 py-3 text-left transition hover:bg-brand-50"
            >
              <Icon
                name="chevron-down"
                className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
              />
              <Icon name="map-pin" className="h-4 w-4 shrink-0 text-brand-700" />
              <span className="font-display text-sm font-semibold text-slate-900">
                {barangay}
              </span>
              <span className="rounded-pill bg-white px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase ring-1 ring-slate-200">
                {rows.length} {rows.length === 1 ? "record" : "records"}
              </span>
            </button>

            {!isCollapsed && (
              /* `relative` keeps the absolutely positioned `sr-only` label in
                 the actions header inside this scroll container. Without it the
                 label's containing block is the initial containing block, so it
                 escapes the overflow clip and lands far to the right, widening
                 the document — a page-level horizontal scrollbar even though
                 the table scrolls inside this wrapper. */
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[1240px] text-left text-xs">
                  {/* No fixed widths: columns auto-size to content so long
                     values widen the table (scrolling in the wrapper) rather
                     than overlapping the neighbouring cell. */}
                  <colgroup>
                    {COLUMNS.map((col) => (
                      <col key={col.key} />
                    ))}
                    {(onEdit || onDelete) && <col />}
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                      {COLUMNS.map((col) => (
                        <th key={col.key} scope="col" className="px-4 py-2.5 font-semibold whitespace-nowrap">
                          {col.label}
                        </th>
                      ))}
                      {(onEdit || onDelete) && (
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                          <span className="sr-only">Actions</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((record) => (
                      <tr key={record.id} className="transition hover:bg-brand-50/40">
                        {COLUMNS.map((col) => {
                          if (col.key === "assigned_technician") {
                            // Assigned via the admin's technician-farmer
                            // assignment — distinct from who logged the
                            // record. Unassigned is styled to stand out so
                            // gaps are visible at a glance.
                            const name = record.assigned_technician?.name;

                            return (
                              <td key={col.key} className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                                {name ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Icon name="map-pin" className="h-3 w-3 text-brand-700" />
                                    {name}
                                  </span>
                                ) : (
                                  <span className="italic text-slate-400">Unassigned</span>
                                )}
                              </td>
                            );
                          }

                          if (col.key === "capture_timestamp") {
                            const photo = record.latest_field_visit_photo;
                            const timestamp = captureTimestamp(photo);

                            return (
                              <td key={col.key} className="px-4 py-2.5 whitespace-nowrap">
                                {photo?.image_url ? (
                                  <button
                                    type="button"
                                    onClick={() => setPhotoRecord(record)}
                                    aria-label={`View full-size photo for ${record.name_of_farmer}`}
                                    title={timestamp ?? "View photo"}
                                    className="inline-flex items-center gap-2 rounded-lg transition hover:opacity-80"
                                  >
                                    <img
                                      src={photo.image_url}
                                      alt="Visit photo thumbnail"
                                      className="h-9 w-9 rounded-lg object-cover ring-1 ring-slate-200"
                                    />
                                    <span className="text-slate-600">{timestamp ?? "View photo"}</span>
                                  </button>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            );
                          }

                          return (
                            <td
                              key={col.key}
                              className={`px-4 py-2.5 whitespace-nowrap ${
                                col.key === "name_of_farmer"
                                  ? "font-medium text-slate-900"
                                  : "text-slate-600"
                              }`}
                            >
                              {cellValue(record, col.key)}
                            </td>
                          );
                        })}
                        {(onEdit || onDelete) && (
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {onEdit && (
                              <button
                                type="button"
                                onClick={() => onEdit(record)}
                                className="rounded-pill px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100"
                              >
                                Edit
                              </button>
                            )}
                            {onDelete && (
                              <button
                                type="button"
                                onClick={() => onDelete(record)}
                                className="rounded-pill px-3 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-50"
                              >
                                Delete
                              </button>
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
        );
      })}

      <PhotoLightbox
        open={photoRecord !== null}
        imageUrl={photoRecord?.latest_field_visit_photo?.image_url}
        alt={`Geotagged visit photo for ${photoRecord?.name_of_farmer ?? "farmer"}`}
        title={`Visit photo — ${photoRecord?.name_of_farmer ?? "farmer"}`}
        onClose={() => setPhotoRecord(null)}
        caption={
          photoRecord?.latest_field_visit_photo && (
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {captureTimestamp(photoRecord.latest_field_visit_photo) && (
                <span>
                  <strong className="font-semibold text-slate-800">Captured:</strong>{" "}
                  {captureTimestamp(photoRecord.latest_field_visit_photo)}
                </span>
              )}
              {photoRecord.latest_field_visit_photo.address && (
                <span>
                  <strong className="font-semibold text-slate-800">Address:</strong>{" "}
                  {photoRecord.latest_field_visit_photo.address}
                </span>
              )}
              {photoRecord.assigned_technician?.name && (
                <span>
                  <strong className="font-semibold text-slate-800">Technician:</strong>{" "}
                  {photoRecord.assigned_technician.name}
                </span>
              )}
            </div>
          )
        }
      />
    </div>
  );
}
