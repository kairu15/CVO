import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { mapApi } from "../api/mapApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage } from "../api/client";
import {
  buildChoropleth,
  normalizeBarangayName,
  QUALITY_STOPS,
  SEQUENTIAL_STOPS,
} from "../lib/barangayBoundaries";
import { FLOW_LAYER_IDS } from "../lib/mapFlows";
import { useBarangayBoundaries } from "../hooks/useBarangayBoundaries";
import { fetchAnimalTrail } from "../lib/ownershipPath";
import { DispersalMap } from "../components/DispersalMap";
import { BarangayMap } from "../components/BarangayMap";
import { BarangayRecordsPanel } from "../components/BarangayRecordsPanel";
import { DispersalDialog } from "../components/DispersalDialog";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import {
  FilterField,
  FilterFooter,
  FilterToolbar,
} from "../components/FilterToolbar";
import { InlineAlert } from "../components/InlineAlert";
import { Modal } from "../components/Modal";
import { SkeletonList } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

/**
 * "Dispersal Map" — the animals of the program on the shared barangay
 * choropleth, viewed BY DATE. The map is the page: household clusters answer
 * where beneficiaries are, polygons answer how many animals are in each
 * barangay, and a docked inspector opens only when a barangay is selected.
 *
 * URL state (shareable): date, mode, barangay, species, pin view, movements,
 * data-quality view. The heavier snapshot is only refetched when the dates
 * endpoint's active-event version changes.
 */

const DateSelector = lazy(() => import("../components/DateSelector"));

const MAP_CLICK_THROUGH = [
  "cvo-date-pins-clusters",
  "cvo-date-pins-point",
  "cvo-date-pins-spider-point",
  ...FLOW_LAYER_IDS,
];
const MAP_LEGEND = {
  stops: SEQUENTIAL_STOPS,
  minLabel: "fewer animals",
  maxLabel: "more",
};
const QUALITY_LEGEND = {
  stops: QUALITY_STOPS,
  minLabel: "fewer approximate pins",
  maxLabel: "more",
};

const MODES = [
  {
    key: "on",
    label: "On this date",
    help: "The animals that arrived or moved on that day.",
  },
  {
    key: "as_of",
    label: "As of this date",
    help: "Every animal's situation at the end of that day, from its latest event on or before it.",
  },
];

function formatDay(iso) {
  if (!iso) return "—";
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatFreshness(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

/** One household pin per beneficiary, so city-wide pins do not overplot. */
function aggregateHouseholds(pins) {
  const groups = new Map();

  for (const pin of pins) {
    const ownerId = pin.owner?.id;
    if (ownerId === null || ownerId === undefined) continue;

    const key = String(ownerId);
    let row = groups.get(key);
    if (!row) {
      row = {
        ...pin,
        animal_id: -Number(ownerId),
        household_id: Number(ownerId),
        household: true,
        animal_count: 0,
        animal_types: new Set(),
        animal_status: "active",
        event_type: pin.event_type,
        approximate: false,
      };
      groups.set(key, row);
    }

    row.animal_count += 1;
    row.animal_types.add(pin.animal_type ?? "Unspecified");
    // A household is exact if ANY of its animals has an exact pin; the
    // coordinates are the owner's, so mixed flags would be misleading.
    if (!pin.approximate) row.approximate = false;
    if (pin.owner?.label) row.owner = pin.owner;
    if (pin.barangay) row.barangay = pin.barangay;
    if (pin.latitude !== null && pin.longitude !== null) {
      row.latitude = pin.latitude;
      row.longitude = pin.longitude;
    }
    if (pin.last_event_date && (!row.last_event_date || pin.last_event_date >= row.last_event_date)) {
      row.last_event_date = pin.last_event_date;
      row.last_event_id = pin.last_event_id;
      row.event_type = pin.event_type;
      row.location_source = pin.location_source;
    }
  }

  return [...groups.values()].map((row) => ({
    ...row,
    animal_types: [...row.animal_types],
    animal_type: "Household",
  }));
}

function Metric({ label, value, hint, onClick, active = false }) {
  const content = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] leading-tight text-slate-500">{hint}</p>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`min-h-[72px] p-3 text-left transition hover:bg-brand-50/70 ${active ? "bg-brand-50" : "bg-white"}`}
      >
        {content}
      </button>
    );
  }

  return <div className="min-h-[72px] bg-white p-3">{content}</div>;
}

