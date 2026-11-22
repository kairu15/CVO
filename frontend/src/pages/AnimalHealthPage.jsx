import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { animalHealthApi } from "../api/animalHealthApi";
import { getErrorMessage } from "../api/client";
import { useAutoRefresh } from "../api/queries";
import { useBarangays } from "../hooks/useBarangays";
import { useBarangayBoundaries } from "../hooks/useBarangayBoundaries";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { getRole } from "../config/roles";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { PaginationFooter } from "../components/PaginationFooter";
import { ActionMenu } from "../components/ActionMenu";
import { Icon } from "../components/Icons";
import {
  buildChoropleth,
  normalizeBarangayName,
} from "../lib/barangayBoundaries";

// MapLibre stays out of the monitoring page's first paint, exactly like the
// dashboard's map cards.
const BarangayMap = lazy(() => import("../components/BarangayMap"));

const HEALTH_STATUS = {
  healthy: {
    label: "Healthy",
    tone: "bg-brand-50 text-brand-800 ring-1 ring-brand-200",
    dot: "bg-brand-600",
  },
  observation: {
    label: "Under observation",
    tone: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
    dot: "bg-amber-500",
  },
  attention: {
    label: "Needs attention",
    tone: "bg-red-50 text-red-700 ring-1 ring-red-200",
    dot: "bg-red-600",
  },
  unrecorded: {
    label: "No examination",
    tone: "bg-slate-100 text-slate-600",
    dot: "bg-slate-400",
  },
};

const VACCINATION_STATUS = {
  overdue: { label: "Vaccination overdue", tone: "text-red-700" },
  "due-soon": { label: "Vaccination due soon", tone: "text-amber-700" },
  scheduled: { label: "Vaccination scheduled", tone: "text-brand-800" },
  never: { label: "Never vaccinated", tone: "text-slate-500" },
};

const OUTCOME_TONES = {
  recovered: "bg-brand-50 text-brand-800",
  improving: "bg-sky-50 text-sky-800",
  ongoing: "bg-amber-50 text-amber-800",
  referred: "bg-slate-100 text-slate-700",
  deceased: "bg-red-50 text-red-700",
};

const FOLLOW_UP_TONES = {
  overdue: "bg-red-50 text-red-700",
  upcoming: "bg-amber-50 text-amber-800",
  completed: "bg-brand-50 text-brand-800",
};

const ACTIVE_CARD = "border-brand-500 ring-1 ring-brand-500/30 bg-brand-50/30";
const CARD =
  "rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:border-brand-400 hover:bg-brand-50/40";

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

function HealthStatusBadge({ status }) {
  const meta = HEALTH_STATUS[status] ?? HEALTH_STATUS.unrecorded;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${meta.tone}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function DetailRow({ label, value }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-semibold text-slate-900">{value || "—"}</dd>
    </div>
  );
}

function monthStart(offset = 0) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - offset);
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Map                                                                        */
/* -------------------------------------------------------------------------- */

const LOCATION_SOURCE = "cvo-animal-health-locations";
const LOCATION_LAYER = "cvo-animal-health-location-points";

