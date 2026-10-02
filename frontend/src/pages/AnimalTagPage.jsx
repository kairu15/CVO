import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { getErrorMessage } from "../api/client";
import { animalQrPayload } from "../lib/animalQr";
import { AnimalQrCode } from "../components/AnimalQrCode";
import { InlineAlert } from "../components/InlineAlert";
import { SkeletonDetail } from "../components/Skeleton";
import { Icon } from "../components/Icons";

/**
 * Printable ear-tag card for one animal (a beneficiary row).
 *
 * Sized to a credit-card-ish footprint so it can be printed, cut and laminated
 * for the ear tag / record folder. Only the `.print-area` card survives
 * printing — see the print rules in index.css — so the dashboard chrome never
 * lands on the tag. Data comes from `GET /api/v1/beneficiaries/{id}`, which is
 * role-scoped server-side.
 */
function sexLabel(sex) {
  if (sex === "M") return "Male";
  if (sex === "F") return "Female";
  return sex || "—";
}

export default function AnimalTagPage() {
  const { id, role } = useParams();
  const [beneficiary, setBeneficiary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setBeneficiary(await beneficiariesApi.get(id));
    } catch (err) {
      setError(
        err.response?.status === 404
          ? "This animal could not be found. It may have been removed, or your account does not have access to it."
          : getErrorMessage(err),
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="card p-6">
        <SkeletonDetail />
      </div>
    );
  }

  if (error || !beneficiary) {
    return (
      <div className="space-y-6">
        <InlineAlert message={error ?? "Animal not found."} />
        <Link to={`/dashboard/${role}/beneficiaries/${id}/lineage`} className="btn-secondary">
          Back
        </Link>
      </div>
    );
  }

  const qrValue = animalQrPayload(beneficiary.id);

  return (
    <div className="space-y-6">
      {/* Screen-only toolbar — hidden when printing. */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Ear tag</p>
          <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
            Printable tag card
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Print, cut out and laminate. The QR opens this animal's record when a
            technician scans it.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/dashboard/${role}/beneficiaries/${id}/lineage`} className="btn-secondary">
            <Icon name="route" className="h-4 w-4" />
            Lineage
          </Link>
          <button type="button" className="btn-primary" onClick={() => window.print()}>
            <Icon name="printer" className="h-4 w-4" />
            Print tag
          </button>
        </div>
      </div>

      <div className="print-area mx-auto w-[85mm] rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <div>
            <p className="font-display text-[13px] font-bold text-slate-900">
              City Veterinary Office
            </p>
            <p className="text-[10px] text-slate-500">Bayawan City, Negros Oriental</p>
          </div>
          <span className="rounded-pill bg-brand-100 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-brand-800 uppercase">
            Animal tag
          </span>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <AnimalQrCode
            value={qrValue}
            cellSize={6}
            margin={3}
            className="h-[32mm] w-[32mm] shrink-0"
            alt={`QR tag for animal ${beneficiary.id}`}
          />
          <dl className="min-w-0 text-[11px] leading-snug">
            <dt className="text-slate-500">Animal ID</dt>
            <dd className="font-display text-lg font-bold text-slate-900">
              #{beneficiary.id}
            </dd>
            <dt className="mt-1.5 text-slate-500">Farmer</dt>
            <dd className="font-semibold text-slate-900">{beneficiary.name_of_farmer}</dd>
            <dt className="mt-1.5 text-slate-500">Barangay</dt>
            <dd className="font-semibold text-slate-900">{beneficiary.address}</dd>
          </dl>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-2 text-[11px]">
          <span className="text-slate-600">
            {beneficiary.animal_type} · {sexLabel(beneficiary.sex)}
          </span>
          <span className="font-mono text-[9px] text-slate-400">{qrValue}</span>
        </div>
      </div>
    </div>
  );
}