export default function DispersalMapPage({ roleKey }) {
  const { user } = useAuth();
  const online = useOnlineStatus();
  const boundaries = useBarangayBoundaries();

  const [params, setParams] = useSearchParams();

  /* ---------------- URL-stored state (shareable views) ----------------- */

  const dateParam = params.get("date") ?? "";
  const modeParam = params.get("mode");
  const mode = modeParam === "as_of" ? "as_of" : "on";
  const barangayFilter = params.get("barangay") ?? "";
  const animalType = params.get("animal_type") ?? "";
  const pinView = params.get("pins") === "animals" ? "animals" : "households";
  const movementsOn = params.get("movements") === "1";
  const qualityOn = params.get("quality") === "1";
  const householdView = pinView === "households";

  const updateParams = useCallback(
    (patch) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === "" || value === null || value === undefined) next.delete(key);
            else next.set(key, String(value));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  /* ------------------------------ data -------------------------------- */

  const [datesData, setDatesData] = useState(null);
  const [datesError, setDatesError] = useState(null);
  const latestKnownRef = useRef(null);
  const [newerDate, setNewerDate] = useState(null);

  const [snapshot, setSnapshot] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const snapshotRef = useRef(null);

  const snapshotAbortRef = useRef(null);
  const snapshotTokenRef = useRef(0);

  const dates = useMemo(() => datesData?.dates ?? [], [datesData]);
  const selectedDate = dateParam || dates[0]?.date || null;

  const dateParamRef = useRef(dateParam);
  dateParamRef.current = dateParam;

  const loadDates = useCallback(
    async (quiet = false) => {
      if (!quiet) setDatesError(null);

      try {
        const data = await mapApi.dates({ perPage: 60 });
        setDatesData(data);

        const latest = data.dates?.[0]?.date ?? null;
        const previousLatest = latestKnownRef.current;
        if (latest !== null) {
          if (previousLatest !== null && latest > previousLatest) {
            const currentParam = dateParamRef.current;
            const selected = currentParam || previousLatest;
            if (!currentParam || selected >= previousLatest) {
              latestKnownRef.current = latest;
              updateParams({ date: latest });
              setNewerDate(null);
            } else {
              setNewerDate(latest);
            }
          } else {
            latestKnownRef.current = latest;
          }
        }
      } catch (err) {
        if (!quiet) setDatesError(getErrorMessage(err));
      }
    },
    [updateParams],
  );

  const loadSnapshot = useCallback(
    async (quiet = false) => {
      if (!quiet) {
        snapshotAbortRef.current?.abort();
        snapshotAbortRef.current = new AbortController();
      }
      const controller = snapshotAbortRef.current ?? new AbortController();
      const token = ++snapshotTokenRef.current;

      if (!quiet) setSnapshotLoading(true);
      setSnapshotError(null);

      try {
        const data = await mapApi.pins({
          date: selectedDate || undefined,
          mode,
          animalType: animalType || undefined,
          signal: controller.signal,
        });
        if (token !== snapshotTokenRef.current) return;

        snapshotRef.current = data;
        setSnapshot(data);
        setFetchedAt(new Date());
        setSnapshotLoading(false);
      } catch (err) {
        if (token !== snapshotTokenRef.current) return;
        if (err?.name === "AbortError" || err?.code === "ERR_CANCELED") return;

        if (!quiet) setSnapshotLoading(false);
        setSnapshotError(getErrorMessage(err));
      }
    },
    [selectedDate, mode, animalType],
  );

  const loadSnapshotRef = useRef(loadSnapshot);
  useEffect(() => {
    loadSnapshotRef.current = loadSnapshot;
  }, [loadSnapshot]);

  useEffect(() => {
    loadDates();
  }, [loadDates]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  // The dates endpoint is cheap and carries the active-event version. Poll
  // ONLY that at the map's idle cadence (60s); fetch the heavier snapshot
  // only when the version changes.
  useAutoRefresh(loadDates, { interval: 60_000 });
  const dataVersion = datesData?.version ?? null;
  useEffect(() => {
    if (!dataVersion || !snapshotRef.current) return;
    loadSnapshotRef.current?.(true);
  }, [dataVersion]);

  const [dispersal, setDispersal] = useState(null);
  const [notice, setNotice] = useState(null);
  const [trailRefresh, setTrailRefresh] = useState({ token: 0 });
  const [showMissing, setShowMissing] = useState(false);
  const mapInstanceRef = useRef(null);
  const [focusOwnerId, setFocusOwnerId] = useState(null);
  const [focusOwnerName, setFocusOwnerName] = useState("");
  const [clipboardNotice, setClipboardNotice] = useState(false);

  const role = roleKey ?? user?.role;
  const isTechnician = role === "technician";
  const canDisperse = role === "admin" || role === "technician";

  const pins = useMemo(() => snapshot?.pins ?? [], [snapshot]);
  const barangayRows = useMemo(() => snapshot?.barangays ?? [], [snapshot]);
  const skippedNoLocation = snapshot?.skipped_no_location ?? 0;
  const unlocated = useMemo(() => snapshot?.unlocated ?? [], [snapshot]);
  const missingCount = unlocated.length || skippedNoLocation;
  const householdPins = useMemo(() => aggregateHouseholds(pins), [pins]);
  const mapPins = householdView ? householdPins : pins;
  const availableTypes = useMemo(() => {
    const listed = snapshot?.animal_types ?? [];
    if (listed.length > 0) return listed;
    return [...new Set(pins.map((pin) => pin.animal_type).filter(Boolean))].sort();
  }, [snapshot, pins]);

  const stats = useMemo(() => {
    const households = new Set(
      pins.map((pin) => pin.owner?.id).filter((id) => id !== null && id !== undefined),
    ).size;
    const reached = barangayRows.filter((row) => (row.pins ?? 0) > 0).length;
    const redispersals = pins.filter(
      (pin) => pin.event_type === "re_dispersal" || pin.event_type === "pass_on",
    ).length;
    const approximate = pins.filter((pin) => pin.approximate).length;
    return {
      animals: pins.length,
      households,
      reached,
      redispersals,
      approximate,
      missing: missingCount,
    };
  }, [pins, barangayRows, missingCount]);

  const choropleth = useMemo(() => {
    if (boundaries.status !== "ready") return null;
    return buildChoropleth(boundaries.collection, barangayRows, {
      metric: qualityOn ? "quality" : "pins",
    });
  }, [boundaries, barangayRows, qualityOn]);

  const movementFlows = useMemo(
    () => (movementsOn ? snapshot?.flows ?? [] : []),
    [movementsOn, snapshot],
  );

  /* -------------------- barangay records panel ------------------------ */

  const panelAnimals = useMemo(() => {
    if (!barangayFilter) return [];
    return pins.filter(
      (pin) => normalizeBarangayName(pin.barangay ?? "") === normalizeBarangayName(barangayFilter),
    );
  }, [pins, barangayFilter]);

  const [activeFlightAnimalId, setActiveFlightAnimalId] = useState(null);
  const controlsRef = useRef(null);
  const [clickedFeatureId, setClickedFeatureId] = useState(null);
  const urlFeatureId = useMemo(() => {
    if (!barangayFilter || !choropleth) return null;
    const feature = choropleth.collection.features.find(
      (candidate) =>
        normalizeBarangayName(candidate.properties?.name) ===
        normalizeBarangayName(barangayFilter),
    );
    return feature?.id ?? null;
  }, [barangayFilter, choropleth]);
  const selectedFeatureId = clickedFeatureId ?? urlFeatureId;

  useEffect(() => {
    controlsRef.current?.hideFlightPath();
  }, [barangayFilter]);

  const openDispersal = useCallback((pin) => {
    if (pin.owner?.id === null || pin.owner?.masked) return;
    setDispersal({
      mode: "re-disperse",
      beneficiary: {
        id: pin.owner.id,
        name_of_farmer: pin.owner.label,
        address: pin.barangay ?? "",
      },
    });
  }, []);

  const handleBarangayClick = useCallback(
    (name, event) => {
      const clear = barangayFilter === name || name === null;
      updateParams({ barangay: clear ? "" : name });
      setClickedFeatureId(clear ? null : (event?.features?.[0]?.id ?? null));
      setFocusOwnerId(null);
      setFocusOwnerName("");
    },
    [barangayFilter, updateParams],
  );

  const handleOpenHousehold = useCallback(
    (pin) => {
      if (!pin?.barangay) return;
      updateParams({ barangay: pin.barangay });
      setFocusOwnerId(pin.owner?.id ?? null);
      setFocusOwnerName(pin.owner?.label ?? "");
    },
    [updateParams],
  );

  const handleControlsReady = useCallback((api) => {
    controlsRef.current = api;
  }, []);
  const showFlightPath = useCallback((animalId) => {
    controlsRef.current?.showFlightPath(animalId);
  }, []);
  const hideFlightPath = useCallback(() => {
    controlsRef.current?.hideFlightPath();
  }, []);
  const handleFlightPathChange = useCallback((animalId) => {
    setActiveFlightAnimalId(animalId);
  }, []);
  const handleResetView = useCallback(() => {
    updateParams({ barangay: "" });
    setClickedFeatureId(null);
    setFocusOwnerId(null);
    setFocusOwnerName("");
  }, [updateParams]);

  const clearFilters = useCallback(() => {
    updateParams({ barangay: "", animal_type: "" });
    setClickedFeatureId(null);
    setFocusOwnerId(null);
    setFocusOwnerName("");
  }, [updateParams]);

  const download = useCallback((href, filename) => {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    anchor.click();
  }, []);

  const exportCsv = useCallback(() => {
    if (typeof URL?.createObjectURL !== "function") {
      setNotice("CSV export is not available in this browser.");
      return;
    }
    const header = [
      "animal_id",
      "ear_tag",
      "animal_type",
      "animal_status",
      "owner",
      "barangay",
      "latitude",
      "longitude",
      "location_source",
      "approximate",
      "event_type",
      "last_event_date",
    ];
    const rows = pins.map((pin) => [
      pin.animal_id,
      pin.ear_tag_number,
      pin.animal_type,
      pin.animal_status,
      pin.owner?.label,
      pin.barangay,
      pin.latitude,
      pin.longitude,
      pin.location_source,
      pin.approximate ? "yes" : "no",
      pin.event_type,
      pin.last_event_date,
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    download(url, `dispersal-map-${selectedDate ?? "snapshot"}.csv`);
    URL.revokeObjectURL(url);
    setNotice("Current map view exported as CSV.");
  }, [pins, selectedDate, download]);

  const exportMapPng = useCallback(() => {
    const canvas = mapInstanceRef.current?.getCanvas?.();
    if (!canvas?.toDataURL) {
      setNotice("The map image is not ready yet.");
      return;
    }
    try {
      download(canvas.toDataURL("image/png"), `dispersal-map-${selectedDate ?? "snapshot"}.png`);
      setNotice("Current map view exported as PNG.");
    } catch {
      setNotice("The map image could not be exported — use the CSV export instead.");
    }
  }, [selectedDate, download]);

  const copyViewLink = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText?.(window.location.href);
      setClipboardNotice(true);
      window.setTimeout(() => setClipboardNotice(false), 2500);
    } catch {
      setNotice("Could not copy the link — copy it from the address bar.");
    }
  }, []);

  /* ------------------------------ render ------------------------------ */

  const hasAnyData = dates.length > 0;
  const freshness = formatFreshness(snapshot?.generated_at) ?? (fetchedAt ? fetchedAt.toLocaleString() : null);

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Geo-Tagged Records</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Dispersal Map
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Bayawan City's barangays, the households that received animals, and
              each day's dispersal activity. Select a barangay for its records;
              open a household pin to focus its animals.
            </p>
          </div>
        </div>

        <div className="mt-5">
          <Suspense fallback={<div className="h-10 rounded-pill bg-slate-100" />}>
            <DateSelector
              dates={dates}
              selectedDate={selectedDate}
              onSelectDate={(value) => updateParams({ date: value })}
              mode={mode}
              onModeChange={(value) => updateParams({ mode: value })}
              latestDate={dates[0]?.date ?? null}
              onJumpToLatest={() => {
                updateParams({ date: dates[0]?.date ?? "" });
                setNewerDate(null);
              }}
            />
          </Suspense>
          <p className="mt-2 text-xs text-slate-500">
            {MODES.find((option) => option.key === mode)?.help}
          </p>
        </div>

        <FilterToolbar className="mt-4">
          <FilterField label="Animal type" htmlFor="map-animal-type">
            <select
              id="map-animal-type"
              className="field"
              value={animalType}
              onChange={(event) => updateParams({ animal_type: event.target.value })}
              aria-label="Filter map by animal type"
            >
              <option value="">All animal types</option>
              {availableTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Pin view">
            <div
              className="segment-group w-fit"
              role="group"
              aria-label="Pin view"
            >
              {[
                ["households", "Households"],
                ["animals", "Animals"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => updateParams({ pins: key === "households" ? "" : key })}
                  aria-pressed={pinView === key}
                  className={`segment-button transition ${
                    pinView === key
                      ? "bg-brand-700 text-white"
                      : "text-slate-600 hover:bg-brand-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </FilterField>

          <FilterField label="Overlays">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => updateParams({ movements: movementsOn ? "" : "1" })}
                aria-pressed={movementsOn}
                className={`inline-flex h-10 items-center gap-1.5 rounded-pill border px-3 text-xs font-semibold transition ${
                  movementsOn
                    ? "border-amber-500 bg-amber-50 text-amber-900"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Icon name="route" className="h-3.5 w-3.5" />
                Movements
              </button>

              <button
                type="button"
                onClick={() => updateParams({ quality: qualityOn ? "" : "1" })}
                aria-pressed={qualityOn}
                className={`inline-flex h-10 items-center gap-1.5 rounded-pill border px-3 text-xs font-semibold transition ${
                  qualityOn
                    ? "border-amber-500 bg-amber-50 text-amber-900"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Icon name="sliders" className="h-3.5 w-3.5" />
                Data quality
              </button>
            </div>
          </FilterField>

          <FilterFooter>
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={copyViewLink}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Icon name="map" className="h-3.5 w-3.5" />
              {clipboardNotice ? "Link copied" : "Copy view"}
            </button>
            <button
              type="button"
              onClick={exportMapPng}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Icon name="printer" className="h-3.5 w-3.5" />
              Map PNG
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Icon name="clipboard" className="h-3.5 w-3.5" />
              Export CSV
            </button>
            </div>
          </FilterFooter>
        </FilterToolbar>

        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Animals" value={stats.animals} hint="in this view" />
          <Metric label="Households" value={stats.households} hint="represented" />
          <Metric label="Barangays" value={stats.reached} hint="with animals" />
          <Metric label="Re-dispersals" value={stats.redispersals} hint="on this date" />
          <Metric
            label="Missing location"
            value={stats.missing}
            hint="needs a pin"
            onClick={stats.missing > 0 ? () => setShowMissing(true) : undefined}
          />
          <Metric
            label="Approximate"
            value={stats.approximate}
            hint="centroid pins"
            onClick={() => updateParams({ quality: qualityOn ? "" : "1" })}
            active={qualityOn}
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <span>
            {freshness ? `Data updated ${freshness}` : "Waiting for map data…"}
            {householdView ? " · household pins are clustered; badges count animals" : " · animal-level pins"}
          </span>
          {(barangayFilter || animalType) && (
            <span className="inline-flex flex-wrap items-center gap-2 rounded-pill bg-brand-50 px-3 py-1 font-semibold text-brand-800">
              <Icon name="map-pin" className="h-3.5 w-3.5" />
              {[
                selectedDate && `${mode === "as_of" ? "as of" : "on"} ${formatDay(selectedDate)}`,
                animalType,
                barangayFilter && `barangay ${barangayFilter}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              <button type="button" className="underline" onClick={clearFilters}>
                clear
              </button>
            </span>
          )}
        </div>
      </section>

      {newerDate && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-pill bg-brand-50 px-3.5 py-1.5 text-xs font-semibold text-brand-800">
            <Icon name="info" className="h-3.5 w-3.5" />
            New records on {formatDay(newerDate)}.
          </span>
          <button
            type="button"
            className="rounded-pill px-3 py-1.5 font-semibold text-brand-800 underline hover:bg-brand-50"
            onClick={() => {
              updateParams({ date: newerDate });
              setNewerDate(null);
            }}
          >
            Jump to latest
          </button>
        </div>
      )}

      {!snapshotLoading && !snapshotError && selectedDate && pins.length === 0 && dates.length > 0 && (
        <section className="card">
          {(() => {
            const selected = new Date(`${selectedDate}T00:00:00`).getTime();
            const nearest = [...dates].sort(
              (a, b) =>
                Math.abs(new Date(`${a.date}T00:00:00`).getTime() - selected) -
                Math.abs(new Date(`${b.date}T00:00:00`).getTime() - selected),
            )[0];

            return (
              <EmptyState
                title={`No dispersals recorded on ${formatDay(selectedDate)}`}
                description="Pick another date — the nearest one with records is suggested below."
                action={
                  nearest ? (
                    <button
                      type="button"
                      className="btn-secondary !px-3.5 !py-1.5 text-xs"
                      onClick={() => updateParams({ date: nearest.date })}
                    >
                      Jump to {formatDay(nearest.date)} · {nearest.event_count} event
                      {nearest.event_count === 1 ? "" : "s"}
                    </button>
                  ) : null
                }
              />
            );
          })()}
        </section>
      )}

      {datesError && (
        <div className="flex flex-wrap items-center gap-3">
          <InlineAlert message={datesError} onDismiss={() => setDatesError(null)} />
          <button type="button" onClick={() => loadDates()} className="btn-secondary !px-3.5 !py-1.5 text-xs">
            Try again
          </button>
        </div>
      )}

      {!online && fetchedAt && !snapshotLoading && (
        <InlineAlert
          tone="info"
          message={`You are offline — showing results loaded at ${fetchedAt.toLocaleTimeString()}.`}
        />
      )}

      {notice && (
        <InlineAlert
          tone="success"
          message={notice}
          onDismiss={() => setNotice(null)}
          autoDismiss={5000}
        />
      )}

      {!hasAnyData && !datesError && !datesData ? (
        <section className="card overflow-hidden">
          <SkeletonList rows={4} rowClassName="h-20" />
        </section>
      ) : !hasAnyData ? (
        <section className="card">
          <EmptyState
            title={isTechnician ? "No farmers assigned to you yet" : "Nothing to map yet"}
            description={
              isTechnician
                ? "You haven't been assigned any farmers. Contact an administrator to be assigned households to map."
                : "Record a dispersal and its date appears here, with the animal on the map."
            }
          />
        </section>
      ) : (
        <section className="space-y-3">
          <div
            className={`grid min-w-0 gap-4 ${
              barangayFilter ? "lg:grid-cols-[minmax(0,1fr)_380px]" : ""
            }`}
          >
            <div className="min-w-0 space-y-2">
              {snapshotError ? (
                <div className="card flex flex-col items-start gap-3 p-6">
                  <InlineAlert message={snapshotError} onDismiss={() => setSnapshotError(null)} />
                  <button
                    type="button"
                    onClick={() => loadSnapshot()}
                    className="btn-secondary !px-3.5 !py-1.5 text-xs"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <DispersalMap
                  pins={mapPins}
                  flightPathPins={pins}
                  trailFetcher={fetchAnimalTrail}
                  showTable={false}
                  showPins
                  householdView={householdView}
                  showPinFilters={false}
                  onOpenHousehold={handleOpenHousehold}
                  loading={snapshotLoading}
                  onRedisperse={canDisperse ? openDispersal : undefined}
                  onControlsReady={handleControlsReady}
                  onFlightPathChange={handleFlightPathChange}
                  selectedBarangay={barangayFilter || null}
                  refreshTrail={trailRefresh}
                  renderChoropleth={(onMapReady) => (
                    <BarangayMap
                      boundaries={boundaries}
                      choropleth={choropleth}
                      height="h-[72vh] min-h-[520px]"
                      beforeLayerId="cvo-date-pins-clusters"
                      cooperativeGestures
                      clickThroughLayers={MAP_CLICK_THROUGH}
                      onMapReady={(map) => {
                        mapInstanceRef.current = map;
                        onMapReady(map);
                      }}
                      preserveDrawingBuffer
                      selectedName={barangayFilter || null}
                      selectedFeatureId={selectedFeatureId}
                      onBarangayClick={handleBarangayClick}
                      onReset={handleResetView}
                      flows={movementFlows}
                      ariaLabel={`Map of Bayawan City's barangays with ${
                        householdView ? "household" : "animal"
                      } locations for ${selectedDate ? formatDay(selectedDate) : "no date"}.`}
                      legend={qualityOn ? QUALITY_LEGEND : MAP_LEGEND}
                      legendNotes={
                        <>
                          {qualityOn && (
                            <span className="text-amber-800">
                              Amber = approximate (barangay-centre) household pins
                            </span>
                          )}
                          {movementsOn && (
                            <span className="text-amber-800">
                              Dashed lines = selected-day movements
                            </span>
                          )}
                          {skippedNoLocation > 0 && (
                            <span className="text-slate-500">
                              {skippedNoLocation} animal{skippedNoLocation === 1 ? "" : "s"} with no location recorded
                            </span>
                          )}
                        </>
                      }
                      showLabels
                      labelShowCounts
                    />
                  )}
                />
              )}
              {selectedDate && !snapshotLoading && (
                <p className="text-xs text-slate-500">
                  Showing {pins.length} animal{pins.length === 1 ? "" : "s"}{" "}
                  {mode === "as_of" ? "as of" : "on"} {formatDay(selectedDate)}.
                  {householdView && ` ${householdPins.length} household pin${householdPins.length === 1 ? "" : "s"}.`}
                </p>
              )}
            </div>

            {barangayFilter && (
              <BarangayRecordsPanel
                barangay={barangayFilter}
                animals={panelAnimals}
                focusOwnerId={focusOwnerId}
                focusOwnerName={focusOwnerName}
                onClearFocus={() => {
                  setFocusOwnerId(null);
                  setFocusOwnerName("");
                }}
                activeFlightAnimalId={activeFlightAnimalId}
                onShowFlightPath={showFlightPath}
                onHideFlightPath={hideFlightPath}
                onRedisperse={canDisperse ? openDispersal : undefined}
                onClose={handleResetView}
                className="max-lg:fixed max-lg:inset-x-2 max-lg:bottom-0 max-lg:z-40 max-lg:max-h-[72vh] max-lg:rounded-b-none max-lg:shadow-2xl lg:h-[72vh] lg:max-h-none"
              />
            )}
          </div>
        </section>
      )}

      <Modal
        open={showMissing}
        title="Animals without a mapped location"
        onClose={() => setShowMissing(false)}
      >
        {unlocated.length === 0 ? (
          <p className="text-sm text-slate-600">
            {skippedNoLocation > 0
              ? `${skippedNoLocation} animal${skippedNoLocation === 1 ? "" : "s"} are missing a location, but the detail list was not returned by this snapshot.`
              : "Every animal in this view has a mapped location."}
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              These records cannot be pinned until the household or barangay has a valid coordinate.
            </p>
            <ul className="mt-3 divide-y divide-slate-100">
              {unlocated.map((row) => (
                <li key={row.animal_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="font-semibold text-slate-800">
                    {row.ear_tag_number ? `#${row.ear_tag_number}` : `Animal #${row.animal_id}`}
                    <span className="ml-2 font-normal text-slate-500">{row.animal_type ?? "Unspecified"}</span>
                  </span>
                  <span className="text-xs text-slate-500">
                    {row.owner?.label ?? "Unknown owner"} · {row.barangay ?? "No barangay"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Modal>

      <DispersalDialog
        open={dispersal !== null}
        mode={dispersal?.mode ?? "re-disperse"}
        beneficiary={dispersal?.beneficiary ?? null}
        onClose={() => setDispersal(null)}
        onSaved={async () => {
          setNotice("Ownership recorded — the map and the flight path now draw the recorded events.");
          await loadDates(true);
          await loadSnapshot(true);
          setTrailRefresh((prev) => ({ token: prev.token + 1 }));
        }}
      />
    </div>
  );
}