function AnimalHealthMap({
  boundaries,
  choropleth,
  locations,
  selectedName,
  selectedFeatureId,
  onBarangayClick,
  onReset,
  onSelectLocation,
}) {
  const [map, setMap] = useState(null);
  const clickBoundRef = useRef(false);
  const onSelectRef = useRef(onSelectLocation);

  useEffect(() => {
    onSelectRef.current = onSelectLocation;
  }, [onSelectLocation]);

  const handleMapReady = useCallback((instance) => setMap(instance), []);

  useEffect(() => {
    if (!map) return;

    const data = {
      type: "FeatureCollection",
      features: locations.map((location) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [location.longitude, location.latitude],
        },
        properties: {
          id: location.beneficiary_id,
          name: location.name_of_farmer,
          status: location.health_status,
        },
      })),
    };

    if (!map.getSource(LOCATION_SOURCE)) {
      map.addSource(LOCATION_SOURCE, { type: "geojson", data });
      map.addLayer({
        id: LOCATION_LAYER,
        type: "circle",
        source: LOCATION_SOURCE,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4.5, 13, 7],
          "circle-color": [
            "match",
            ["get", "status"],
            "attention",
            "#b91c1c",
            "observation",
            "#b45309",
            "healthy",
            "#2d6a4f",
            "#64748b",
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.92,
        },
      });
    } else {
      map.getSource(LOCATION_SOURCE).setData(data);
    }

    // The boundary layers are added by the shared map after this component's
    // first effects. Move the pins back on top whenever the choropleth or the
    // location set changes, so a household pin is never buried by a fill.
    if (map.getLayer(LOCATION_LAYER)) {
      try {
        map.moveLayer(LOCATION_LAYER);
      } catch {
        // The map is mid-teardown; the next update will put it back.
      }
    }

    if (!clickBoundRef.current) {
      const onPointClick = (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (id !== undefined && id !== null) onSelectRef.current?.(id);
      };
      map.on("click", LOCATION_LAYER, onPointClick);
      map.on("mouseenter", LOCATION_LAYER, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", LOCATION_LAYER, () => {
        map.getCanvas().style.cursor = "";
      });
      clickBoundRef.current = true;
    }
  }, [map, locations, choropleth]);

  return (
    <Suspense
      fallback={
        <div className="grid h-[560px] min-h-[520px] place-items-center rounded-xl bg-slate-100 text-sm text-slate-500">
          Loading barangay map…
        </div>
      }
    >
      <BarangayMap
        boundaries={boundaries}
        choropleth={choropleth}
        height="h-[560px] min-h-[520px]"
        ariaLabel="Bayawan City barangay animal monitoring map. Click a barangay to filter the monitoring table."
        showLabels
        labelShowCounts
        labelCountLabel="Animals monitored"
        showCredit
        cooperativeGestures
        selectedName={selectedName}
        selectedFeatureId={selectedFeatureId}
        onBarangayClick={onBarangayClick}
        onReset={onReset}
        onMapReady={handleMapReady}
        clickThroughLayers={[LOCATION_LAYER]}
        markerLayerIds={[LOCATION_LAYER]}
        markerLabel="Households"
      />
    </Suspense>
  );
}

/* -------------------------------------------------------------------------- */
/* Trend chart                                                               */
/* -------------------------------------------------------------------------- */

