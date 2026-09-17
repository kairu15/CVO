import { useMemo, useState } from "react";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icons";

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
];

/** Blank visit cells render as an em dash, never null/undefined/NaN. */
function cellValue(record, key) {
  const value = record[key];
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
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
 */
export function MonitoringTable({ records = [], loading = false, onEdit }) {
  const [collapsed, setCollapsed] = useState(() => new Set());

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
    return (
      <div className="space-y-3 p-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>
    );
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                      {COLUMNS.map((col) => (
                        <th key={col.key} scope="col" className="px-4 py-2.5 font-semibold whitespace-nowrap">
                          {col.label}
                        </th>
                      ))}
                      {onEdit && (
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                          <span className="sr-only">Actions</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((record) => (
                      <tr key={record.id} className="transition hover:bg-brand-50/40">
                        {COLUMNS.map((col) => (
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
                        ))}
                        {onEdit && (
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => onEdit(record)}
                              className="rounded-pill px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100"
                            >
                              Edit
                            </button>
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
    </div>
  );
}
