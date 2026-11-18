import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icons";

/**
 * The barangay inspector: a DOCKED side panel on the Admin Map, not a window
 * floating over it. The map keeps the width the inspector does not need, and
 * on a phone the inspector stacks below the map.
 *
 * It opens when a barangay polygon or a household pin is selected. Header:
 * barangay name, headline counts, animal-type summary, search and close.
 * Body: one card per dispersed animal, each with its own flight-path and
 * re-disperse actions. The animals come straight from the dated snapshot the
 * map already renders, so the cards and the map can never disagree.
 */

const LOCATION_SOURCE_LABELS = {
  device_gps: "GPS pin",
  manual_pin: "Manual pin",
  owner_geotag: "Owner geotag",
  barangay_centroid: "Barangay centre",
};

const EVENT_TYPE_LABELS = {
  dispersal: "Dispersal",
  re_dispersal: "Re-dispersal",
  pass_on: "Pass-on",
  return: "Return to CVO",
};

const STATUS_STYLES = {
  active: "bg-brand-100 text-brand-800",
  returned: "bg-slate-200 text-slate-600",
  deceased: "bg-rose-100 text-rose-700",
};

/**
 * @param {object} props
 * @param {string} props.barangay display name of the selected barangay
 * @param {Array<object>} props.animals the barangay's animal records (the
 *   dated snapshot's pins, geotag and owner fields included)
 * @param {number|string|null} [props.focusOwnerId] narrow to one household
 * @param {string} [props.focusOwnerName] household label for the focus chip
 * @param {() => void} [props.onClearFocus]
 * @param {number|string|null} [props.activeFlightAnimalId]
 * @param {(animalId: number|string) => void} [props.onShowFlightPath]
 * @param {() => void} [props.onHideFlightPath]
 * @param {(pin: object) => void} [props.onRedisperse]
 * @param {() => void} props.onClose
 * @param {string} [props.className] layout classes supplied by the page
 */
