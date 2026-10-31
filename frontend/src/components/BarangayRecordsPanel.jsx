import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icons";

/**
 * The barangay records panel: a floating information window on the Admin Map
 * that opens when the admin clicks a barangay polygon.
 *
 * It is a WINDOW, not a dock: it floats over the map clear of the zoom and
 * fullscreen controls (default: below the fullscreen button, top-right), it
 * can be dragged by its header anywhere within the map that suits the admin
 * better, and it stays inside the map — a drag can never park it where the
 * header would be unreachable. There is ONE window: selecting another
 * barangay updates it in place, never a second overlapping one.
 *
 * Header: the barangay's name, its headline counts (total / active /
 * re-dispersed), an animal-type summary, a search field and the close
 * button. Body: one card per dispersed animal in a responsive grid — five
 * cards per row on desktop, three on tablet, one or two on mobile — that
 * scrolls when a barangay holds many animals, each card with its own
 * working "Show flight path" and "Re-disperse" actions.
 *
 * The animals come straight from the dated snapshot the map already renders
 * (animal-keyed pins), so the cards, the counts and the map can never
 * disagree. No records are duplicated: one card per animal.
 */

/** Keep at least this much of the panel inside the map while dragging. */
const MIN_VISIBLE = 96;
/** Default placement: clear of the top-right fullscreen control. */
const DEFAULT_TOP = 56;
const DEFAULT_EDGE = 12;

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
 * @param {number|string|null} [props.activeFlightAnimalId] the animal whose
 *   flight path is currently on the map (flips the card's button label)
 * @param {(animalId: number|string) => void} [props.onShowFlightPath]
 * @param {() => void} [props.onHideFlightPath]
 * @param {(pin: object) => void} [props.onRedisperse] opens the re-dispersal
 *   workflow for the animal's household
 * @param {() => void} props.onClose
 */
export function BarangayRecordsPanel({
  barangay,
  animals = [],
  activeFlightAnimalId = null,
  onShowFlightPath = null,
  onHideFlightPath = null,
  onRedisperse = null,
  onClose,
}) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState(null); // {left, top} once dragged
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef(null);
  const bodyRef = useRef(null);
  const closeTimerRef = useRef(null);
  const dragRef = useRef(null);

  // Mount → visible for the open transition; leaving fades before unmount.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => clearTimeout(closeTimerRef.current), []);

  function requestClose() {
    if (leaving) return;
    setLeaving(true);
    setVisible(false);
    closeTimerRef.current = setTimeout(() => onClose?.(), 200);
  }

  /* --------------------------- drag handling --------------------------- */

  // Drag from the header (never from its buttons/inputs). The window is
  // clamped to the map: at least MIN_VISIBLE px of it always stays inside,
  // so it can be dropped anywhere but never lost off the map.
  function startDrag(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest("button, input, a, select, textarea")) return;
    const panel = panelRef.current;
    const shell = panel?.parentElement;
    if (!panel || !shell) return;
    const panelRect = panel.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
      shellLeft: shellRect.left,
      shellTop: shellRect.top,
      shellWidth: shellRect.width,
      shellHeight: shellRect.height,
      panelWidth: panelRect.width,
      panelHeight: panelRect.height,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveDrag(event) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const left = Math.min(
      drag.shellWidth - MIN_VISIBLE,
      Math.max(MIN_VISIBLE - drag.panelWidth, event.clientX - drag.offsetX - drag.shellLeft),
    );
    const top = Math.min(
      Math.max(0, drag.shellHeight - 48),
      Math.max(0, event.clientY - drag.offsetY - drag.shellTop),
    );
    setPosition({ left: Math.round(left), top: Math.round(top) });
  }

  function endDrag(event) {
    if (!dragRef.current || event.pointerId !== dragRef.current.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  // Escape closes the panel.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestClose is stable in behaviour
  }, []);

  const counts = useMemo(() => {
    const active = animals.filter((animal) => animal.animal_status === "active").length;
    const redispersed = animals.filter(
      (animal) => animal.event_type === "re_dispersal" || animal.event_type === "pass_on",
    ).length;
    const types = new Map();
    for (const animal of animals) {
      const type = animal.animal_type ?? "Unspecified";
      types.set(type, (types.get(type) ?? 0) + 1);
    }
    return {
      total: animals.length,
      active,
      redispersed,
      types: [...types.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type} × ${count}`)
        .join(" · "),
    };
  }, [animals]);

  const visibleAnimals = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return animals;
    return animals.filter((animal) =>
      [animal.ear_tag_number, animal.animal_type, animal.owner?.label, animal.event_type]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    );
  }, [animals, search]);

  // Un-dragged: float below the fullscreen control, top-right of the map.
  // After a drag: wherever the admin dropped it (clamped to the map).
  const placement = position
    ? { left: position.left, top: position.top, right: "auto", bottom: "auto" }
    : { top: DEFAULT_TOP, right: DEFAULT_EDGE, left: "auto", bottom: "auto" };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={`Animal dispersal records of barangay ${barangay}`}
      data-testid="barangay-records-panel"
      style={{ ...placement, transition: dragging ? "none" : undefined }}
      className={`absolute z-[35] flex max-h-[calc(100%-4.5rem)] w-[min(62rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel dark:border-slate-700 dark:bg-slate-900 ${
        dragging ? "" : "transition-opacity duration-200"
      } ${visible && !leaving ? "opacity-100" : "opacity-0"}`}
    >
      {/* ------------------------------------------------------- Header */}
      <div
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`flex touch-none select-none items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-brand-600 to-brand-500 px-4 py-3 dark:border-slate-700 ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        title="Drag to move this window"
      >
        <div className="min-w-0">
          <p className="eyebrow !text-brand-100">Barangay records</p>
          <h2 className="truncate font-display text-base font-bold text-white sm:text-lg">
            Barangay: {barangay}
          </h2>
          <p className="mt-0.5 text-[11px] font-medium text-brand-50">
            Total animals: {counts.total} · Active: {counts.active} ·
            Re-dispersed: {counts.redispersed}
            {counts.types ? ` · ${counts.types}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close barangay records panel"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-white/15 text-white transition hover:bg-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      </div>

      {/* -------------------------------------------------------- Search */}
      <div className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-700">
        <label className="block">
          <span className="sr-only">Find animals by ear tag, type or record name</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find by ear tag, animal type, record name…"
            className="field !py-1.5 text-xs"
          />
        </label>
      </div>

      {/* ---------------------------------------------------------- Cards */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3" ref={bodyRef}>
        {visibleAnimals.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            {animals.length === 0
              ? "No dispersed animals are recorded in this barangay for the selected date."
              : "No animals match that search."}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
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
                    ? `Barangay centre`
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

                  {/* Actions — independent per card. */}
                  <div className="mt-3 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        flightActive
                          ? onHideFlightPath?.()
                          : onShowFlightPath?.(animal.animal_id)
                      }
                      className="inline-flex min-h-[32px] flex-1 items-center justify-center gap-1 rounded-pill border border-brand-300 bg-brand-50 px-2 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700"
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
                        className="inline-flex min-h-[32px] flex-1 items-center justify-center rounded-pill border border-brand-300 bg-white px-2 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700"
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
    </div>
  );
}

export default BarangayRecordsPanel;