function TrendChart({ trend, loading, error, from, to, onFrom, onTo, onReset }) {
  const points = trend?.points ?? [];
  const max = Math.max(
    1,
    ...points.map((point) => Math.max(point.examinations, point.animals)),
  );

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Historical records</p>
          <h3 className="mt-1 font-display text-base font-bold text-slate-900">
            Health examination trends
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Examinations count records; animals count distinct households
            examined. One animal can account for several examinations.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="trend-from" className="block text-[11px] font-medium text-slate-600">
              From
            </label>
            <input
              id="trend-from"
              type="date"
              className="field mt-1 !w-auto !py-1.5 text-xs"
              value={from}
              max={to || todayIso()}
              onChange={(event) => onFrom(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="trend-to" className="block text-[11px] font-medium text-slate-600">
              To
            </label>
            <input
              id="trend-to"
              type="date"
              className="field mt-1 !w-auto !py-1.5 text-xs"
              value={to}
              min={from || undefined}
              max={todayIso()}
              onChange={(event) => onTo(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="rounded-pill px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            onClick={onReset}
          >
            Last 6 months
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-red-700">{error}</p>
      ) : loading ? (
        <div className="mt-4 h-44 animate-pulse rounded-xl bg-slate-100" />
      ) : points.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          No examinations in this date range.
        </p>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-4 text-[11px] text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-brand-700" />
              Examinations
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-earth-400" />
              Animals examined
            </span>
          </div>

          <div className="mt-3 flex h-48 items-end gap-2 overflow-x-auto border-b border-slate-200 pb-1">
            {points.map((point) => (
              <div
                key={point.period}
                className="flex min-w-[42px] flex-1 flex-col items-center justify-end gap-1"
                title={`${point.label}: ${point.examinations} examinations, ${point.animals} animals`}
              >
                <div className="flex h-36 items-end gap-1">
                  <div
                    className="w-3 rounded-t bg-brand-700"
                    style={{
                      height: `${Math.max(3, (point.examinations / max) * 100)}%`,
                    }}
                  />
                  <div
                    className="w-3 rounded-t bg-earth-400"
                    style={{
                      height: `${Math.max(3, (point.animals / max) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-[10px] font-medium text-slate-500">
                  {point.label}
                </span>
              </div>
            ))}
          </div>

          <table className="sr-only">
            <caption>Health examination trends by month</caption>
            <thead>
              <tr>
                <th>Month</th>
                <th>Examinations</th>
                <th>Animals examined</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.period}>
                  <td>{point.label}</td>
                  <td>{point.examinations}</td>
                  <td>{point.animals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Detail drawer                                                             */
/* -------------------------------------------------------------------------- */

function DetailDrawer({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm dark:bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Animal health details"
        className="absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
              Animal health monitoring
            </p>
            <h3 className="mt-0.5 font-display text-lg font-bold text-slate-900">
              Animal health details
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close animal health details"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-brand-50 hover:text-brand-700"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

function HealthDetail({ detail, loading, error, onClose, roleKey }) {
  const records = detail?.health_records ?? [];
  const cases = detail?.case_notes ?? [];
  const vaccinations = detail?.vaccination_history ?? [];
  const monitoring = detail?.monitoring_records ?? [];
  const visits = detail?.field_visits ?? [];
  const concerns = detail?.related_concerns ?? [];
  const search = encodeURIComponent(detail?.name_of_farmer ?? "");

  return (
    <DetailDrawer open={detail !== null} onClose={onClose}>
      {detail && (
        <div className="space-y-5 text-sm">
          {loading && <p className="text-xs text-slate-500">Loading health history…</p>}
          {error && <InlineAlert message={error} />}

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <HealthStatusBadge status={detail.health_status} />
                  {detail.needs_attention &&
                    detail.attention_reasons?.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-pill bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200"
                      >
                        {reason}
                      </span>
                    ))}
                </div>
                <p className="mt-2 font-display text-base font-bold text-slate-900">
                  {detail.name_of_farmer}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {detail.barangay}
                  {detail.purok ? ` · ${detail.purok}` : ""}
                  {detail.rsbsa_number ? ` · RSBSA ${detail.rsbsa_number}` : ""}
                  {detail.ear_tag_number ? ` · Ear tag ${detail.ear_tag_number}` : ""}
                </p>
              </div>
              <Link
                to={`/dashboard/${roleKey}/beneficiaries/${detail.beneficiary_id}/lineage`}
                className="btn-secondary !px-3 !py-1.5 text-xs"
              >
                Open household
              </Link>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
            <DetailRow
              label="Animal"
              value={`${detail.animal_type ?? "—"}${detail.sex ? ` (${detail.sex})` : ""}`}
            />
            <DetailRow label="Quantity" value={`${detail.quantity} head`} />
            <DetailRow label="Barangay" value={detail.barangay} />
            <DetailRow
              label="Last examination"
              value={formatDate(detail.last_examination_date)}
            />
            <DetailRow
              label="Confirmed outcome"
              value={detail.latest_outcome ?? "No confirmed diagnosis"}
            />
            <DetailRow
              label="Last monitoring visit"
              value={formatDate(detail.last_monitoring_date)}
            />
            <DetailRow
              label="Last field visit"
              value={formatDate(detail.last_field_visit_date)}
            />
            <DetailRow
              label="Vaccination"
              value={
                VACCINATION_STATUS[detail.status]?.label ?? detail.status ?? "—"
              }
            />
            <DetailRow
              label="Next vaccination due"
              value={formatDate(detail.next_due_date)}
            />
          </dl>

          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <p className="text-[10px] font-semibold tracking-wider text-amber-900 uppercase">
              Why this animal needs attention
            </p>
            {detail.attention_reasons?.length ? (
              <ul className="mt-2 grid grid-cols-1 gap-1 text-xs text-amber-900 sm:grid-cols-2">
                {detail.attention_reasons.map((reason) => (
                  <li key={reason} className="flex items-center gap-1.5">
                    <Icon name="alert-circle" className="h-3.5 w-3.5 shrink-0" />
                    {reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-amber-900">
                No overdue follow-up, unresolved clinical concern or overdue
                vaccination is currently recorded.
              </p>
            )}
            <p className="mt-2 text-[11px] text-amber-800">
              These are worklist signals from existing records, not a diagnosis.
            </p>
          </div>

          <section>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h4 className="font-display text-sm font-bold text-slate-900">
                  Confirmed clinical examinations
                </h4>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Diagnoses recorded in Health Records. Observations are listed
                  separately below.
                </p>
              </div>
              <Link
                to={`/dashboard/${roleKey}/health-records?search=${search}`}
                className="text-[11px] font-semibold text-brand-800 hover:underline"
              >
                Open Health Records
              </Link>
            </div>

            {records.length === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500">
                No clinical examination has been recorded.
              </p>
            ) : (
              <ol className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {records.map((record) => (
                  <li key={record.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-900">
                          {formatDate(record.date_recorded)}
                        </span>
                        <span
                          className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold ${
                            OUTCOME_TONES[record.outcome] ?? OUTCOME_TONES.referred
                          }`}
                        >
                          {record.outcome ?? "Open"}
                        </span>
                        {record.follow_up_on && (
                          <span
                            className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold ${
                              FOLLOW_UP_TONES[record.follow_up_status] ??
                              FOLLOW_UP_TONES.upcoming
                            }`}
                          >
                            Follow-up {formatDate(record.follow_up_on)}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {record.doctor?.name ?? "—"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-slate-900">
                      {record.diagnosis}
                    </p>
                    {record.symptoms && (
                      <p className="mt-1 text-xs text-slate-600">
                        <span className="font-semibold text-slate-700">Recorded observations:</span>{" "}
                        {record.symptoms}
                      </p>
                    )}
                    {record.treatment && (
                      <p className="mt-1 text-xs text-slate-600">
                        <span className="font-semibold text-slate-700">Treatment:</span>{" "}
                        {record.treatment}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h4 className="font-display text-sm font-bold text-slate-900">
                  Case observations
                </h4>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Documented observations from Case Notes — not confirmed
                  diagnoses.
                </p>
              </div>
              <Link
                to={`/dashboard/${roleKey}/case-notes?search=${search}`}
                className="text-[11px] font-semibold text-brand-800 hover:underline"
              >
                Open Case Notes
              </Link>
            </div>

            {cases.length === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500">
                No case observations are recorded.
              </p>
            ) : (
              <ol className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {cases.map((note) => (
                  <li key={note.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-900">
                          {note.reference_number ?? "Case"}
                        </span>
                        <span className="rounded-pill bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          {note.status === "resolved" ? "Resolved" : "Observation"}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {formatDate(note.date_reported)}
                        </span>
                      </div>
                      <Link
                        to={`/dashboard/${roleKey}/case-notes?search=${search}`}
                        className="text-[11px] font-semibold text-brand-800 hover:underline"
                      >
                        View case
                      </Link>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">
                      {note.body}
                    </p>
                    {note.actions_taken && (
                      <p className="mt-1 text-xs text-slate-600">
                        <span className="font-semibold text-slate-700">Actions:</span>{" "}
                        {note.actions_taken}
                      </p>
                    )}
                    {note.follow_up_on && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Follow-up {formatDate(note.follow_up_on)} ·{" "}
                        {note.follow_up_status ?? "scheduled"}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <section className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-display text-sm font-semibold text-slate-900">
                  Vaccination history
                </h4>
                <Link
                  to={`/dashboard/${roleKey}/vaccination-schedule?search=${search}`}
                  className="text-[11px] font-semibold text-brand-800 hover:underline"
                >
                  Open schedule
                </Link>
              </div>
              {vaccinations.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">No completed dose recorded.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {vaccinations.map((vaccination) => (
                    <li key={vaccination.id} className="text-xs text-slate-600">
                      <span className="font-semibold text-slate-800">
                        {formatDate(vaccination.administered_on)}
                      </span>{" "}
                      · {vaccination.vaccine_name}
                      {vaccination.quantity > 1 ? ` · ${vaccination.quantity} head` : ""}
                      {vaccination.technician?.name
                        ? ` · ${vaccination.technician.name}`
                        : ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-display text-sm font-semibold text-slate-900">
                  Field visits
                </h4>
                <Link
                  to={`/dashboard/${roleKey}/field-visits?search=${search}`}
                  className="text-[11px] font-semibold text-brand-800 hover:underline"
                >
                  Open visits
                </Link>
              </div>
              {visits.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">No field visits recorded.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {visits.map((visit) => (
                    <li key={visit.id} className="text-xs text-slate-600">
                      <span className="font-semibold text-slate-800">
                        {formatDate(visit.visited_on)}
                      </span>{" "}
                      · {visit.purpose?.replace("-", " ") ?? "visit"}
                      {visit.notes ? ` — ${visit.notes}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {monitoring.length > 0 && (
            <section>
              <h4 className="font-display text-sm font-semibold text-slate-900">
                Monitoring visits
              </h4>
              <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {monitoring.map((record) => (
                  <li key={record.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
                    <span className="font-semibold text-slate-800">
                      {formatDate(record.date_monitored)}
                    </span>
                    <span className="text-slate-500">
                      {record.technician ?? "—"}
                      {record.bcs ? ` · BCS ${record.bcs}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {concerns.length > 0 && (
            <section className="rounded-xl border border-slate-200 p-4">
              <h4 className="font-display text-sm font-semibold text-slate-900">
                Related health concerns
              </h4>
              <ul className="mt-2 space-y-2">
                {concerns.map((concern) => (
                  <li key={`${concern.type}-${concern.id}`} className="text-xs text-slate-600">
                    <span
                      className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold ${
                        concern.is_diagnosis
                          ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-800"
                      }`}
                    >
                      {concern.is_diagnosis ? "Confirmed diagnosis" : "Recorded observation"}
                    </span>{" "}
                    <span className="font-medium text-slate-800">{concern.title}</span>{" "}
                    · {formatDate(concern.date)}
                    {concern.follow_up_on
                      ? ` · follow-up ${formatDate(concern.follow_up_on)} (${concern.follow_up_status})`
                      : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-[11px] text-slate-400">
            This drawer is read-only. Record or correct clinical information in
            the module that owns it.
          </p>
        </div>
      )}
    </DetailDrawer>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function AnimalHealthPage({ roleKey = "technician" }) {
  const config = getRole(roleKey);
  const [params, setParams] = useSearchParams();
  const [barangays] = useBarangays();
  const boundaries = useBarangayBoundaries();

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mapData, setMapData] = useState({ barangays: [], locations: [] });
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState(null);
  const [trend, setTrend] = useState(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState(null);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const [trendFrom, setTrendFrom] = useState(() => monthStart(5));
  const [trendTo, setTrendTo] = useState(() => todayIso());

  const searchTerm = params.get("search") ?? "";
  const statusFilter = params.get("status") ?? "all";
  const barangayFilter = params.get("barangay") ?? "";
  const fromFilter = params.get("from") ?? "";
  const toFilter = params.get("to") ?? "";
  const sort = params.get("sort") ?? "urgency";
  const direction = params.get("direction") ?? "asc";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const perPage = Number(params.get("per_page") ?? "15") || 15;

  const updateParams = useCallback(
    (updates, { resetPage = true } = {}) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);

          for (const [key, value] of Object.entries(updates)) {
            if (value === null || value === undefined || value === "") next.delete(key);
            else next.set(key, String(value));
          }

          if (resetPage) next.delete("page");

          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const [searchInput, setSearchInput] = useState(searchTerm);
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if ((params.get("search") ?? "") === debouncedSearch) return;
    updateParams({ search: debouncedSearch || null });
  }, [debouncedSearch, params, updateParams]);

  useEffect(() => {
    if (searchTerm === searchInput) return;
    setSearchInput(searchTerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const filters = useMemo(
    () => ({
      search: searchTerm || undefined,
      status: statusFilter !== "all" ? statusFilter : undefined,
      barangay: barangayFilter || undefined,
      from: fromFilter || undefined,
      to: toFilter || undefined,
      sort,
      direction,
    }),
    [searchTerm, statusFilter, barangayFilter, fromFilter, toFilter, sort, direction],
  );

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);

      try {
        const [rowsResult, summaryResult] = await Promise.all([
          animalHealthApi.list({ ...filters, per_page: perPage, page }),
          animalHealthApi.summary().catch(() => null),
        ]);

        setRows(rowsResult?.data ?? []);
        setMeta(rowsResult?.meta ?? null);
        if (summaryResult) setSummary(summaryResult);
      } catch (err) {
        if (!quiet) setError(getErrorMessage(err));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [filters, perPage, page],
  );

  useEffect(() => {
    load();
  }, [load]);

  useAutoRefresh(load);

  const loadMap = useCallback(async (quiet = false) => {
    if (!quiet) setMapLoading(true);
    setMapError(null);

    try {
      setMapData(await animalHealthApi.map());
    } catch (err) {
      if (!quiet) setMapError(getErrorMessage(err));
    } finally {
      if (!quiet) setMapLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMap();
  }, [loadMap]);

  useEffect(() => {
    let active = true;
    setTrendLoading(true);
    setTrendError(null);

    animalHealthApi
      .trends({ from: trendFrom || undefined, to: trendTo || undefined })
      .then((result) => {
        if (active) setTrend(result);
      })
      .catch((err) => {
        if (active) setTrendError(getErrorMessage(err));
      })
      .finally(() => {
        if (active) setTrendLoading(false);
      });

    return () => {
      active = false;
    };
  }, [trendFrom, trendTo]);

  const mapRows = useMemo(
    () =>
      (mapData.barangays ?? []).map((barangay) => ({
        ...barangay,
        pins: barangay.animals,
      })),
    [mapData],
  );

  const choropleth = useMemo(() => {
    if (boundaries.status !== "ready") return null;
    return buildChoropleth(boundaries.collection, mapRows, { metric: "pins" });
  }, [boundaries, mapRows]);

  const selectedFeatureId = useMemo(() => {
    if (!barangayFilter || !choropleth) return null;
    const feature = choropleth.collection.features.find(
      (candidate) =>
        normalizeBarangayName(candidate.properties?.name) ===
        normalizeBarangayName(barangayFilter),
    );
    return feature?.id ?? null;
  }, [barangayFilter, choropleth]);

  const hasFilters = Boolean(
    searchTerm ||
      statusFilter !== "all" ||
      barangayFilter ||
      fromFilter ||
      toFilter,
  );

  function clearFilters() {
    setSearchInput("");
    updateParams({
      search: null,
      status: null,
      barangay: null,
      from: null,
      to: null,
    });
  }

  function chooseStatus(status) {
    setSearchInput("");
    updateParams({
      search: null,
      status,
      barangay: null,
      from: null,
      to: null,
    });
  }

  function chooseBarangay(name) {
    if (!name) {
      updateParams({ barangay: null });
      return;
    }

    const canonical =
      barangays.find(
        (barangay) =>
          normalizeBarangayName(barangay.name) === normalizeBarangayName(name),
      )?.name ?? name;

    updateParams({ barangay: canonical });
  }

  async function openDetail(beneficiaryId) {
    setDetail({ id: beneficiaryId });
    setDetailError(null);
    setDetailLoading(true);

    try {
      setDetail(await animalHealthApi.get(beneficiaryId));
    } catch (err) {
      setDetailError(getErrorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  }

  function rowMenuItems(row) {
    const search = encodeURIComponent(row.name_of_farmer);

    return [
      { label: "View details", onClick: () => openDetail(row.id) },
      {
        label: "Open household",
        to: `/dashboard/${roleKey}/beneficiaries/${row.id}/lineage`,
      },
      {
        label: "Health records",
        to: `/dashboard/${roleKey}/health-records?search=${search}`,
      },
      {
        label: "Vaccination schedule",
        to: `/dashboard/${roleKey}/vaccination-schedule?search=${search}`,
      },
      {
        label: "Case notes",
        to: `/dashboard/${roleKey}/case-notes?search=${search}`,
      },
      {
        label: "Field visits",
        to: `/dashboard/${roleKey}/field-visits?search=${search}`,
      },
    ];
  }

  const overview = [
    {
      key: "total",
      label: "Animals monitored",
      value: summary.total_animals,
      hint:
        summary.total_quantity && summary.total_quantity !== summary.total_animals
          ? `${summary.total_quantity} head across these households`
          : "households in the monitoring rollup",
      active: !hasFilters,
      onClick: clearFilters,
    },
    {
      key: "healthy",
      label: "Healthy",
      value: summary.healthy_animals,
      hint: "latest examination recovered",
      active: statusFilter === "healthy",
      onClick: () => chooseStatus("healthy"),
    },
    {
      key: "observation",
      label: "Under observation",
      value: summary.observation_animals,
      hint: "open case observations",
      active: statusFilter === "observation",
      onClick: () => chooseStatus("observation"),
    },
    {
      key: "attention",
      label: "Requiring attention",
      value: summary.attention_animals,
      hint:
        (summary.overdue_follow_ups ?? 0) > 0
          ? `${summary.overdue_follow_ups} overdue follow-up${summary.overdue_follow_ups === 1 ? "" : "s"}`
          : "unresolved concerns or overdue vaccination",
      active: statusFilter === "attention",
      onClick: () => chooseStatus("attention"),
    },
  ];

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{config?.label ?? "Technician"}</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Animal Health Monitoring
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              A centralized view of livestock and poultry health across Bayawan
              City. Monitoring facts are read from Beneficiaries, Health
              Records, Vaccination Schedule, Case Notes and Field Visits — never
              duplicated here.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              <Icon name="activity" className="h-3.5 w-3.5" />
              Read-only monitoring
            </span>
            <span className="mt-1 block">
              Add or correct records in the owning module.
            </span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {overview.map((card) => (
            <button
              key={card.key}
              type="button"
              aria-pressed={card.active}
              onClick={card.onClick}
              className={`${CARD} ${card.active ? ACTIVE_CARD : ""}`}
            >
              <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
                {card.label}
              </p>
              <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {card.value ?? "—"}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">{card.hint}</p>
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <InfoChip
            icon="alert-circle"
            tone="red"
            label={`${summary.open_concerns ?? 0} open clinical concern${summary.open_concerns === 1 ? "" : "s"}`}
          />
          <InfoChip
            icon="calendar"
            tone="amber"
            label={`${summary.overdue_follow_ups ?? 0} overdue follow-up${summary.overdue_follow_ups === 1 ? "" : "s"}`}
          />
          {(summary.unrecorded_animals ?? 0) > 0 && (
            <InfoChip
              icon="info"
              tone="slate"
              label={`${summary.unrecorded_animals} without an examination`}
            />
          )}
          {summary.attention_animals > 0 && (
            <button
              type="button"
              onClick={() => chooseStatus("attention")}
              className="ml-auto rounded-pill bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
            >
              Review attention list
            </button>
          )}
        </div>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="animal-health-search" className="sr-only">
              Search animal health
            </label>
            <div className="relative">
              <Icon
                name="search"
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                id="animal-health-search"
                type="search"
                className="field !pl-9"
                placeholder="Search farmer, RSBSA, ear tag, barangay, diagnosis…"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
          </div>

          <div>
            <label htmlFor="animal-health-status" className="sr-only">
              Health status
            </label>
            <select
              id="animal-health-status"
              className="field !w-auto"
              value={statusFilter}
              onChange={(event) =>
                updateParams({
                  status: event.target.value === "all" ? null : event.target.value,
                })
              }
            >
              <option value="all">All health statuses</option>
              <option value="attention">Needs attention</option>
              <option value="observation">Under observation</option>
              <option value="healthy">Healthy</option>
              <option value="unrecorded">No examination</option>
            </select>
          </div>

          <div>
            <label htmlFor="animal-health-barangay" className="sr-only">
              Barangay
            </label>
            <select
              id="animal-health-barangay"
              className="field !w-auto"
              value={barangayFilter}
              onChange={(event) => chooseBarangay(event.target.value)}
            >
              <option value="">All barangays</option>
              {barangays.map((barangay) => (
                <option key={barangay.name} value={barangay.name}>
                  {barangay.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="animal-health-from" className="sr-only">
              Examination from
            </label>
            <input
              id="animal-health-from"
              type="date"
              className="field !w-auto"
              value={fromFilter}
              max={toFilter || todayIso()}
              onChange={(event) => updateParams({ from: event.target.value || null })}
              aria-label="Examination from"
            />
          </div>

          <div>
            <label htmlFor="animal-health-to" className="sr-only">
              Examination to
            </label>
            <input
              id="animal-health-to"
              type="date"
              className="field !w-auto"
              value={toFilter}
              min={fromFilter || undefined}
              max={todayIso()}
              onChange={(event) => updateParams({ to: event.target.value || null })}
              aria-label="Examination to"
            />
          </div>

          <div>
            <label htmlFor="animal-health-sort" className="sr-only">
              Sort
            </label>
            <select
              id="animal-health-sort"
              className="field !w-auto"
              value={`${sort}:${direction}`}
              onChange={(event) => {
                const [nextSort, nextDirection] = event.target.value.split(":");
                updateParams({ sort: nextSort, direction: nextDirection });
              }}
            >
              <option value="urgency:asc">Most urgent first</option>
              <option value="name:asc">Farmer A–Z</option>
              <option value="barangay:asc">Barangay A–Z</option>
              <option value="examination:desc">Newest examination</option>
              <option value="examination:asc">Oldest examination</option>
              <option value="status:asc">Health status</option>
            </select>
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-pill px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              Clear
            </button>
          )}
        </div>

        {loading ? (
          <SkeletonList rows={4} rowClassName="h-14" />
        ) : rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "No animals match" : "No animals yet"}
            description={
              hasFilters
                ? "Clear the filters or choose another barangay."
                : "Animals appear here once beneficiaries are registered."
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-700">
                {meta?.total ?? rows.length}{" "}
                {(meta?.total ?? rows.length) === 1 ? "animal" : "animals"}
              </span>
              {barangayFilter && (
                <span>
                  Barangay: <strong className="text-slate-700">{barangayFilter}</strong>
                </span>
              )}
              {statusFilter !== "all" && (
                <span>
                  Status:{" "}
                  <strong className="text-slate-700">
                    {HEALTH_STATUS[statusFilter]?.label ?? statusFilter}
                  </strong>
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left text-xs">
                <thead className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Beneficiary
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Animal
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Barangay
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Current health
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Last examination
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Attention
                    </th>
                    <th scope="col" className="w-12 px-4 py-2.5 text-right font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.id} className="align-top transition hover:bg-brand-50/30">
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => openDetail(row.id)}
                          className="text-left font-semibold text-slate-900 hover:text-brand-800 hover:underline"
                        >
                          {row.name_of_farmer}
                        </button>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {row.rsbsa_number ?? row.ear_tag_number ?? "No registry ID"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {row.animal_type}
                        {row.sex ? ` (${row.sex})` : ""}
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {row.quantity ?? 1} head
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {row.barangay ?? row.address}
                      </td>
                      <td className="px-4 py-2.5">
                        <HealthStatusBadge status={row.health_status} />
                        <span
                          className={`mt-1 block text-[10px] font-medium ${
                            VACCINATION_STATUS[row.status]?.tone ?? "text-slate-500"
                          }`}
                        >
                          {VACCINATION_STATUS[row.status]?.label ?? row.status}
                        </span>
                        {row.latest_case_status &&
                          row.latest_case_status !== "resolved" && (
                            <span className="mt-0.5 block text-[10px] text-slate-500">
                              Case observation open
                            </span>
                          )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {row.last_examination_date ? (
                          <>
                            {formatDate(row.last_examination_date)}
                            <span className="mt-0.5 block max-w-[12rem] truncate text-[10px] text-slate-500">
                              Confirmed: {row.latest_diagnosis ?? "—"}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-400">No examination</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.attention_reasons?.length ? (
                          <div className="flex max-w-[15rem] flex-wrap gap-1">
                            {row.attention_reasons.map((reason) => (
                              <span
                                key={reason}
                                className="rounded-pill bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                        {row.open_concerns > 0 && (
                          <span className="mt-1 block text-[10px] text-slate-500">
                            {row.open_concerns} open clinical record
                            {row.open_concerns === 1 ? "" : "s"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <ActionMenu
                          label={`Actions for ${row.name_of_farmer}`}
                          items={rowMenuItems(row)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationFooter
              meta={meta}
              shown={rows.length}
              noun="animal"
              onPageChange={(nextPage) =>
                updateParams({ page: nextPage <= 1 ? null : nextPage }, { resetPage: false })
              }
              pageSize={perPage}
              pageSizeOptions={[15, 25, 50]}
              onPageSizeChange={(size) => updateParams({ per_page: size })}
            />
          </>
        )}
      </section>

      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Bayawan City</p>
            <h3 className="mt-1 font-display text-base font-bold text-slate-900">
              Barangay health map
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Colours and labels show monitored animals per barangay. Click a
              barangay to filter the table; click a household pin to open its
              health details.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-700" /> Needs attention
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-700" /> Observation
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-brand-700" /> Healthy
            </span>
          </div>
        </div>

        {mapError ? (
          <div className="mt-4">
            <InlineAlert message={mapError} />
          </div>
        ) : mapLoading ? (
          <div className="mt-4 h-[560px] animate-pulse rounded-xl bg-slate-100" />
        ) : (
          <div className="mt-4">
            <AnimalHealthMap
              boundaries={boundaries}
              choropleth={choropleth}
              locations={mapData.locations ?? []}
              selectedName={barangayFilter || null}
              selectedFeatureId={selectedFeatureId}
              onBarangayClick={chooseBarangay}
              onReset={() => updateParams({ barangay: null })}
              onSelectLocation={openDetail}
            />
            {barangayFilter && (
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                <span>
                  Showing <strong>{barangayFilter}</strong> · {meta?.total ?? 0} animal
                  {(meta?.total ?? 0) === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  onClick={() => updateParams({ barangay: null })}
                  className="font-semibold text-brand-800 hover:underline"
                >
                  Clear barangay
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <TrendChart
        trend={trend}
        loading={trendLoading}
        error={trendError}
        from={trendFrom}
        to={trendTo}
        onFrom={setTrendFrom}
        onTo={setTrendTo}
        onReset={() => {
          setTrendFrom(monthStart(5));
          setTrendTo(todayIso());
        }}
      />

      <HealthDetail
        detail={detail}
        loading={detailLoading}
        error={detailError}
        onClose={() => setDetail(null)}
        roleKey={roleKey}
      />
    </div>
  );
}

function InfoChip({ icon, tone, label }) {
  const tones = {
    red: "bg-red-50 text-red-700 ring-red-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    slate: "bg-slate-50 text-slate-600 ring-slate-200",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[11px] font-semibold ring-1 ${
        tones[tone] ?? tones.slate
      }`}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
