import { useMemo, useState } from "react";

/**
 * The flow matrix: a barangay × barangay heat table with exact counts —
 * origin rows, destination columns — beside a sortable "top flows" table.
 *
 * This is the mouse-free, keyboard-reachable twin of the map's flow layer:
 * the diagonal holds the same-barangay re-dispersals (counted in the totals,
 * never drawn as lines), and every cell states its number as text so the
 * heat shading is a reading aid, not the message.
 */

const SORT_KEYS = ["count", "origin", "destination"];

function cellShade(count, max) {
  if (!count || max <= 0) return undefined;
  const alpha = 0.08 + 0.62 * Math.sqrt(count / max);
  return `rgba(85, 139, 47, ${alpha.toFixed(3)})`;
}

export function FlowMatrix({ barangays = [], flows = [] }) {
  const [sort, setSort] = useState("count");

  const namesById = useMemo(
    () => new Map(barangays.map((row) => [row.barangay_id, row.name])),
    [barangays],
  );

  const counts = useMemo(() => {
    const map = new Map();
    for (const flow of flows) {
      if (flow.origin_barangay_id !== null) {
        map.set(`${flow.origin_barangay_id}:${flow.destination_barangay_id}`, flow.count);
      }
    }
    return map;
  }, [flows]);

  const maxCount = useMemo(
    () => Math.max(0, ...[...counts.values()]),
    [counts],
  );

  const cvoCounts = useMemo(() => {
    const map = new Map();
    for (const flow of flows) {
      if (flow.origin_barangay_id === null) {
        map.set(flow.destination_barangay_id, flow.count);
      }
    }
    return map;
  }, [flows]);

  const sortedFlows = useMemo(() => {
    const copy = [...flows];
    copy.sort((a, b) => {
      if (sort === "count") return b.count - a.count;
      if (sort === "origin") return (a.origin_name ?? "").localeCompare(b.origin_name ?? "");
      return (a.destination_name ?? "").localeCompare(b.destination_name ?? "");
    });
    return copy;
  }, [flows, sort]);

  if (flows.length === 0) {
    return (
      <p className="mt-4 text-sm text-slate-500">
        No re-dispersals were recorded in this period.
      </p>
    );
  }

  return (
    <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      {/* The matrix — scrolls horizontally on narrow screens with a sticky
          header and a sticky origin column. */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700" tabIndex={0} aria-label="Flow matrix, origin barangays by destination barangays">
        <table className="w-full border-collapse text-right text-xs">
          <caption className="sr-only">
            Re-dispersal flows between barangays: rows are origins, columns are destinations, the
            diagonal is re-dispersal within the same barangay.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 top-0 z-20 border-b border-slate-200 bg-white px-3 py-2 text-left font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900"
              >
                Origin \ Destination
              </th>
              {barangays.map((row) => (
                <th
                  key={row.barangay_id}
                  scope="col"
                  className="sticky top-0 z-10 min-w-24 border-b border-slate-200 bg-white px-2 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900"
                >
                  {row.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {barangays.map((origin) => (
              <tr key={origin.barangay_id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-1.5 text-left font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900"
                >
                  {origin.name}
                </th>
                {barangays.map((destination) => {
                  const count =
                    counts.get(`${origin.barangay_id}:${destination.barangay_id}`) ?? 0;
                  const within = origin.barangay_id === destination.barangay_id;

                  return (
                    <td
                      key={destination.barangay_id}
                      className="border-b border-slate-100 px-2 py-1.5 tabular-nums dark:border-slate-800"
                      style={{ backgroundColor: cellShade(count, maxCount) }}
                      title={
                        within
                          ? `${count} re-dispersed within ${origin.name}`
                          : `${count} from ${origin.name} to ${destination.name}`
                      }
                    >
                      <span className={within && count > 0 ? "italic" : undefined}>
                        {count || "·"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}

            {cvoCounts.size > 0 && (
              <tr>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-1.5 text-left font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900"
                >
                  CVO
                </th>
                {barangays.map((destination) => (
                  <td
                    key={destination.barangay_id}
                    className="border-b border-slate-100 px-2 py-1.5 tabular-nums dark:border-slate-800"
                    style={{ backgroundColor: cellShade(cvoCounts.get(destination.barangay_id) ?? 0, maxCount) }}
                    title={`${cvoCounts.get(destination.barangay_id) ?? 0} dispersed from CVO to ${destination.name}`}
                  >
                    {cvoCounts.get(destination.barangay_id) ?? "·"}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* The sortable top-flows table — exact numbers, keyboard-first. */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-display text-sm font-semibold text-slate-900">Top flows</h4>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Sort by
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              className="field !w-auto !px-2 !py-1 text-xs"
              aria-label="Sort the flows table"
            >
              {SORT_KEYS.map((key) => (
                <option key={key} value={key}>
                  {key === "count" ? "Count" : key === "origin" ? "Origin" : "Destination"}
                </option>
              ))}
            </select>
          </label>
        </div>

        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] tracking-wide text-slate-500 uppercase dark:border-slate-700">
              <th scope="col" className="py-1.5 font-semibold">Origin</th>
              <th scope="col" className="py-1.5 font-semibold">Destination</th>
              <th scope="col" className="py-1.5 text-right font-semibold">Animals</th>
            </tr>
          </thead>
          <tbody>
            {sortedFlows.map((flow) => (
              <tr
                key={`${flow.origin_barangay_id ?? "cvo"}-${flow.destination_barangay_id}`}
                className="border-b border-slate-100 dark:border-slate-800"
              >
                <td className="py-1.5">{flow.origin_name}</td>
                <td className="py-1.5">
                  {flow.destination_name}
                  {flow.within_barangay && (
                    <span className="ml-1 text-[10px] text-slate-400">(within)</span>
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums">{flow.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default FlowMatrix;
