import { Icon } from "./Icons";

/**
 * The stored on-site verification verdict for a field visit (Feature 1).
 *
 * The status is computed SERVER-SIDE from the stored coordinates on every
 * save, photo attach and sync replay — this component only renders it. The
 * wording is deliberately about REVIEW, never proof: GPS can be inaccurate
 * or spoofed, so a badge tells a human where to look, it does not certify
 * that anyone stood anywhere.
 *
 * @param {object} props
 * @param {string|null} [props.status] one of the five verdicts, or null
 * @param {number|null} [props.distanceM] stored metres to the registered pin
 * @param {number|null} [props.accuracyM] the fix's accuracy radius
 * @param {boolean} [props.compact] single-line pill (table cells)
 */

const TONES = {
  on_site: "bg-brand-100 text-brand-800 ring-brand-500/30",
  off_site: "bg-red-50 text-red-700 ring-red-500/30",
  low_accuracy: "bg-amber-50 text-amber-800 ring-amber-500/30",
  no_reference_location: "bg-slate-100 text-slate-600 ring-slate-300/60",
  no_gps: "bg-slate-100 text-slate-500 ring-slate-300/60",
  unverified: "bg-slate-50 text-slate-500 ring-slate-200",
};

const LABELS = {
  on_site: "On site",
  off_site: "Off site",
  low_accuracy: "Low accuracy",
  no_reference_location: "No registered pin",
  no_gps: "No GPS",
  unverified: "Not verified",
};

const ICONS = {
  on_site: "check",
  off_site: "alert-circle",
  low_accuracy: "info",
  no_reference_location: "map-pin",
  no_gps: "info",
  unverified: "info",
};

/** Human label for a verdict — exported so tables, lightboxes and the
 *  timeline all say the same words. Null renders as "Not verified". */
export function verificationLabel(status) {
  return LABELS[status] ?? LABELS.unverified;
}

/** 1200 m → "1.2 km", under a kilometre stays in metres. */
export function verificationDistance(distanceM) {
  if (distanceM === null || distanceM === undefined) return null;
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

export function VerificationBadge({ status, distanceM = null, accuracyM = null, compact = false }) {
  const key = status ?? "unverified";
  const distance = verificationDistance(distanceM);
  const accuracy =
    accuracyM !== null && accuracyM !== undefined ? `${Math.round(accuracyM)} m accuracy` : null;

  const detail = [
    distance ? `Registered pin ${distance} away` : null,
    accuracy,
    // The caveat travels with the badge wherever it is rendered.
    "GPS can be inaccurate or spoofed — a review aid, not proof.",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      title={detail}
      className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ring-1 ${TONES[key]}`}
    >
      <Icon name={ICONS[key]} className="h-3 w-3" />
      {LABELS[key]}
      {!compact && distance ? <span className="font-semibold normal-case opacity-70">({distance})</span> : null}
    </span>
  );
}
