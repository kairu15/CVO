import { useMemo, useState } from "react";
import { ButtonSpinner } from "./LoadingSpinner";
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
  // The farmer-level registry ID, directly beside the name it belongs to.
  { key: "rsbsa_number", label: "RSBSA #" },
  { key: "address", label: "Address" },
  { key: "animal_type", label: "Type of Animal" },
  // The sex/age class within the type (Boar, Sow, Layer…). Nullable: older
  // records only ever recorded the coarse type.
  { key: "animal_classification", label: "Classification" },
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
  // The dispersal agreement (togglable by an admin) and the animal's
  // human-readable physical tag number, both beside Remarks.
  { key: "moa_signed", label: "MOA" },
  { key: "ear_tag_number", label: "Ear Tag #" },
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
 * The dispersal's signed-MOA badge: green "Yes", amber "No", and a muted
 * "Not on file" when nothing has been recorded yet — never a raw boolean,
 * matching the role pills used elsewhere in the system.
 */
function MoaBadge({ signed }) {
  if (signed === true) {
    return (
      <span className="inline-flex items-center rounded-pill bg-brand-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-brand-800 uppercase ring-1 ring-brand-500/30">
        Yes
      </span>
    );
  }

  if (signed === false) {
    return (
      <span className="inline-flex items-center rounded-pill bg-amber-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-800 uppercase ring-1 ring-amber-500/30">
        No
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-pill bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase ring-1 ring-slate-200 dark:bg-slate-200/60 dark:ring-slate-300/40">
      Not on file
    </span>
  );
}

/**
 * MOA cell. Read-only viewers get just the badge; an admin (when
 * `onToggleMoa` is supplied) also gets a switch they can click to flip the
 * dispersal's status without opening the edit form. A brief spinner replaces
 * the badge while the inline save is in flight.
 */
function MoaCell({ record, editable, busy, onToggle }) {
  if (!editable) {
    return <MoaBadge signed={record.moa_signed} />;
  }

  const checked = record.moa_signed === true;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`Toggle MOA status for ${record.name_of_farmer}`}
        disabled={busy}
        onClick={() => onToggle(record)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
          checked ? "bg-brand-600" : "bg-slate-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
      {busy ? (
        <ButtonSpinner className="h-3.5 w-3.5 border-brand-700/30 border-t-brand-700" />
      ) : (
        <MoaBadge signed={record.moa_signed} />
      )}
    </span>
  );
}

/**
 * Livestock monitoring table, shared by every dashboard.
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
 * @param {{title: string, description: string}} [props.emptyState] replaces the
 *   default "no records yet" empty state when the caller knows a more specific
 *   reason the table is empty (e.g. a month tab with no records)
 * @param {Set<number|string>} [props.selected] selected record ids; when
 *   `onToggleRow` is also given, a checkbox column is rendered
 * @param {(record: object) => void} [props.onToggleRow] toggles one row's
 *   selection — enables the checkbox column
 * @param {"address"|"animal_type"} [props.groupBy] which field the rows are
 *   grouped under. The server orders the page (by date, or by animal type
 *   when the caller asks), so this only decides the section headers.
 * @param {number|string|null} [props.highlightBeneficiaryId] tints the rows
 *   belonging to one beneficiary — the "you arrived from this notification"
 *   flash. The caller clears it after a moment, so the tint fades out.
 * @param {(record: object) => void} [props.onToggleMoa] renders the inline
 *   MOA switch; omitted for roles that may see the status but not change it
 * @param {number|string|null} [props.moaBusyId] id of the record whose inline
 *   MOA save is in flight — the switch is disabled and shows a spinner
 */