export function BarangayRecordsPanel({
  barangay,
  animals = [],
  focusOwnerId = null,
  focusOwnerName = "",
  onClearFocus = null,
  activeFlightAnimalId = null,
  onShowFlightPath = null,
  onHideFlightPath = null,
  onRedisperse = null,
  onClose,
  className = "",
}) {
  const [search, setSearch] = useState("");
  const closeRef = useRef(null);

  // A docked inspector is a real region of the page: move focus to its close
  // control when it opens, and let Escape close it.
  useEffect(() => {
    closeRef.current?.focus?.();
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const scopedAnimals = useMemo(() => {
    if (focusOwnerId === null || focusOwnerId === undefined) return animals;
    return animals.filter(
      (animal) => String(animal.owner?.id) === String(focusOwnerId),
    );
  }, [animals, focusOwnerId]);

  const counts = useMemo(() => {
    const active = scopedAnimals.filter((animal) => animal.animal_status === "active").length;
    const redispersed = scopedAnimals.filter(
      (animal) => animal.event_type === "re_dispersal" || animal.event_type === "pass_on",
    ).length;
    const types = new Map();
    for (const animal of scopedAnimals) {
      const type = animal.animal_type ?? "Unspecified";
      types.set(type, (types.get(type) ?? 0) + 1);
    }
    return {
      total: scopedAnimals.length,
      active,
      redispersed,
      types: [...types.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type} × ${count}`)
        .join(" · "),
    };
  }, [scopedAnimals]);

  const visibleAnimals = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return scopedAnimals;
    return scopedAnimals.filter((animal) =>
      [animal.ear_tag_number, animal.animal_type, animal.owner?.label, animal.event_type]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    );
  }, [scopedAnimals, search]);

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={`Animal dispersal records of barangay ${barangay}`}
      data-testid="barangay-records-panel"
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel dark:border-slate-700 dark:bg-slate-900 ${className}`}
    >
      {/* ------------------------------------------------------- Header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-brand-600 to-brand-500 px-4 py-3 dark:border-slate-700">
        <div className="min-w-0">
          <p className="eyebrow !text-brand-100">Barangay records</p>
          <h2 className="truncate font-display text-base font-bold text-white sm:text-lg">
            Barangay: {barangay}
          </h2>
          <p className="mt-0.5 text-[11px] font-medium text-brand-50">
            Total animals: {counts.total} · Active: {counts.active} · Re-dispersed:{" "}
            {counts.redispersed}
            {counts.types ? ` · ${counts.types}` : ""}
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close barangay records panel"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-pill bg-white/15 text-white transition hover:bg-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      </div>

      {focusOwnerId !== null && focusOwnerId !== undefined && (
        <div className="flex items-center justify-between gap-2 border-b border-brand-100 bg-brand-50 px-4 py-2 text-[11px] font-semibold text-brand-800 dark:border-slate-700 dark:bg-slate-800 dark:text-brand-200">
          <span className="truncate">Household: {focusOwnerName || `#${focusOwnerId}`}</span>
          {onClearFocus && (
            <button
              type="button"
              onClick={onClearFocus}
              className="shrink-0 rounded-pill px-2 py-1 underline hover:bg-brand-100 dark:hover:bg-slate-700"
            >
              Show barangay
            </button>
          )}
        </div>
      )}

      {/* -------------------------------------------------------- Search */}
      <div className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-700">
        <label className="block">
          <span className="sr-only">Find animals by ear tag, type or record name</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find by ear tag, animal type, record name…"
            className="field !py-2 text-xs"
          />
        </label>
      </div>

      {/* ---------------------------------------------------------- Cards */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {visibleAnimals.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            {animals.length === 0
              ? "No dispersed animals are recorded in this barangay for the selected date."
              : "No animals match that search."}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2.5">
            {visibleAnimals.map((animal) => {
              const flightActive =
                activeFlightAnimalId !== null &&
                String(animal.animal_id) === String(activeFlightAnimalId);
              const statusKey = animal.animal_status ?? "active";
              const statusLabel =
                statusKey.charAt(0).toUpperCase() + statusKey.slice(1);

              const coords =
                animal.latitude !== null && animal.longitude !== null
                  ? animal.approximate
                    ? "Barangay centre"
                    : `${animal.latitude.toFixed(5)}, ${animal.longitude.toFixed(5)}`
                  : null;

              const canAct = !animal.owner?.masked;

              return (
                <li
                  key={animal.animal_id}
                  className={`flex flex-col rounded-xl border p-3 transition hover:border-brand-300 dark:border-slate-700 ${
                    flightActive
                      ? "border-brand-400 bg-brand-50/60 ring-2 ring-brand-500 dark:bg-slate-800"
                      : "bg-white dark:bg-slate-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className="min-w-0 truncate text-xs font-bold text-slate-900 dark:text-slate-100"
                      title={animal.ear_tag_number ?? undefined}
                    >
                      {animal.ear_tag_number
                        ? `#${animal.ear_tag_number}`
                        : `Animal #${animal.animal_id}`}
                    </p>
                    <span
                      className={`shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-semibold ${
                        STATUS_STYLES[statusKey] ?? STATUS_STYLES.active
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  <dl className="mt-2 flex-1 space-y-1 text-[11px] leading-snug">
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Animal type
                      </dt>
                      <dd className="text-slate-700 dark:text-slate-200">
                        {animal.animal_type ?? "Unspecified"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Barangay
                      </dt>
                      <dd className="text-slate-600 dark:text-slate-300">{barangay}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Location method
                      </dt>
                      <dd className="text-slate-600 dark:text-slate-300">
                        {animal.location_source
                          ? (LOCATION_SOURCE_LABELS[animal.location_source] ??
                            animal.location_source)
                          : "Not recorded"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Last event
                      </dt>
                      <dd className="text-slate-600 dark:text-slate-300">
                        {animal.last_event_date
                          ? `${new Date(`${animal.last_event_date}T00:00:00`).toLocaleDateString(undefined, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}${animal.event_type ? ` · ${(EVENT_TYPE_LABELS[animal.event_type] ?? animal.event_type)}` : ""}`
                          : "Not recorded"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        GPS coordinates
                      </dt>
                      <dd className="tabular-nums text-slate-600 dark:text-slate-300">
                        {coords ?? "Not recorded"}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        flightActive
                          ? onHideFlightPath?.()
                          : onShowFlightPath?.(animal.animal_id)
                      }
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-pill border border-brand-300 bg-brand-50 px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700"
                      aria-pressed={flightActive}
                    >
                      <Icon
                        name={flightActive ? "eye-off" : "eye"}
                        className="h-3 w-3 shrink-0"
                      />
                      {flightActive ? "Hide flight path" : "Show flight path"}
                    </button>
                    {onRedisperse && canAct && (
                      <button
                        type="button"
                        onClick={() => onRedisperse(animal)}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-pill border border-brand-300 bg-white px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700"
                      >
                        Re-disperse
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

export default BarangayRecordsPanel;
