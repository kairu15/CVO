/**
 * Skeleton loading primitives.
 *
 * Placeholders (not spinners) for views that fetch data before they can
 * render. Shapes are composed from the two primitives below so every async
 * view reuses the same pulse treatment instead of hand-rolling its own —
 * the color lives here (`bg-slate-100`), on the brand-50 app background it
 * reads as a neutral placeholder in both palettes.
 *
 * Accessibility: the group is announced as a polite "Loading" status and
 * every block is aria-hidden, so screen readers hear one calm announcement
 * instead of counting decorative rectangles.
 */

/** One pulsing block — the only place the pulse treatment is defined. */
export function Skeleton({ className = "" }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-pulse rounded-lg bg-slate-100 ${className}`}
    />
  );
}

/** Skeleton circle — avatars and icon medallions in detail views. */
export function SkeletonCircle({ size = "h-10 w-10", className = "" }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 animate-pulse rounded-full bg-slate-100 ${size} ${className}`}
    />
  );
}

/**
 * A stack of skeleton rows sized like the content they stand in for.
 *
 * @param {object} props
 * @param {string} [props.className] wrapper classes (paddings, spacing)
 * @param {string} [props.rowClassName] classes for each row block
 * @param {number} [props.rows] how many placeholder rows to render
 */
export function SkeletonList({ className = "space-y-3 p-6", rowClassName = "h-10", rows = 3 }) {
  return (
    <div role="status" aria-label="Loading" className={className}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={`block w-full ${rowClassName}`} />
      ))}
    </div>
  );
}

/**
 * Detail-view skeleton: a medallion beside stacked text lines — mirrors the
 * card headers used across the dashboards so the swap doesn't reflow.
 */
export function SkeletonDetail({ className = "" }) {
  return (
    <div role="status" aria-label="Loading" className={`flex items-center gap-4 ${className}`}>
      <SkeletonCircle size="h-12 w-12" />
      <div className="flex-1 space-y-2">
        <Skeleton className="block h-4 w-1/3" />
        <Skeleton className="block h-3 w-1/2" />
      </div>
    </div>
  );
}
