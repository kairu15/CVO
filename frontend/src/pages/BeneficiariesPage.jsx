import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { adminApi } from "../api/adminApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { Modal } from "../components/Modal";
import { BeneficiaryDetailModal } from "../components/BeneficiaryDetailModal";
import { BeneficiaryFormModal } from "../components/BeneficiaryFormModal";
import { DispersalDialog } from "../components/DispersalDialog";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { Icon } from "../components/Icons";
import { SelectAllCheckbox } from "../components/SelectAllCheckbox";
import { BulkActionBar } from "../components/BulkActionBar";
import { PaginationFooter } from "../components/PaginationFooter";
import { ActionMenu } from "../components/ActionMenu";
import { AnimalTypeClassificationSelect } from "../components/AnimalTypeClassificationSelect";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useBarangays } from "../hooks/useBarangays";
import { useAnimalTypeGroups } from "../hooks/useAnimalTypes";
import { useTechnicianOptions } from "../hooks/useTechnicianOptions";
import { useToast } from "../context/ToastContext";

/**
 * Admin "Beneficiaries" screen — the directory administrators enrol and
 * maintain, with per-row and bulk (per-barangay) technician assignment.
 *
 * Every filter runs SERVER-side before pagination, so a selection shows the
 * whole matching set rather than narrowing the fifty loaded rows. The filters
 * live in the URL, so a view survives a refresh and can be shared.
 *
 * The KPI strip answers the questions this page exists for (who is unassigned,
 * never visited, overdue, missing an RSBSA or a pin) and each tile applies its
 * own filter. Barangay headers report the TRUE household count, not the count
 * on the current page.
 */
