import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAutoRefresh } from "../api/queries";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { InlineAlert } from "../components/InlineAlert";
import { SkeletonDetail, SkeletonList } from "../components/Skeleton";
import { GenealogyTree } from "../components/GenealogyTree";
import { Icon } from "../components/Icons";
import { useAuth } from "../context/AuthContext";
import { dashboardPathFor } from "../config/roles";

/**
 * Beneficiary lineage — the re-dispersal (pass-on) chain.
 *
 * Two readings of one animal's line:
 *  - "Pass-on chain" walks backwards: where the animal came from, oldest first.
 *  - "Offspring genealogy" walks forwards as a tree: every generation its
 *    offspring were passed on to, branching where a household passed to more
 *    than one recipient.
 *
 * Data comes from `GET /api/v1/beneficiaries/{id}/lineage`.
 */
export default function BeneficiaryLineagePage() {
  const { id, role } = useParams();
  const { user } = useAuth();
  const [lineage, setLineage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    try {
      setLineage(await beneficiariesApi.lineage(id));
    } catch (err) {
      // A 404 here means the beneficiary is gone or out of scope for this
      // role — Laravel's bare 404 body carries no message, so axios's
      // default "Request failed with status code 404" would surface and
      // say nothing the reader can act on.
      if (!quiet) {
        setError(
          err.response?.status === 404
            ? "This beneficiary could not be found. It may have been removed, or your account does not have access to it."
            : getErrorMessage(err),
        );
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Quietly re-fetch so pass-on moves recorded elsewhere appear live.
  useAutoRefresh(load);

  if (loading) {
    // Detail-shaped skeleton — medallion + text lines for the header card,
    // row blocks for the lineage list — mirrors the loaded layout so the
    // swap doesn't reflow (and replaces the old bare spinner).
    return (
      <div className="space-y-5">
        <div className="card p-6">
          <SkeletonDetail />
        </div>
        <div className="card overflow-hidden">
          <SkeletonList rows={3} rowClassName="h-14" />
        </div>
      </div>
    );
  }

  if (error || !lineage) {
    return (
      <div className="space-y-6">
        <InlineAlert message={error ?? "Lineage not found."} />
        <p>
          <Link to={dashboardPathFor(user?.role) ?? "/dashboard"} className="btn-secondary">
            Back to dashboard
          </Link>
        </p>
      </div>
    );
  }

  const { beneficiary, chain, descendant_tree: descendantTree = [] } = lineage;

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="no-print flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">Dispersal Lineage</p>
          <Link
            to={`/dashboard/${role}/beneficiaries/${beneficiary.id}/tag`}
            className="btn-secondary !px-3.5 !py-1.5 text-xs"
          >
            <Icon name="printer" className="h-3.5 w-3.5" />
            Print ear tag
          </Link>
        </div>
        <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
          {beneficiary.name_of_farmer}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {beneficiary.address} · {beneficiary.animal_type} ·{" "}
          {beneficiary.sex === "M" ? "Male" : "Female"}
        </p>
      </section>

      {chain.length === 0 && descendantTree.length === 0 ? (
        <section className="card">
          <EmptyState
            title="No dispersal recorded"
            description="This beneficiary has no dispersal events yet."
          />
        </section>
      ) : (
        <section className="card p-6">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Pass-on chain (oldest first)
          </h3>
          <ol className="mt-4 space-y-0">
            {chain.map((link, index) => (
              <li key={link.event_id} className="relative flex gap-4 pb-6 last:pb-0">
                {/* Timeline rail */}
                {index < chain.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-8 left-[11px] h-full w-0.5 bg-brand-200"
                  />
                )}
                <span
                  aria-hidden="true"
                  className={`relative z-10 mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full ring-4 ring-white ${
                    link.is_current
                      ? "bg-brand-700 text-white"
                      : link.dispersal_type === "initial"
                        ? "bg-brand-200 text-brand-900"
                        : "bg-earth-200 text-earth-700"
                  }`}
                >
                  <Icon
                    name={link.dispersal_type === "initial" ? "sprout" : "refresh"}
                    className="h-3.5 w-3.5"
                  />
                </span>

                <div
                  className={`flex-1 rounded-xl border px-4 py-3 ${
                    link.is_current
                      ? "border-brand-300 bg-brand-50/60"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-display text-sm font-semibold text-slate-900">
                      {link.name_of_farmer}
                      {link.is_current && (
                        <span className="ml-2 rounded-pill bg-brand-700 px-2 py-0.5 text-[10px] font-semibold text-white uppercase">
                          This household
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {link.date_dispersed ?? "Date not recorded"}
                    </p>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {link.address} · {link.animal_type}
                  </p>
                  <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-pill bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
                    {link.dispersal_type === "initial" ? (
                      "Initial dispersal"
                    ) : (
                      <>
                        <Icon name="refresh" className="h-3 w-3" />
                        Re-dispersal
                      </>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {descendantTree.length > 0 && (
            <div className="mt-6 border-t border-slate-100 pt-5">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Offspring genealogy
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Every generation this animal's line was passed on to. Each step down
                is an offspring re-dispersed from the household above it.
              </p>
              <div className="mt-4">
                <GenealogyTree nodes={descendantTree} />
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
