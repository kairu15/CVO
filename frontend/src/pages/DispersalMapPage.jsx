import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { mapApi } from "../api/mapApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage } from "../api/client";
import {
  buildChoropleth,
  choroplethTooltipHtml,
  normalizeBarangayName,
} from "../lib/barangayBoundaries";
import { useBarangayBoundaries } from "../hooks/useBarangayBoundaries";
import { fetchAnimalTrail } from "../lib/ownershipPath";
import { DispersalMap } from "../components/DispersalMap";
import { BarangayChoropleth } from "../components/BarangayChoropleth";
import { DispersalDialog } from "../components/DispersalDialog";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { InlineAlert } from "../components/InlineAlert";
import { SkeletonList } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

/**
 * "Dispersal Map" — the animals of the program on the shared barangay
 * choropleth, viewed BY DATE: the newest date with records is selected by
 * default, and the pins + the polygons' counts follow the chosen date.
 *
 * Two date modes (the URL carries both):
 *   on     "On this date" — pins for the animals that arrived (or moved on)
 *          that day; an animal is pinned at its recipient that day.
 *   as_of  "As of this date" — every animal's state at the END of that day
 *          from its latest active event on or before it; an animal
 *          re-dispersed later still sits at its earlier owner here.
 *
 * The trail a pin draws is the ANIMAL's OWNERSHIP CHAIN (its own flight
 * path), and recording happens through the one shared DispersalDialog opened
 * from a pin's "Re-disperse" action. Live polling keeps the latest date
 * fresh without ever dragging the user off the date they picked.
 */

// The map bundle (MapLibre GL) is heavy — load it only when the tab opens.
const DateSelector = lazy(() => import("../components/DateSelector"));

