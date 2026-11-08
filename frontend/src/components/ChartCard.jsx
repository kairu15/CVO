import { EmptyState } from "./EmptyState";
import { SkeletonList } from "./Skeleton";
import { InlineAlert } from "./InlineAlert";

/**
 * Card frame: title + loading/empty/error states around the chart body. The
 * chart itself is the `children`, sized to the standard h-72 box.
 *
 * Shared by the Reports screen and the Admin Dashboard Overview.
 */
export function ChartCard({ title, caption, state, isEmpty, emptyTitle, emptyDescription, children }) {
  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
          {title}
        </h3>
        {caption && <p className="text-xs text-slate-500">{caption}</p>}
      </div>

      {state.loading ? (
        <div className="mt-4">
          <SkeletonList rows={3} rowClassName="h-24" />
        </div>
      ) : state.error ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <InlineAlert message={state.error} />
          {state.refresh && (
            <button type="button" onClick={state.refresh} className="btn-secondary !px-3.5 !py-1.5 text-xs">
              Try again
            </button>
          )}
        </div>
      ) : isEmpty ? (
        <div className="mt-4">
          <EmptyState title={emptyTitle} description={emptyDescription} />
        </div>
      ) : (
        <div className="mt-4 h-72">{children}</div>
      )}
    </section>
  );
}
