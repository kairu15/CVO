import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { animalHealthApi } from "../api/animalHealthApi";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { InlineAlert } from "../components/InlineAlert";
import { Icon } from "../components/Icons";
import { getRole } from "../config/roles";

/**
 * Doctor "Animal Health Monitoring" screen.
 *
 * A rollup rather than a data-entry screen: each animal's health at a glance,
 * aggregated from records captured elsewhere (visits, health records, case
 * notes) plus the derived vaccination state. Read-only by design — to change
 * anything on this page you go to the module that owns it, which is what stops
 * two screens owning the same fact.
 *
 * The attention filter is sent to the API rather than applied to the loaded
 * rows: filtering one page client-side would claim nothing needs attention
 * when the flagged animals simply sat on page two.
 */

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

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export default function AnimalHealthPage({ roleKey = "doctor" }) {
  const config = getRole(roleKey);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attentionOnly, setAttentionOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await animalHealthApi.list({
        per_page: 200,
        filter: attentionOnly ? "attention" : undefined,
      });

      setRows(result ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [attentionOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const flagged = rows.filter((row) => row.needs_attention).length;

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <p className="eyebrow">{config?.label ?? "Veterinarian"}</p>
        <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
          Animal Health Monitoring
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Each animal's health at a glance — its latest visit, the most recent
          diagnosis, open cases, notes and vaccination state, gathered from the
          records kept on the other screens.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAttentionOnly(false)}
            aria-pressed={!attentionOnly}
            className={`rounded-pill px-3 py-1.5 text-xs font-semibold transition ${
              !attentionOnly
                ? "bg-brand-700 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-800"
            }`}
          >
            All animals
          </button>
          <button
            type="button"
            onClick={() => setAttentionOnly(true)}
            aria-pressed={attentionOnly}
            className={`rounded-pill px-3 py-1.5 text-xs font-semibold transition ${
              attentionOnly
                ? "bg-brand-700 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-800"
            }`}
          >
            Needs attention
          </button>

          <span className="inline-flex items-center gap-1.5 rounded-pill bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500 ring-1 ring-slate-200">
            <Icon name="info" className="h-3.5 w-3.5" />
            Aggregated from visits, health records and case notes — nothing is
            edited here
          </span>
        </div>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}

      <section className="card overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={attentionOnly ? "Nothing needs attention" : "No animals yet"}
            description={
              attentionOnly
                ? "No animal currently has an overdue or missing vaccination, or an open case."
                : "Animals appear here once beneficiaries are registered."
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-700">
                {rows.length} {rows.length === 1 ? "animal" : "animals"}
              </span>
              {!attentionOnly && flagged > 0 && (
                <span className="font-medium text-amber-700">
                  {flagged} need{flagged === 1 ? "s" : ""} attention
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                    <th scope="col" className="px-4 py-2.5 font-semibold">Farmer</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Animal</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Last visit</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Latest diagnosis</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Vaccination</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Flagged</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
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
                        {/* "None" rather than a dash: this table is the
                            accessible view of the same data, and a bare
                            em dash is read as nothing useful. */}
                        {row.last_visit_date ? (
                          formatDate(row.last_visit_date)
                        ) : (
                          <span className="text-slate-400">None</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {row.latest_diagnosis ? (
                          <>
                            {row.latest_diagnosis}
                            <span className="mt-0.5 block text-[11px] text-slate-500">
                              {/* No outcome yet means the case is still open. */}
                              {row.latest_outcome ?? "Open"}
                              {row.open_cases > 0 && (
                                <span className="ml-1 font-semibold text-amber-700">
                                  · {row.open_cases} open
                                </span>
                              )}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-400">None recorded</span>
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
                        {row.next_due_date && (
                          <span className="mt-0.5 block text-[11px] text-slate-500">
                            due {formatDate(row.next_due_date)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {row.needs_attention ? (
                          <span className="rounded-pill bg-amber-50 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-amber-800 uppercase">
                            {row.attention_reasons.join(" · ")}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                        {row.notes_count > 0 && (
                          <span className="mt-0.5 block text-[11px] text-slate-500">
                            {row.notes_count} {row.notes_count === 1 ? "note" : "notes"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <Link
                          to={`/dashboard/${roleKey}/health-records`}
                          className="rounded-pill px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100"
                        >
                          Records
                        </Link>
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