export default function BeneficiariesPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const technicians = useTechnicianOptions();
  const [barangays] = useBarangays();
  const { groups: animalTypeGroups } = useAnimalTypeGroups();

  const [beneficiaries, setBeneficiaries] = useState([]);
  const [meta, setMeta] = useState(null);
  const [groupTotals, setGroupTotals] = useState({});
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add/edit dialog. `editing` null means "add" — the form then creates the
  // record and its monitoring row server-side.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [selected, setSelected] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTechnician, setBulkTechnician] = useState("");
  const [saving, setSaving] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Per-row assignment (row menu / details window).
  const [assignTarget, setAssignTarget] = useState(null);
  const [assignId, setAssignId] = useState("");
  const [assigning, setAssigning] = useState(false);

  // The floating details window — the clicked row itself, so opening it never
  // fires another request (the list payload carries every field).
  const [detail, setDetail] = useState(null);

  // The one dispersal dialog: `{ mode, beneficiary }` while open, null closed.
  const [dispersal, setDispersal] = useState(null);

  // ── URL-backed filters ──────────────────────────────────────────────────
  const searchTerm = params.get("search") ?? "";
  const barangayFilter = params.get("barangay") ?? "";
  const animalTypeFilter = params.get("animal_type") ?? "";
  const classificationFilter = params.get("classification_id") ?? "";
  const assignmentFilter = params.get("assignment") ?? "";
  const monitoringFilter = params.get("monitoring") ?? "";
  const missingFilter = params.get("missing") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const perPage = Number(params.get("per_page") ?? "50") || 50;

  const updateParams = useCallback(
    (updates, { resetPage = true } = {}) => {
      // A different filter is a different selection; stale ids would let a bulk
      // action hit rows the administrator can no longer see.
      setSelected(new Set());
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

  // Search as you type: the field updates immediately, the 300ms debounce
  // decides when the URL (and therefore the request) changes.
  const [searchInput, setSearchInput] = useState(searchTerm);
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    // Guard: writing the same term back on every param change would reset
    // pagination to page 1 on unrelated filter clicks (see MonitoringPage).
    if ((params.get("search") ?? "") === debouncedSearch) return;

    updateParams({ search: debouncedSearch || null });
  }, [debouncedSearch, params, updateParams]);

  useEffect(() => {
    if (searchTerm === searchInput) return;
    setSearchInput(searchTerm);
    // Only an external change (Clear filters, browser navigation) re-seeds the
    // box; while typing, searchTerm is the older value and must not overwrite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const directoryFilters = useMemo(
    () => ({
      search: searchTerm || undefined,
      barangay: barangayFilter || undefined,
      animal_type: animalTypeFilter || undefined,
      classification_id: classificationFilter || undefined,
      assignment: assignmentFilter || undefined,
      monitoring: monitoringFilter || undefined,
      missing: missingFilter || undefined,
    }),
    [
      searchTerm,
      barangayFilter,
      animalTypeFilter,
      classificationFilter,
      assignmentFilter,
      monitoringFilter,
      missingFilter,
    ],
  );

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);

      try {
        const [list, figures] = await Promise.all([
          adminApi.listBeneficiariesPage({
            ...directoryFilters,
            per_page: perPage,
            page,
          }),
          // The strip is global, not filtered: a KPI must keep saying how many
          // households are unassigned while a barangay filter is applied.
          adminApi.beneficiarySummary().catch(() => null),
        ]);

        setBeneficiaries(list?.data ?? []);
        setMeta(list?.meta ?? null);
        setGroupTotals(list?.group_totals ?? {});
        if (figures) setSummary(figures);
      } catch (err) {
        if (!quiet) setError(getErrorMessage(err));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [directoryFilters, perPage, page],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Quietly re-fetch so rows added elsewhere appear without a manual reload.
  useAutoRefresh(load);

  const refresh = useCallback(() => load(), [load]);

  const grouped = useMemo(() => {
    const map = new Map();

    for (const beneficiary of beneficiaries) {
      if (!map.has(beneficiary.address)) map.set(beneficiary.address, []);
      map.get(beneficiary.address).push(beneficiary);
    }

    return [...map.entries()];
  }, [beneficiaries]);

  function toggle(id) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBarangay(rows) {
    setSelected((previous) => {
      const next = new Set(previous);
      const allSelected = rows.every((row) => next.has(row.id));

      for (const row of rows) {
        if (allSelected) next.delete(row.id);
        else next.add(row.id);
      }

      return next;
    });
  }

  /** Global "Select all": tick every loaded beneficiary, or clear them all. */
  function toggleAll(ids) {
    setSelected((previous) => {
      if (ids.length === 0) return previous;

      const next = new Set(previous);
      const allSelected = ids.every((id) => next.has(id));

      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }

      return next;
    });
  }

  const matchingTotal = meta?.total ?? beneficiaries.length;
  const canSelectAllMatching = matchingTotal > beneficiaries.length;

  /**
   * Select every household matching the filters — not just this page. Ids
   * only, so a whole barangay is one round trip and one bulk request.
   */
  async function selectAllMatching() {
    try {
      const ids = await adminApi.beneficiaryIds(directoryFilters);
      setSelected(new Set(ids));
      toast.success(
        `${ids.length} ${ids.length === 1 ? "beneficiary" : "beneficiaries"} selected.`,
      );
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  async function saveBulk() {
    setSaving(true);

    try {
      const technicianId = bulkTechnician === "" ? null : Number(bulkTechnician);
      const result = await adminApi.bulkAssignTechnician([...selected], technicianId);
      const failedIds = new Set(result?.failed_ids ?? []);

      setSelected(new Set());
      setBulkOpen(false);
      await refresh();

      // Action feedback is a global toast (fires after the refresh so it is
      // not cleared by it); page-level load failures stay inline.
      if (failedIds.size > 0) {
        const failedNames = beneficiaries
          .filter((row) => failedIds.has(row.id))
          .map((row) => row.name_of_farmer);
        const named = failedNames.length > 0 ? `: ${failedNames.join(", ")}` : ".";

        toast.error(
          `Assigned ${result.updated} of ${result.updated + failedIds.size} beneficiaries, but ${failedIds.size} failed${named}`,
        );
      } else {
        toast.success(
          `Technician assigned to ${result.updated} ${result.updated === 1 ? "beneficiary" : "beneficiaries"}.`,
        );
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  /** Assign one household (row menu or the details window). */
  async function assign(beneficiary, technicianId) {
    setAssigning(true);

    try {
      await adminApi.assignTechnician(beneficiary.id, technicianId);
      toast.success("Technician assignment saved.");
      setAssignTarget(null);
      setDetail(null);
      await refresh();
      return true;
    } catch (err) {
      toast.error(getErrorMessage(err));
      return false;
    } finally {
      setAssigning(false);
    }
  }

  /**
   * Bulk delete the selected households. Admin-only server-side; each row takes
   * its whole history with it, same as the single delete, so the confirmation
   * spells that out before this runs.
   */
  async function confirmBulkDelete() {
    if (selected.size === 0) return;

    setBulkBusy(true);

    try {
      const result = await beneficiariesApi.bulkRemove([...selected]);
      const failed = result?.failed_ids?.length ?? 0;

      setBulkDeleteOpen(false);
      setSelected(new Set());
      await refresh();

      toast.success(
        failed > 0
          ? `Deleted ${result.deleted} of ${result.deleted + failed} beneficiaries; ${failed} could not be deleted.`
          : `Deleted ${result.deleted} ${result.deleted === 1 ? "beneficiary" : "beneficiaries"}.`,
      );
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBulkBusy(false);
    }
  }

  const technicianName = (id) =>
    technicians.find((technician) => technician.id === id)?.name ?? "—";

  const hasFilters = Boolean(
    searchTerm ||
      barangayFilter ||
      animalTypeFilter ||
      classificationFilter ||
      assignmentFilter ||
      monitoringFilter ||
      missingFilter,
  );

  const clearFilters = () => {
    setSearchInput("");
    updateParams({
      search: null,
      barangay: null,
      animal_type: null,
      classification_id: null,
      assignment: null,
      monitoring: null,
      missing: null,
    });
  };

  const summaryTiles = [
    {
      key: "households",
      label: "Households",
      value: summary?.households,
      hint: "enrolled",
    },
    {
      key: "unassigned",
      label: "Unassigned",
      value: summary?.unassigned,
      hint: "no technician",
      attention: "unassigned",
      tone: "amber",
    },
    {
      key: "never",
      label: "Never visited",
      value: summary?.never_monitored,
      hint: "no dated visit",
      attention: "never",
      tone: "amber",
    },
    {
      key: "overdue",
      label: "Overdue",
      value: summary?.overdue,
      hint: `${summary?.overdue_days ?? 60}+ days`,
      attention: "overdue",
      tone: "amber",
    },
    {
      key: "rsbsa",
      label: "No RSBSA",
      value: summary?.missing_rsbsa,
      hint: "registry gap",
      attention: "rsbsa",
    },
    {
      key: "location",
      label: "No map pin",
      value: summary?.without_location,
      hint: "unmapped",
      attention: "location",
    },
  ];

  function tileActive(tile) {
    if (tile.attention === "unassigned") return assignmentFilter === "unassigned";
    if (tile.attention === "never" || tile.attention === "overdue") {
      return monitoringFilter === tile.attention;
    }
    if (tile.attention === "rsbsa" || tile.attention === "location") {
      return missingFilter === tile.attention;
    }
    return false;
  }

  function applyTile(tile) {
    if (!tile.attention || tileActive(tile)) {
      updateParams({ assignment: null, monitoring: null, missing: null });
      return;
    }

    updateParams({
      assignment: tile.attention === "unassigned" ? "unassigned" : null,
      monitoring:
        tile.attention === "never" || tile.attention === "overdue"
          ? tile.attention
          : null,
      missing:
        tile.attention === "rsbsa" || tile.attention === "location"
          ? tile.attention
          : null,
    });
  }

  /**
   * Every action a row needs, in one menu: the three inline links plus the
   * details window's destinations.
   */
  function rowMenuItems(beneficiary) {
    return [
      { label: "View details", onClick: () => setDetail(beneficiary) },
      {
        label: "Assign technician",
        onClick: () => {
          setAssignTarget(beneficiary);
          setAssignId(
            beneficiary.technician_id != null
              ? String(beneficiary.technician_id)
              : "",
          );
        },
      },
      {
        label: "Edit",
        ariaLabel: `Edit ${beneficiary.name_of_farmer}`,
        onClick: () => {
          setEditing(beneficiary);
          setFormOpen(true);
        },
      },
      {
        label: "Disperse animal",
        onClick: () => setDispersal({ mode: "disperse", beneficiary }),
      },
      {
        label: "Re-disperse",
        onClick: () => setDispersal({ mode: "re-disperse", beneficiary }),
      },
      {
        label: "View dispersal lineage",
        to: `/dashboard/admin/beneficiaries/${beneficiary.id}/lineage`,
      },
      {
        label: "Print ear tag",
        to: `/dashboard/admin/beneficiaries/${beneficiary.id}/tag`,
      },
    ];
  }

  // Either kind of dated contact: the Field Visits log counts a trip even
  // when it produced no monitoring record, so this column and the overdue
  // tile agree with that screen.
  const lastVisit = (value) =>
    value ? String(value).slice(0, 10) : "Never";

  const exportHref = adminApi.exportBeneficiariesUrl(directoryFilters);

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Beneficiary Records</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Beneficiaries
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Every dispersed animal registered with the program. Filter the
              whole directory, assign a technician to one household or a whole
              barangay, and export the current view for field work.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Icon name="plus" className="h-4 w-4" />
              Add beneficiary
            </button>
            <a
              href={exportHref}
              className="btn-secondary"
              download
              aria-label="Export the filtered beneficiary directory as CSV"
            >
              <Icon name="clipboard" className="h-4 w-4" />
              Export CSV
            </a>
          </div>
        </div>

        {beneficiaries.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
              <SelectAllCheckbox
                ids={beneficiaries.map((beneficiary) => beneficiary.id)}
                selected={selected}
                onToggleAll={toggleAll}
                label="Select all beneficiaries"
              />
              Select all on this page
            </label>

            {canSelectAllMatching && (
              <button
                type="button"
                onClick={selectAllMatching}
                className="text-xs font-semibold text-brand-700 underline-offset-2 hover:underline"
              >
                Select all {matchingTotal} matching
              </button>
            )}

            <button
              type="button"
              className="btn-primary ml-auto"
              disabled={selected.size === 0}
              onClick={() => setBulkOpen(true)}
            >
              Assign ({selected.size})
            </button>
          </div>
        )}
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}

      {/* Oversight at a glance. Each worklist tile is also its own filter. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {summaryTiles.map((tile) => {
          const clickable = Boolean(tile.attention);
          const active = clickable && tileActive(tile);
          const Wrapper = clickable ? "button" : "div";

          return (
            <Wrapper
              key={tile.key}
              {...(clickable
                ? {
                    type: "button",
                    onClick: () => applyTile(tile),
                    "aria-pressed": active,
                  }
                : {})}
              className={`card px-4 py-3 text-left transition ${
                clickable ? "hover:border-brand-400 hover:bg-brand-50/40" : ""
              } ${active ? "border-brand-500 ring-1 ring-brand-500/30" : ""}`}
            >
              <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
                {tile.label}
              </p>
              <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {tile.value === undefined || tile.value === null ? "—" : tile.value}
              </p>
              {tile.hint && (
                <p className="mt-0.5 text-[11px] text-slate-500">{tile.hint}</p>
              )}
              {tile.tone === "amber" && Number(tile.value) > 0 && (
                <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
              )}
            </Wrapper>
          );
        })}
      </section>

      {/* Filters. Every control narrows the WHOLE directory server-side. */}
      <section className="card px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-64">
            <label
              htmlFor="directory-search"
              className="block text-sm font-medium text-slate-700"
            >
              Search
            </label>
            <div className="relative mt-1.5">
              <Icon
                name="search"
                className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-400"
              />
              <input
                id="directory-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Name, RSBSA #, ear tag, technician…"
                className="field pl-9"
                aria-label="Search beneficiaries"
              />
            </div>
          </div>

          <div className="w-full sm:w-48">
            <label
              htmlFor="directory-barangay"
              className="block text-sm font-medium text-slate-700"
            >
              Barangay
            </label>
            <select
              id="directory-barangay"
              className="field mt-1.5"
              value={barangayFilter}
              onChange={(event) =>
                updateParams({ barangay: event.target.value || null })
              }
              aria-label="Filter by barangay"
            >
              <option value="">All barangays</option>
              {barangays.map((barangay) => (
                <option key={barangay.name} value={barangay.name}>
                  {barangay.name}
                </option>
              ))}
            </select>
          </div>

          <AnimalTypeClassificationSelect
            groups={animalTypeGroups}
            allowAll
            typeValue={animalTypeFilter}
            classificationValue={classificationFilter}
            onChange={({ animalType, classificationId }) =>
              updateParams({
                animal_type: animalType || null,
                classification_id: classificationId || null,
              })
            }
            typeAriaLabel="Filter by animal type"
            classificationAriaLabel="Filter by classification"
            typeId="directory-animal-type"
            classificationId="directory-classification"
            className="w-full sm:w-80"
          />

          <div className="w-full sm:w-48">
            <label
              htmlFor="directory-assignment"
              className="block text-sm font-medium text-slate-700"
            >
              Technician
            </label>
            <select
              id="directory-assignment"
              className="field mt-1.5"
              value={assignmentFilter}
              onChange={(event) =>
                updateParams({ assignment: event.target.value || null })
              }
              aria-label="Filter by assignment"
            >
              <option value="">All households</option>
              <option value="unassigned">Unassigned</option>
              {technicians.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.name}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-44">
            <label
              htmlFor="directory-monitoring"
              className="block text-sm font-medium text-slate-700"
            >
              Monitoring
            </label>
            <select
              id="directory-monitoring"
              className="field mt-1.5"
              value={monitoringFilter}
              onChange={(event) =>
                updateParams({ monitoring: event.target.value || null })
              }
              aria-label="Filter by monitoring status"
            >
              <option value="">Any status</option>
              <option value="never">Never visited</option>
              <option value="overdue">
                Overdue ({summary?.overdue_days ?? 60}+ days)
              </option>
            </select>
          </div>

          <div className="w-full sm:w-44">
            <label
              htmlFor="directory-missing"
              className="block text-sm font-medium text-slate-700"
            >
              Data gaps
            </label>
            <select
              id="directory-missing"
              className="field mt-1.5"
              value={missingFilter}
              onChange={(event) =>
                updateParams({ missing: event.target.value || null })
              }
              aria-label="Filter by missing data"
            >
              <option value="">No filter</option>
              <option value="rsbsa">No RSBSA number</option>
              <option value="ear_tag">No ear tag</option>
              <option value="location">No map pin</option>
            </select>
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-pill px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              Clear filters
            </button>
          )}
        </div>
      </section>

      <BulkActionBar
        count={selected.size}
        noun="beneficiary"
        plural="beneficiaries"
        onClear={() => setSelected(new Set())}
        onDelete={() => setBulkDeleteOpen(true)}
        busy={bulkBusy}
      >
        <button
          type="button"
          className="rounded-pill bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => setBulkOpen(true)}
          disabled={bulkBusy}
        >
          Assign technician
        </button>
      </BulkActionBar>

      <section className="card overflow-hidden">
        {loading ? (
          <SkeletonList rows={4} />
        ) : beneficiaries.length === 0 ? (
          <EmptyState
            title={hasFilters ? "No beneficiaries match these filters" : "No beneficiaries yet"}
            description={
              hasFilters
                ? "Clear the filters to see the whole directory."
                : "Beneficiaries appear here once an administrator enrols them."
            }
          />
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {grouped.map(([barangay, rows]) => {
                const total = groupTotals?.[barangay] ?? rows.length;

                return (
                  <div key={barangay}>
                    <div className="flex flex-wrap items-center gap-3 bg-slate-50/60 px-4 py-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded accent-brand-700"
                        aria-label={`Select all in ${barangay}`}
                        checked={rows.every((row) => selected.has(row.id))}
                        onChange={() => toggleBarangay(rows)}
                      />
                      <Icon name="map-pin" className="h-4 w-4 text-brand-700" />
                      <span className="font-display text-sm font-semibold text-slate-900">
                        {barangay}
                      </span>
                      <span className="rounded-pill bg-white px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase ring-1 ring-slate-200">
                        {total}
                      </span>
                      {total > rows.length && (
                        <span className="text-[10px] text-slate-500">
                          showing {rows.length} on this page
                        </span>
                      )}
                    </div>

                    {/* Horizontal scroll keeps every column readable on a
                        tablet; the page itself never scrolls sideways. */}
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[620px] text-left text-xs">
                        <thead className="sticky top-0 z-10 bg-white">
                          <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                            <th scope="col" className="w-10 px-4 py-2" />
                            <th scope="col" className="px-4 py-2.5 font-semibold">
                              Name of Farmer
                            </th>
                            <th scope="col" className="hidden px-4 py-2.5 font-semibold md:table-cell">
                              RSBSA #
                            </th>
                            <th scope="col" className="hidden px-4 py-2.5 font-semibold md:table-cell">
                              Animal
                            </th>
                            <th scope="col" className="hidden px-4 py-2.5 font-semibold lg:table-cell">
                              Visits
                            </th>
                            <th scope="col" className="hidden px-4 py-2.5 font-semibold lg:table-cell">
                              Last visit
                            </th>
                            <th scope="col" className="hidden px-4 py-2.5 font-semibold sm:table-cell">
                              Technician
                            </th>
                            <th scope="col" className="w-20 px-4 py-2.5 text-right font-semibold">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {rows.map((beneficiary) => (
                            <tr
                              key={beneficiary.id}
                              className="transition hover:bg-brand-50/40"
                            >
                              <td className="px-4 py-2.5">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded accent-brand-700"
                                  aria-label={`Select ${beneficiary.name_of_farmer}`}
                                  checked={selected.has(beneficiary.id)}
                                  onChange={() => toggle(beneficiary.id)}
                                />
                              </td>
                              <td className="px-4 py-2.5 font-medium">
                                <button
                                  type="button"
                                  onClick={() => setDetail(beneficiary)}
                                  title="View details"
                                  className="text-left text-slate-900 underline-offset-2 transition hover:text-brand-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                                >
                                  {beneficiary.name_of_farmer}
                                </button>
                              </td>
                              <td className="hidden truncate px-4 py-2.5 text-slate-600 md:table-cell">
                                {beneficiary.rsbsa_number || (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="hidden truncate px-4 py-2.5 text-slate-600 md:table-cell">
                                {beneficiary.animal_type}
                                {beneficiary.animal_classification && (
                                  <span className="block text-[10px] font-medium text-slate-500">
                                    {beneficiary.animal_classification}
                                  </span>
                                )}
                              </td>
                              <td className="hidden px-4 py-2.5 text-slate-600 tabular-nums lg:table-cell">
                                {beneficiary.monitoring_records_count ?? 0}
                              </td>
                              <td className="hidden px-4 py-2.5 whitespace-nowrap text-slate-600 lg:table-cell">
                                {lastVisit(beneficiary.last_contact_at ?? beneficiary.last_monitored_at)}
                              </td>
                              <td className="hidden truncate px-4 py-2.5 text-slate-600 sm:table-cell">
                                {beneficiary.technician_id ? (
                                  technicianName(beneficiary.technician_id)
                                ) : (
                                  <span className="font-medium text-amber-700">
                                    Unassigned
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <ActionMenu
                                  label={`Actions for ${beneficiary.name_of_farmer}`}
                                  items={rowMenuItems(beneficiary)}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>

            <PaginationFooter
              meta={meta}
              shown={beneficiaries.length}
              noun="beneficiary"
              plural="beneficiaries"
              pageSize={perPage}
              pageSizeOptions={[25, 50]}
              onPageSizeChange={(size) =>
                updateParams({ per_page: size === 50 ? null : size })
              }
              onPageChange={(next) =>
                updateParams(
                  { page: next <= 1 ? null : next },
                  { resetPage: false },
                )
              }
            />
          </>
        )}
      </section>

      <BeneficiaryDetailModal
        beneficiary={detail}
        onClose={() => setDetail(null)}
        technicianName={technicianName}
        technicians={technicians}
        onAssignTechnician={assign}
        assigning={assigning}
        onOpenDispersal={(beneficiary, mode) => {
          setDetail(null);
          setDispersal({ mode, beneficiary });
        }}
      />

      <DispersalDialog
        open={dispersal !== null}
        mode={dispersal?.mode ?? "disperse"}
        beneficiary={dispersal?.beneficiary ?? null}
        onClose={() => setDispersal(null)}
        onSaved={refresh}
      />

      {/* Mounted only while open: the form pulls auth/offline context and the
          map picker, neither of which the directory itself needs. */}
      {formOpen && (
        <BeneficiaryFormModal
          open
          beneficiary={editing}
          onClose={() => setFormOpen(false)}
          onSaved={refresh}
        />
      )}

      {/* Per-row assignment from the row menu. */}
      <Modal
        open={assignTarget !== null}
        title={`Assign technician${assignTarget ? ` to ${assignTarget.name_of_farmer}` : ""}`}
        onClose={() => setAssignTarget(null)}
      >
        <label htmlFor="row-technician" className="block text-sm font-medium text-slate-700">
          Technician
        </label>
        <select
          id="row-technician"
          className="field mt-1.5"
          value={assignId}
          onChange={(event) => setAssignId(event.target.value)}
          disabled={assigning}
        >
          <option value="">Unassigned (clear assignment)</option>
          {technicians.map((technician) => (
            <option key={technician.id} value={technician.id}>
              {technician.name}
            </option>
          ))}
        </select>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setAssignTarget(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={assigning}
            onClick={() =>
              assign(assignTarget, assignId === "" ? null : Number(assignId))
            }
          >
            {assigning ? (
              <>
                <ButtonSpinner />
                Saving…
              </>
            ) : (
              "Save assignment"
            )}
          </button>
        </div>
      </Modal>

      <Modal
        open={bulkOpen}
        title={`Assign technician to ${selected.size} ${selected.size === 1 ? "beneficiary" : "beneficiaries"}`}
        onClose={() => setBulkOpen(false)}
      >
        <label htmlFor="bulk-technician" className="block text-sm font-medium text-slate-700">
          Technician
        </label>
        <select
          id="bulk-technician"
          className="field mt-1.5"
          value={bulkTechnician}
          onChange={(event) => setBulkTechnician(event.target.value)}
        >
          <option value="">Unassigned (clear assignment)</option>
          {technicians.map((technician) => (
            <option key={technician.id} value={technician.id}>
              {technician.name}
            </option>
          ))}
        </select>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setBulkOpen(false)}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={saveBulk} disabled={saving}>
            {saving ? (
              <>
                <ButtonSpinner />
                Saving…
              </>
            ) : (
              "Apply"
            )}
          </button>
        </div>
      </Modal>

      <Modal
        open={bulkDeleteOpen}
        title={`Delete ${selected.size} selected ${selected.size === 1 ? "beneficiary" : "beneficiaries"}`}
        onClose={() => setBulkDeleteOpen(false)}
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            This removes <strong>{selected.size}</strong> selected
            household{selected.size === 1 ? "" : "s"} and all associated records —
            monitoring history, health records, case notes, field visits, visit
            photos, technician assignments and notifications.
          </p>
          <p>
            The records are archived (not erased) for the office's audit and
            retention, and can only be restored by a database administrator.
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setBulkDeleteOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary bg-red-600 hover:bg-red-700"
            onClick={confirmBulkDelete}
            disabled={bulkBusy}
          >
            {bulkBusy ? (
              <>
                <ButtonSpinner />
                Deleting…
              </>
            ) : (
              "Delete selected"
            )}
          </button>
        </div>
      </Modal>
    </div>
  );
}