export function MonitoringTable({
  records = [],
  loading = false,
  onEdit,
  onDelete,
  emptyState,
  selected,
  onToggleRow,
  groupBy = "address",
  highlightBeneficiaryId = null,
  onToggleMoa,
  moaBusyId = null,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [photoRecord, setPhotoRecord] = useState(null);

  const hasSelection = Boolean(onToggleRow);
  const hasActions = Boolean(onEdit || onDelete);

  const groups = useMemo(() => {
    const byBarangay = new Map();

    for (const record of records) {
      const key =
        groupBy === "animal_type"
          ? record.animal_type || "Unspecified"
          : record.address || "Unlisted address";
      if (!byBarangay.has(key)) byBarangay.set(key, []);
      byBarangay.get(key).push(record);
    }

    return [...byBarangay.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
  }, [records, groupBy]);

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
        title={emptyState?.title ?? "No monitoring records yet"}
        description={
          emptyState?.description ??
          "Once technicians log field visits, the monthly monitoring table will appear here — grouped per barangay like the CVO's Excel sheets."
        }
      />
    );
  }

  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-200/60">
      {groups.map(([barangay, rows]) => {
        const isCollapsed = collapsed.has(barangay);

        return (
          <section key={barangay}>
            <button
              type="button"
              onClick={() => toggle(barangay)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-2.5 bg-slate-50/60 px-4 py-3 text-left transition hover:bg-brand-50 dark:bg-slate-100/40 dark:hover:bg-brand-100/50"
            >
              <Icon
                name="chevron-down"
                className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
              />
              <Icon
                name={groupBy === "animal_type" ? "livestock" : "map-pin"}
                className="h-4 w-4 shrink-0 text-brand-700"
              />
              <span className="font-display text-sm font-semibold text-slate-900">
                {barangay}
              </span>
              <span className="rounded-pill bg-white px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase ring-1 ring-slate-200 dark:bg-white/70 dark:ring-slate-300/40">
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
                    {hasSelection && <col className="w-10" />}
                    {COLUMNS.map((col) => (
                      <col key={col.key} />
                    ))}
                    {hasActions && <col />}
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                      {hasSelection && (
                        <th scope="col" className="w-10 px-4 py-2.5">
                          <span className="sr-only">Select</span>
                        </th>
                      )}
                      {COLUMNS.map((col) => (
                        <th key={col.key} scope="col" className="px-4 py-2.5 font-semibold whitespace-nowrap">
                          {col.label}
                        </th>
                      ))}
                      {hasActions && (
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                          <span className="sr-only">Actions</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-200/60">
                    {rows.map((record) => {
                      // Arrived-from-a-notification flash: a light sky tint
                      // that fades back once the caller clears the id.
                      const isHighlighted =
                        highlightBeneficiaryId !== null &&
                        highlightBeneficiaryId !== undefined &&
                        record.beneficiary_id === highlightBeneficiaryId;

                      return (
                      <tr
                        key={record.id}
                        className={`transition-colors duration-700 hover:bg-brand-50/60 dark:hover:bg-brand-100/40 ${
                          isHighlighted ? "bg-sky-50 dark:bg-sky-100/60" : ""
                        }`}
                      >
                        {hasSelection && (
                          <td className="px-4 py-2.5">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded accent-brand-700"
                              aria-label={`Select ${record.name_of_farmer}`}
                              checked={selected?.has(record.id) ?? false}
                              onChange={() => onToggleRow(record)}
                            />
                          </td>
                        )}
                        {COLUMNS.map((col) => {
                          if (col.key === "name_of_farmer") {
                            return (
                              <td key={col.key} className="px-4 py-2.5 whitespace-nowrap">
                                <span className="font-medium text-slate-900">
                                  {cellValue(record, col.key)}
                                </span>
                              </td>
                            );
                          }

                          if (col.key === "moa_signed") {
                            return (
                              <td key={col.key} className="px-4 py-2.5 whitespace-nowrap">
                                <MoaCell
                                  record={record}
                                  editable={Boolean(onToggleMoa)}
                                  busy={moaBusyId === record.id}
                                  onToggle={onToggleMoa}
                                />
                              </td>
                            );
                          }

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
                                      className="h-9 w-9 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-300/40"
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
                        {hasActions && (
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
                                className="rounded-pill px-3 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-50 dark:hover:bg-red-100/70"
                              >
                                Delete
                              </button>
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
        );
      })}

      <PhotoLightbox
        open={photoRecord !== null}
        imageUrl={photoRecord?.latest_field_visit_photo?.image_url}
        alt={`Geotagged visit photo for ${photoRecord?.name_of_farmer ?? "beneficiary"}`}
        title={`Visit photo — ${photoRecord?.name_of_farmer ?? "beneficiary"}`}
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
