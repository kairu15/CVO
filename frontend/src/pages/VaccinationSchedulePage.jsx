import { useCallback, useEffect, useState } from "react";
import { vaccinationApi } from "../api/vaccinationApi";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { Icon } from "../components/Icons";
import { getRole } from "../config/roles";

/**
 * Doctor "Vaccination Schedule" screen.
 *
 * Read-only and derived: next-due is computed server-side from the last
 * vaccination recorded on the animal's monitoring records, so there is no
 * create/edit form here. Recording a vaccination means logging a visit, which
 * is what makes the schedule move.
 *
 * The status filter is sent to the API rather than applied to the loaded rows —
 * filtering a single page of results client-side would silently claim there is
 * nothing overdue when the overdue animals simply sat on page two.
 */

const FILTERS = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "due-soon", label: "Due soon" },
  { value: "scheduled", label: "Scheduled" },
  { value: "never", label: "Never vaccinated" },
];

const STATUS_TONES = {
  overdue: "bg-red-50 text-red-700",
  "due-soon": "bg-amber-50 text-amber-800",
  scheduled: "bg-brand-100 text-brand-900",
  never: "bg-slate-100 text-slate-600",
};

const STATUS_LABELS = {
  overdue: "Overdue",
  "due-soon": "Due soon",
  scheduled: "Scheduled",
  never: "Never vaccinated",
};

/** Human phrasing for the due date — "12 days overdue" reads better than "−12". */
function dueText(row) {
  if (row.status === "never") return "No vaccination on record";

  const days = row.days_until_due;
  if (days === null || days === undefined) return "—";
  if (days === 0) return "Due today";
  if (days < 0) {
    const overdue = Math.abs(days);
    return `${overdue} ${overdue === 1 ? "day" : "days"} overdue`;
  }

  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export default function VaccinationSchedulePage({ roleKey = "doctor" }) {
  const config = getRole(roleKey);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await vaccinationApi.schedule({
        per_page: 200,
        status: status === "all" ? undefined : status,
      });

      setRows(result ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <p className="eyebrow">{config?.label ?? "Veterinarian"}</p>
        <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
          Vaccination Schedule
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          When each animal is next due for vaccination, worked out from the
          vaccination dates on its monitoring records. Most urgent first —
          animals with no vaccination on record lead the list.
        </p>

        <p className="mt-4 inline-flex items-center gap-2 rounded-pill bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800">
          <Icon name="info" className="h-3.5 w-3.5" />
          Derived from recorded visits — log a visit to update it
        </p>

        {/* Status filter — mirrors the `status` query parameter the API takes. */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              aria-pressed={status === filter.value}
              className={`rounded-pill px-3 py-1.5 text-xs font-semibold transition ${
                status === filter.value
                  ? "bg-brand-700 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-800"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}

      <section className="card overflow-hidden">
        {loading ? (
          <SkeletonList rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing due"
            description={
              status === "all"
                ? "No animals to schedule yet — they appear here once beneficiaries are registered."
                : "No animal matches this status right now."
            }
          />
        ) : (
          <>
            <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-700">
                {rows.length} {rows.length === 1 ? "animal" : "animals"}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-left text-xs">
                <colgroup>
                  <col className="w-[24%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[12%]" />
                  <col />
                </colgroup>
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                    <th scope="col" className="px-4 py-2.5 font-semibold">Farmer</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Animal</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Last vaccination</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Next due</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Technician</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.id} className="transition hover:bg-brand-50/40">
                      <td className="px-4 py-2.5 font-medium whitespace-nowrap text-slate-900">
                        {row.name_of_farmer}
                        <span className="block text-[11px] font-normal text-slate-500">
                          {row.address}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {row.animal_type}
                        {row.sex ? ` (${row.sex})` : ""}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {row.last_vaccination_date ? (
                          formatDate(row.last_vaccination_date)
                        ) : (
                          <span className="text-slate-400">Never</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {row.next_due_date ? (
                          <>
                            <span className="font-medium text-slate-900">
                              {formatDate(row.next_due_date)}
                            </span>
                            <span className="block text-[11px] text-slate-500">
                              {dueText(row)}
                            </span>
                          </>
                        ) : (
                          // No due date to show. Saying why beats a dash: an
                          // animal with no vaccination at all is the most
                          // urgent row on the page, not a blank one.
                          <span className="text-[11px] text-slate-500">{dueText(row)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span
                          className={`rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${
                            STATUS_TONES[row.status] ?? STATUS_TONES.never
                          }`}
                        >
                          {STATUS_LABELS[row.status] ?? row.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {row.technician?.name ?? (
                          <span className="font-medium text-amber-700">Unassigned</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
