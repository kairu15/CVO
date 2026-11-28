import { useEffect, useState } from "react";
import { monitoringApi } from "../api/monitoringApi";
import { Modal } from "./Modal";
import { PhotoLightbox } from "./PhotoLightbox";
import { Icon } from "./Icons";

/** Local-date formatting used across the monitoring views. */
function formatDateTime(value) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value) {
  if (!value) return null;

  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString();
}

/**
 * The Farmer Confirmation section of a monitoring record.
 *
 * Opened from the monitoring table so an administrator can see the actual
 * captured signature in the existing record workflow. The image is served
 * through a short-lived signed URL from the private disk; opening the
 * dialog re-fetches the record so a stale URL (they expire) never renders
 * as a broken image. When no signature was captured the dialog says so
 * explicitly instead of showing an empty frame.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {object|null} props.record row from the monitoring table
 * @param {() => void} props.onClose
 */
export function FarmerSignatureDialog({ open, record, onClose }) {
  const [fresh, setFresh] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!open || !record?.id) {
      setFresh(null);
      setExpanded(false);
      return undefined;
    }

    let cancelled = false;

    setLoading(true);
    setError(null);
    setFresh(null);

    monitoringApi
      .get(record.id)
      .then((data) => {
        if (!cancelled) setFresh(data);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the latest signature details.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, record?.id]);

  if (!open || !record) return null;

  // Prefer the freshly fetched record (valid signed URL); while it loads, the
  // row's data keeps the dialog populated rather than flashing empty.
  const detail = fresh ?? record;
  const imageUrl = detail.farmer_signature_url;
  const hasSignature = Boolean(detail.has_farmer_signature && imageUrl);
  const farmerName = detail.name_of_farmer ?? "the farmer";

  return (
    <>
      <Modal open={open} title="Farmer confirmation" onClose={onClose} contentClassName="max-w-2xl">
        <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Farmer's name</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{detail.name_of_farmer || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Monitoring record date</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">
                {formatDate(detail.date_monitored) ?? "Not recorded"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Signed</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">
                {hasSignature ? formatDateTime(detail.farmer_signed_at) ?? "Date not recorded" : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Technician who recorded the entry</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">
                {detail.signature_captured_by_name || detail.technician?.name || "—"}
              </dd>
            </div>
          </dl>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-200/70">
            {loading && !hasSignature ? (
              <p className="py-10 text-center text-sm text-slate-500">Loading signature…</p>
            ) : hasSignature ? (
              <>
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="mx-auto block max-w-full rounded-lg bg-white p-2 ring-1 ring-slate-200 transition hover:ring-brand-400"
                  style={{ backgroundColor: "#ffffff" }}
                  aria-label={`Enlarge the signature of ${farmerName}`}
                >
                  <img
                    src={imageUrl}
                    alt={`Farmer signature of ${farmerName}`}
                    className="mx-auto max-h-40 w-auto max-w-full object-contain"
                  />
                </button>
                <p className="mt-2 text-center text-[11px] text-slate-500">
                  Captured digitally at the monitoring visit. Click the image to enlarge.
                </p>
              </>
            ) : (
              <div className="py-8 text-center">
                <Icon name="check" className="mx-auto h-6 w-6 text-slate-300" />
                <p className="mt-2 text-sm font-medium text-slate-600">
                  No farmer signature recorded.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {error ?? "This monitoring entry was saved without a captured signature."}
                </p>
              </div>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500">
            The signature confirms that the monitoring visit represented by this record took
            place. It is stored privately and shown only to authorized staff.
          </p>

          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="btn-secondary">
              Close
            </button>
          </div>
        </div>
      </Modal>

      <PhotoLightbox
        open={expanded}
        imageUrl={imageUrl}
        alt={`Farmer signature of ${farmerName}`}
        title={`Farmer signature — ${farmerName}`}
        onClose={() => setExpanded(false)}
        caption={
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>
              <strong className="font-semibold text-slate-800">Farmer:</strong> {farmerName}
            </span>
            {formatDateTime(detail.farmer_signed_at) && (
              <span>
                <strong className="font-semibold text-slate-800">Signed:</strong>{" "}
                {formatDateTime(detail.farmer_signed_at)}
              </span>
            )}
            {formatDate(detail.date_monitored) && (
              <span>
                <strong className="font-semibold text-slate-800">Monitoring date:</strong>{" "}
                {formatDate(detail.date_monitored)}
              </span>
            )}
          </div>
        }
      />
    </>
  );
}