const MODES = [
  {
    key: "on",
    label: "On this date",
    help: "Pins for the animals that arrived or moved on that day.",
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

  // The dates with records (newest first) — polled, so a handover recorded
  // elsewhere adds its date without a manual reload.
  const [datesData, setDatesData] = useState(null);
  const [datesError, setDatesError] = useState(null);
  const latestKnownRef = useRef(null); // the newest date we have shown the user
  const [newerDate, setNewerDate] = useState(null); // "new records on …" chip

  // The snapshot for the selected date + mode. Aborted and re-fetched when
  // either changes quickly: a slow earlier response must never overwrite a
  // newer one, and the pins must never blank out between dates.
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);

  const snapshotAbortRef = useRef(null);
  const snapshotTokenRef = useRef(0);

  const dates = useMemo(() => datesData?.dates ?? [], [datesData]);
  // No ?date in the URL means the DEFAULT: the newest date that has records
  // (never "today" — today may be empty). It arrives with the dates list.
  const selectedDate = dateParam || dates[0]?.date || null;

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
            const selected = dateParam || previousLatest;
            if (!dateParam || selected >= previousLatest) {
              // The user is sitting on the latest date (or none): follow the
              // new records instead of leaving them behind.
              latestKnownRef.current = latest;
              updateParams({ date: latest });
              setNewerDate(null);
            } else {
              // Viewing history: never drag them forward, just offer it.
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
    [dateParam, updateParams],
  );

  const loadSnapshot = useCallback(
    async (quiet = false) => {
      // A quick date flip must not let an earlier response land last: a
      // user-driven fetch ABORTS the one before it, and a token guards the
      // race the signal cannot close. A quiet POLL never aborts — under a
      // slow backend, aborting each poll's predecessor would livelock and
      // no snapshot would ever complete; the token alone discards whatever
      // stale answer lands out of order.
      if (!quiet) {
        snapshotAbortRef.current?.abort();
        snapshotAbortRef.current = new AbortController();
      }
      const controller = snapshotAbortRef.current ?? new AbortController();
      const token = ++snapshotTokenRef.current;

      if (!quiet) setSnapshotLoading(true);
      setSnapshotError(null);

      try {
        // selectedDate (not the raw param): with no ?date in the URL the
        // DEFAULT is the newest date that has records, which arrives with
        // the dates list — the snapshot then follows it.
        const data = await mapApi.pins({
          date: selectedDate || undefined,
          mode,
          signal: controller.signal,
        });
        if (token !== snapshotTokenRef.current) return;

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
    [selectedDate, mode],
  );

  useEffect(() => {
    loadDates();
  }, [loadDates]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  // Quietly re-fetch so handovers registered elsewhere appear without a
  // manual reload.
  useAutoRefresh(loadDates);
  useAutoRefresh(loadSnapshot);

  // The shared dialog state: `{ mode, beneficiary }` while open, null closed.
  const [dispersal, setDispersal] = useState(null);
  const [notice, setNotice] = useState(null);
  // Bumped after every recorded handover so an OPEN flight path refetches
  // itself — a saved event is immediately part of the trail, with no page
  // refresh. The date view trails animals, so the map re-resolves the
  // revealed animal on its own; no id needs to travel here.
  const [trailRefresh, setTrailRefresh] = useState({ token: 0 });

  const role = roleKey ?? user?.role;
  const isTechnician = role === "technician";
  const canDisperse = role === "admin" || role === "technician";

  // Stable identities so the memoised joins and side list never recompute on
  // an unrelated render.
  const pins = useMemo(() => snapshot?.pins ?? [], [snapshot]);
  const barangayRows = useMemo(() => snapshot?.barangays ?? [], [snapshot]);
  const skippedNoLocation = snapshot?.skipped_no_location ?? 0;

  // The polygons: pins per barangay on the same single-hue scale the
  // Barangay Dispersal page uses. Zero pins → the LIGHTEST fill, never grey.
  const choropleth = useMemo(() => {
    if (boundaries.status !== "ready") return null;
    return buildChoropleth(boundaries.collection, barangayRows, { metric: "pins" });
  }, [boundaries, barangayRows]);

  /* --------------------------- side list ------------------------------ */

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("owner");
  const [sortAsc, setSortAsc] = useState(true);
  const [hoveredAnimalId, setHoveredAnimalId] = useState(null);
  // The selected polygon's MapLibre feature id — captured at click time (the
  // ids are generated by the map, not the data) so the barangay keeps its
  // yellow selection highlight while its card is open.
  const [selectedFeatureId, setSelectedFeatureId] = useState(null);

  const listedPins = useMemo(() => {
    const needle = search.trim().toLowerCase();

    const filtered = pins.filter((pin) => {
      if (
        barangayFilter &&
        normalizeBarangayName(pin.barangay ?? "") !== normalizeBarangayName(barangayFilter)
      ) {
        return false;
      }
      if (!needle) return true;
      return [pin.owner?.label, pin.barangay, pin.animal_type, pin.ear_tag_number]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });

    const direction = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const valueOf = (pin) => {
        switch (sortKey) {
          case "barangay":
            return pin.barangay ?? "";
          case "animal":
            return pin.animal_type ?? "";
          case "ear_tag":
            return pin.ear_tag_number ?? "";
          default:
            return pin.owner?.label ?? "";
        }
      };
      return valueOf(a).localeCompare(valueOf(b)) * direction;
    });
  }, [pins, search, sortKey, sortAsc, barangayFilter]);

  const unplacedPins = useMemo(
    () => pins.filter((pin) => pin.latitude === null || pin.longitude === null),
    [pins],
  );

  // The selected barangay's info panel: the headline numbers behind the
  // pins and the list, derived from the SAME snapshot row set.
  const selectedBarangayInfo = useMemo(() => {
    if (!barangayFilter) return null;
    const inside = pins.filter(
      (pin) => normalizeBarangayName(pin.barangay ?? "") === normalizeBarangayName(barangayFilter),
    );
    return {
      animals: inside.length,
      beneficiaries: new Set(inside.map((pin) => pin.owner?.label ?? "Unknown owner")).size,
      approximate: inside.filter((pin) => pin.approximate).length,
      unplaced: inside.filter((pin) => pin.latitude === null || pin.longitude === null).length,
    };
  }, [pins, barangayFilter]);

  const openDispersal = useCallback(
    (pin) => {
      if (pin.owner?.id === null || pin.owner?.masked) return;
      setDispersal({
        mode: "re-disperse",
        // The dialog speaks beneficiary: the pin's current owner.
        beneficiary: {
          id: pin.owner.id,
          name_of_farmer: pin.owner.label,
          address: pin.barangay ?? "",
        },
      });
    },
    [],
  );

  /* ------------------------------ render ------------------------------ */

  const hasAnyData = dates.length > 0;

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
              The program's animals on one map, day by day. The barangay shapes
              carry the pin counts; a pin's popup shows its flight path — the
              animal's recorded journey from CVO through each owner.
              {canDisperse && " Open a pin to re-disperse it."}
            </p>
          </div>
        </div>

        {/* Date + mode selector — the two filters every visual follows. The
            state lives in the URL, so a view can be shared by its address. */}
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

        {(barangayFilter || dateParam) && (
          <p className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-pill bg-brand-50 px-3.5 py-1.5 text-xs font-semibold text-brand-800">
            <Icon name="map-pin" className="h-3.5 w-3.5" />
            Filters:{" "}
            {[
              selectedDate && `${mode === "as_of" ? "as of" : "on"} ${formatDay(selectedDate)}`,
              barangayFilter && `barangay ${barangayFilter}`,
            ]
              .filter(Boolean)
              .join(" · ")}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => {
                updateParams({ barangay: "" });
                setSelectedFeatureId(null);
              }}
            >
              clear
            </button>
          </p>
        )}
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

      {/* An empty DAY is an answer, not an error — but hand the user the
          nearest day that has records instead of leaving them stranded. */}
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
        <>
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            {/* The map: the shared barangay choropleth UNDER the animal pins
                (clustered), flight trails above both — one map, one shell. */}
            <div className="space-y-2">
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
                  pins={pins}
                  trailFetcher={fetchAnimalTrail}
                  showTable={false}
                  loading={snapshotLoading}
                  onRedisperse={canDisperse ? openDispersal : undefined}
                  selectedAnimalId={hoveredAnimalId}
                  onRowHover={setHoveredAnimalId}
                  selectedBarangay={barangayFilter || null}
                  refreshTrail={trailRefresh}
                  renderChoropleth={(onMapReady) => (
                    <BarangayChoropleth
                      boundaries={boundaries}
                      choropleth={choropleth}
                      height="h-[28rem]"
                      beforeLayerId="cvo-date-pins-clusters"
                      // Pin clicks (and hovers) belong to the pins: without
                      // this gate the polygon underneath would also select.
                      clickThroughLayers={[
                        "cvo-date-pins-clusters",
                        "cvo-date-pins-point",
                        "cvo-date-pins-spider-point",
                      ]}
                      onMapReady={onMapReady}
                      selectedName={barangayFilter || null}
                      selectedFeatureId={selectedFeatureId}
                      onBarangayClick={(name, event) => {
                        // Click a barangay to zoom to it, filter the side
                        // list and open its info panel; click it again (or
                        // another) to clear. The feature id keeps the
                        // polygon painted yellow while the selection lasts.
                        const clear = barangayFilter === name || name === null;
                        updateParams({ barangay: clear ? "" : name });
                        setSelectedFeatureId(clear ? null : (event?.features?.[0]?.id ?? null));
                      }}
                      ariaLabel={`Map of Bayawan City's barangays with the animals dispersed on ${
                        selectedDate ? formatDay(selectedDate) : "no date"
                      }. The side list carries the same animals.`}
                      legend={{
                        stops: ["#eaf3dd", "#c7e2a6", "#8bc34a", "#558b2f", "#33691e"],
                        minLabel: "fewer pins",
                        maxLabel: "more",
                      }}
                      legendNotes={
                        <>
                          <span className="text-slate-500">Hollow pin: approximate (barangay centre)</span>
                          {skippedNoLocation > 0 && (
                            <span className="text-slate-500">
                              {skippedNoLocation} animal{skippedNoLocation === 1 ? "" : "s"} with no location recorded
                            </span>
                          )}
                        </>
                      }
                      tooltipHtml={choroplethTooltipHtml}
                    />
                  )}
                />
              )}
              {selectedDate && !snapshotLoading && (
                <p className="text-xs text-slate-500">
                  Showing {pins.length} animal{pins.length === 1 ? "" : "s"}{" "}
                  {mode === "as_of" ? "as of" : "on"} {formatDay(selectedDate)}.
                </p>
              )}
            </div>

            {/* Side list: the same animals as the pins, searchable, sortable,
                usable without the map. Hovering a row rings its pin. */}
            <div className="card flex max-h-[36rem] flex-col overflow-hidden">
              <div className="space-y-2 border-b border-slate-100 p-4">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  {barangayFilter ? barangayFilter : "All barangays"} · {listedPins.length}
                </h3>

                {selectedBarangayInfo && (
                  <dl className="grid grid-cols-2 gap-1.5 rounded-xl bg-brand-50/70 p-2.5 text-xs dark:bg-slate-800/60">
                    {[
                      ["Animals", selectedBarangayInfo.animals],
                      ["Beneficiaries", selectedBarangayInfo.beneficiaries],
                      ["Approximate locations", selectedBarangayInfo.approximate],
                      ["No location recorded", selectedBarangayInfo.unplaced],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                          {label}
                        </dt>
                        <dd className="font-display text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                <label className="block">
                  <span className="sr-only">Search the animals on this date</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search owner, ear tag, animal…"
                    className="field !py-1.5 text-xs"
                  />
                </label>
                <div className="flex items-center gap-2 text-xs">
                  <label className="flex items-center gap-1 text-slate-500">
                    Sort
                    <select
                      value={sortKey}
                      onChange={(event) => setSortKey(event.target.value)}
                      className="field !w-auto !py-1 text-xs"
                      aria-label="Sort the side list"
                    >
                      <option value="owner">Owner</option>
                      <option value="barangay">Barangay</option>
                      <option value="animal">Animal</option>
                      <option value="ear_tag">Ear tag</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="rounded-pill px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
                    onClick={() => setSortAsc((prev) => !prev)}
                    aria-label={`Currently sorted ${sortAsc ? "A to Z" : "Z to A"}. Reverse the order.`}
                  >
                    <Icon name="refresh" className="h-3 w-3" />
                    {sortAsc ? "A→Z" : "Z→A"}
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto" tabIndex={0}>
                {snapshotLoading ? (
                  <div className="p-4">
                    <SkeletonList rows={6} rowClassName="h-10" />
                  </div>
                ) : listedPins.length === 0 ? (
                  <p className="p-4 text-xs text-slate-500">
                    No animals match this view
                    {barangayFilter ? " in this barangay" : ""}.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {listedPins.map((pin) => (
                      <li key={pin.animal_id}>
                        <button
                          type="button"
                          className={`w-full px-4 py-2.5 text-left transition hover:bg-brand-50/60 ${
                            hoveredAnimalId !== null && String(pin.animal_id) === String(hoveredAnimalId)
                              ? "bg-brand-50"
                              : ""
                          }`}
                          onMouseEnter={() => setHoveredAnimalId(pin.animal_id)}
                          onMouseLeave={() => setHoveredAnimalId(null)}
                          onFocus={() => setHoveredAnimalId(pin.animal_id)}
                          onBlur={() => setHoveredAnimalId(null)}
                          onClick={() => openDispersal(pin)}
                          disabled={pin.owner?.masked || pin.owner?.id === null || !canDisperse}
                        >
                          <p className="text-xs font-semibold text-slate-900">
                            {pin.owner?.label ?? "Unknown owner"}
                            {pin.owner?.masked && (
                              <span className="ml-2 rounded-pill bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                                hidden
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {[pin.animal_type, pin.ear_tag_number ? `#${pin.ear_tag_number}` : null]
                              .filter(Boolean)
                              .join(" · ")}
                            {pin.barangay ? ` — ${pin.barangay}` : ""}
                            {pin.approximate ? " · approximate" : ""}
                            {pin.latitude === null ? " · location not recorded" : ""}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {unplacedPins.length > 0 && (
                <div className="border-t border-slate-100 bg-amber-50/60 p-4 text-[11px] text-amber-800">
                  <p className="font-semibold">Location not recorded ({unplacedPins.length})</p>
                  <ul className="mt-1 space-y-0.5">
                    {unplacedPins.slice(0, 6).map((pin) => (
                      <li key={pin.animal_id}>
                        {pin.owner?.label ?? "Unknown owner"}
                        {pin.ear_tag_number ? ` (#${pin.ear_tag_number})` : ""}
                        {pin.barangay ? ` — ${pin.barangay}` : ""}
                      </li>
                    ))}
                    {unplacedPins.length > 6 && <li>… and {unplacedPins.length - 6} more</li>}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </>
      )}

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
