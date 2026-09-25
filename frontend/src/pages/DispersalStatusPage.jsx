import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dispersalApi } from "../api/dispersalApi";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { Icon } from "../components/Icons";
import { useAuth } from "../context/AuthContext";
import { getRole } from "../config/roles";

/**
 * Farmer "Dispersal Status" screen.
 *
 * Read-only, and deliberately so: the API already scopes dispersal events to
 * the ones touching this farmer's animals (DispersalEventService +
 * DispersalEventPolicy), so this page only presents them. There is no new
 * endpoint behind it.
 *
 * Each row reads as a movement: where the animal came from and where it went.
 * An initial dispersal arrives from the programme; a re-dispersal moves from
 * one household to another. Expressing it that way keeps the row honest for
 * every role rather than guessing an "incoming/outgoing" direction.
 */

const TYPE_LABELS = {
  initial: "Initial dispersal",
  "re-dispersal": "Re-dispersal",
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export default function DispersalStatusPage({ roleKey = "farmer" }) {
  const { user } = useAuth();
  const config = getRole(roleKey);

  const [events, setEvents] = useState([]);
  const [myIds, setMyIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Only a farmer gets "your household" markers: for an all-access admin the
  // beneficiary list is programme-wide, so marking rows as "yours" would be
  // meaningless rather than helpful.
  const isFarmer = user?.role === "farmer";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const requests = [dispersalApi.list({ per_page: 200 })];
      if (isFarmer) requests.push(beneficiariesApi.list({ per_page: 200 }));

      const [eventsRes, mineRes] = await Promise.all(requests);

      setEvents(eventsRes ?? []);
      setMyIds(new Set((mineRes ?? []).map((b) => b.id)));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [isFarmer]);

  useEffect(() => {
    load();
  }, [load]);

  const received = events.filter((e) => myIds.has(e.beneficiary_id)).length;
  const passedOn = events.filter((e) => myIds.has(e.parent_beneficiary_id)).length;

  /** The household on this side of the movement, marked when it is the farmer's. */
  function household(beneficiary, fallback) {
    if (!beneficiary) return <span className="text-slate-500">{fallback}</span>;

    return (
      <span className="text-slate-700">
        {beneficiary.name_of_farmer}
        {isFarmer && myIds.has(beneficiary.id) && (
          <span className="ml-1.5 rounded-pill bg-brand-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-brand-800 uppercase">
            You
          </span>
        )}
        <span className="block text-[11px] text-slate-500">{beneficiary.address}</span>
      </span>
    );
  }

  /** Which of this farmer's animals the lineage link opens. */
  function lineageOwnerId(event) {
    if (myIds.has(event.beneficiary_id)) return event.beneficiary_id;
    if (myIds.has(event.parent_beneficiary_id)) return event.parent_beneficiary_id;
    return null;
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <p className="eyebrow">{config?.label ?? "Farmer / Beneficiary"}</p>
        <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
          Dispersal Status
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          The animals dispersed to you, and where the offspring of your animals
          went on to. Each line is one movement, from the household that
          released the animal to the one that received it.
        </p>

        {isFarmer && !loading && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-pill bg-brand-50 px-3.5 py-1.5 text-xs font-semibold text-brand-800">
              <Icon name="livestock" className="h-4 w-4" />
              {received} received
            </span>
            <span className="inline-flex items-center gap-2 rounded-pill bg-slate-100 px-3.5 py-1.5 text-xs font-semibold text-slate-700">
              <Icon name="refresh" className="h-4 w-4" />
              {passedOn} passed on to the next farmer
            </span>
          </div>
        )}
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}

      <section className="card overflow-hidden">
        {loading ? (
          <SkeletonList rows={4} rowClassName="h-12" />
        ) : events.length === 0 ? (
          <EmptyState
            title="No dispersal records yet"
            description="Dispersals appear here once the City Veterinary Office records the animal released to you, or the offspring your animal passed on."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <colgroup>
                <col className="w-[12%]" />
                <col className="w-[16%]" />
                <col className="w-[14%]" />
                <col className="w-[24%]" />
                <col className="w-[24%]" />
                <col />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Date</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Type</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Animal</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">From</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">To</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    <span className="sr-only">Lineage</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {events.map((event) => {
                  const ownerId = lineageOwnerId(event);

                  return (
                    <tr key={event.id} className="transition hover:bg-brand-50/40">
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {formatDate(event.date_dispersed)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span
                          className={`rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${
                            event.dispersal_type === "initial"
                              ? "bg-brand-100 text-brand-900"
                              : "bg-amber-50 text-amber-800"
                          }`}
                        >
                          {TYPE_LABELS[event.dispersal_type] ?? event.dispersal_type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {event.beneficiary?.animal_type ?? "—"}
                        {event.beneficiary?.sex ? ` (${event.beneficiary.sex})` : ""}
                      </td>
                      <td className="px-4 py-2.5">
                        {household(event.parent_beneficiary, "City Veterinary Office")}
                      </td>
                      <td className="px-4 py-2.5">{household(event.beneficiary, "—")}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {ownerId ? (
                          <Link
                            to={`/dashboard/${roleKey}/beneficiaries/${ownerId}/lineage`}
                            className="rounded-pill px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100"
                          >
                            Lineage
                          </Link>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
