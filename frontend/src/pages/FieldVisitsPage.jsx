import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { fieldVisitsApi } from "../api/fieldVisitsApi";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { FieldVisitFormModal, purposeLabel } from "../components/FieldVisitFormModal";
import { Modal } from "../components/Modal";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { QrScanner } from "../components/QrScanner";
import { Icon } from "../components/Icons";
import { SelectAllCheckbox } from "../components/SelectAllCheckbox";
import { BulkActionBar } from "../components/BulkActionBar";
import { PaginationFooter } from "../components/PaginationFooter";
import { VerificationBadge, verificationDistance } from "../components/VerificationBadge";
import { ActionMenu } from "../components/ActionMenu";
import { useRowSelection } from "../hooks/useRowSelection";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useTechnicianOptions } from "../hooks/useTechnicianOptions";
import { useBarangays } from "../hooks/useBarangays";
import { useAuth } from "../context/AuthContext";
import { getRole } from "../config/roles";
import { lookupScannedAnimal } from "../lib/scanLookup";

/**
 * Field Visits — the trip log: where the technician went, when, why, and the
 * GPS fix captured on site. Separate from Monitoring Records, which holds what
 * was observed about the animal.
 *
 * Every filter runs server-side before pagination and lives in the URL, so a
 * view survives a refresh and can be shared. Each row connects to the
 * household record and the dispersal it followed up on, shows cached evidence
 * thumbnails, and keeps all actions in one menu.
 */
function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export default function FieldVisitsPage({ roleKey = "technician" }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const config = getRole(roleKey);
  const technicians = useTechnicianOptions(user?.role === "admin");
  const [barangays] = useBarangays();

  const [summary, setSummary] = useState(null);
  const [due, setDue] = useState(null);
  const [followUp, setFollowUp] = useState(false);
  const [threshold, setThreshold] = useState(null);
  const [purposes, setPurposes] = useState([]);

  const [visits, setVisits] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [initialBeneficiary, setInitialBeneficiary] = useState(null);
  const [detail, setDetail] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // The off-site justification annotates the stored verdict; it never blocks
  // the visit itself.
  const [noting, setNoting] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  // Admin: adopt this visit's captured fix as the household's registered pin.
  const [adopting, setAdopting] = useState(null);
  const [adoptBusy, setAdoptBusy] = useState(false);

  const { selected, toggle, toggleAll, clear } = useRowSelection();

  // Mirrors FieldVisitPolicy — only a field technician logs a trip.
  const canLog = user?.role === "technician";
  const canScan = ["admin", "technician"].includes(user?.role);
  const canModify = (visit) =>
    user?.role === "admin" ||
    (user?.role === "technician" && visit.technician_id === user?.id);

  // ── URL-backed filters ──────────────────────────────────────────────────
  const searchTerm = params.get("search") ?? "";
  const verificationFilter = params.get("verification") ?? "all";
  const purposeFilter = params.get("purpose") ?? "";
  const fromFilter = params.get("from") ?? "";
  const toFilter = params.get("to") ?? "";
  const technicianFilter = params.get("technician") ?? "";
  const barangayFilter = params.get("barangay") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const perPage = Number(params.get("per_page") ?? "25") || 25;

  const updateParams = useCallback(
    (updates, { resetPage = true } = {}) => {
      clear();
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
    [clear, setParams],
  );

  // Type immediately, fetch after the debounce.
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
      purpose: purposeFilter || undefined,
      from: fromFilter || undefined,
      to: toFilter || undefined,
      technician: technicianFilter || undefined,
      barangay: barangayFilter || undefined,
    }),
    [searchTerm, purposeFilter, fromFilter, toFilter, technicianFilter, barangayFilter],
  );

  // Purposes and the on-site threshold are static for the session; fetch them
  // once, not on every poll.
  useEffect(() => {
    let active = true;

    fieldVisitsApi
      .options()
      .then((res) => {
        if (!active) return;
        setPurposes(res?.purposes ?? []);
        setThreshold(res?.onsite_threshold_m ?? null);
      })
      .catch(() => {
        // The list is still usable; the purpose filter falls back to All.
      });

    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);

      try {
        const [visitsRes, summaryRes, dueRes] = await Promise.all([
          fieldVisitsApi.list({
            ...filters,
            ...(verificationFilter !== "all" ? { verification: verificationFilter } : {}),
            per_page: perPage,
            page,
          }),
          fieldVisitsApi.summary().catch(() => null),
          fieldVisitsApi.visitsDue(followUp ? { follow_up: true } : {}).catch(() => null),
        ]);

        setVisits(visitsRes?.data ?? []);
        setMeta(visitsRes?.meta ?? null);
        if (summaryRes) setSummary(summaryRes);
        if (dueRes) setDue(dueRes);
      } catch (err) {
        if (!quiet) setError(getErrorMessage(err));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [filters, verificationFilter, perPage, page, followUp],
  );

  useEffect(() => {
    load();
  }, [load]);

  useAutoRefresh(load);

  const deletableIds = visits.filter(canModify).map((visit) => visit.id);

  function openLogFor(household) {
    setEditing(null);
    setInitialBeneficiary(household);
    setFormOpen(true);
  }

  function clearFilters() {
    setSearchInput("");
    updateParams({
      search: null,
      verification: null,
      purpose: null,
      from: null,
      to: null,
      technician: null,
      barangay: null,
    });
  }

  async function confirmDelete() {
    if (!deleting) return;

    setRemoving(true);
    setError(null);

    try {
      await fieldVisitsApi.remove(deleting.id);
      const removed = deleting;
      setDeleting(null);
      await load(true);
      setNotice(`Deleted the visit to ${removed.name_of_farmer}.`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRemoving(false);
    }
  }

  async function confirmBulkDelete() {
    if (selected.size === 0) return;

    setBulkBusy(true);
    setError(null);

    try {
      const result = await fieldVisitsApi.bulkRemove([...selected]);
      const failed = result?.failed_ids?.length ?? 0;

      setBulkOpen(false);
      clear();
      await load(true);

      setNotice(
        failed > 0
          ? `Deleted ${result.deleted} of ${result.deleted + failed} visits; ${failed} could not be deleted.`
          : `Deleted ${result.deleted} ${result.deleted === 1 ? "visit" : "visits"}.`,
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBulkBusy(false);
    }
  }

  async function confirmNote() {
    if (!noting) return;

    setNoteBusy(true);
    setError(null);

    try {
      await fieldVisitsApi.setVerificationNote(noting.id, noteText.trim());
      setNoting(null);
      await load(true);
      setNotice("Justification saved.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setNoteBusy(false);
    }
  }

  async function confirmAdopt() {
    if (!adopting) return;

    setAdoptBusy(true);
    setError(null);

    try {
      await beneficiariesApi.adoptVisitLocation(adopting.beneficiary_id, {
        latitude: adopting.latitude,
        longitude: adopting.longitude,
        fieldVisitId: adopting.id,
      });
      const name = adopting.name_of_farmer;
      setAdopting(null);
      await load(true);
      setNotice(`Registered ${name}'s location from this visit. Verification verdicts were re-computed.`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setAdoptBusy(false);
    }
  }

  async function handleScan(rawValue) {
    setScanOpen(false);
    setNotice(null);
    setError(null);

    const result = await lookupScannedAnimal(rawValue);

    if (result.status === "ok") {
      navigate(`/dashboard/${roleKey}/beneficiaries/${result.id}/lineage`);
      return;
    }

    if (result.status === "forbidden") {
      setError(
        "That animal belongs to a farmer who isn't assigned to you, so its record can't be opened.",
      );
      return;
    }

    if (result.status === "notfound") {
      setError("No animal matches that code.");
      return;
    }

    if (result.status === "invalid") {
      setError("That QR code isn't a CVO animal tag.");
      return;
    }

    setError(result.message ?? "Could not look up that animal.");
  }

  /** One menu for every row action, mirroring the details window. */
  function rowMenuItems(visit) {
    const items = [
      { label: "View details", onClick: () => setDetail(visit) },
      {
        label: "View household",
        to: `/dashboard/${roleKey}/beneficiaries/${visit.beneficiary_id}/lineage`,
      },
    ];

    if (canLog) {
      items.push({
        label: "Log visit for this household",
        onClick: () =>
          openLogFor({
            id: visit.beneficiary_id,
            name_of_farmer: visit.name_of_farmer,
            address: visit.address,
            animal_type: visit.animal_type,
            sex: visit.sex,
          }),
      });
    }

    if (canModify(visit)) {
      items.push({
        label: "Edit",
        ariaLabel: `Edit visit to ${visit.name_of_farmer}`,
        onClick: () => {
          setEditing(visit);
          setInitialBeneficiary(null);
          setFormOpen(true);
        },
      });

      if (["off_site", "low_accuracy"].includes(visit.verification_status)) {
        items.push({
          label: visit.verification_note ? "Edit justification" : "Justify",
          onClick: () => {
            setNoting(visit);
            setNoteText(visit.verification_note ?? "");
          },
        });
      }

      if (
        user?.role === "admin" &&
        visit.latitude !== null &&
        visit.longitude !== null &&
        visit.beneficiary_has_location === false
      ) {
        items.push({ label: "Use this location", onClick: () => setAdopting(visit) });
      }

      items.push({
        label: "Delete",
        ariaLabel: `Delete visit to ${visit.name_of_farmer}`,
        onClick: () => setDeleting(visit),
      });
    }

    return items;
  }

  const hasFilters = Boolean(
    searchTerm ||
      verificationFilter !== "all" ||
      purposeFilter ||
      fromFilter ||
      toFilter ||
      technicianFilter ||
      barangayFilter,
  );

  const summaryTiles = [
    {
      key: "recent",
      label: "Visits",
      value: summary?.visits_30d,
      hint: "last 30 days",
    },
    {
      key: "review",
      label: "Needs review",
      value: summary?.needs_review,
      hint: "off site / fuzzy",
      verification: "review",
    },
    {
      key: "gps",
      label: "No GPS",
      value: summary?.no_gps,
      hint: "no fix captured",
      verification: "no_gps",
    },
    {
      key: "onsite",
      label: "On-site rate",
      value: summary?.on_site_rate === null || summary?.on_site_rate === undefined
        ? null
        : `${summary.on_site_rate}%`,
      hint: "of all visits",
    },
  ];

  const exportHref = fieldVisitsApi.exportUrl({
    ...filters,
    ...(verificationFilter !== "all" ? { verification: verificationFilter } : {}),
  });

  const coverage = (due?.coverage ?? []).filter((row) => row.assigned > 0);

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{config?.label ?? "Field Technician"}</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Field Visits
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Every trip out — the household visited, when, why, and the GPS fix
              captured on site. Animal observations belong in Monitoring Records.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canScan && (
              <button type="button" onClick={() => setScanOpen(true)} className="btn-secondary">
                <Icon name="qr" className="h-4 w-4" />
                Scan ear tag
              </button>
            )}

            <a href={exportHref} className="btn-secondary" download aria-label="Export the filtered field visit log as CSV">
              <Icon name="clipboard" className="h-4 w-4" />
              Export CSV
            </a>

            {canLog && (
              <button
                type="button"
                onClick={() => openLogFor(null)}
                className="btn-primary"
              >
                <Icon name="route" className="h-4 w-4" />
                Log a Field Visit
              </button>
            )}
          </div>
        </div>

        {/* Oversight at a glance — each worklist tile is also its filter. */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {summaryTiles.map((tile) => {
            const clickable = Boolean(tile.verification);
            const active = clickable && verificationFilter === tile.verification;
            const Wrapper = clickable ? "button" : "div";

            return (
              <Wrapper
                key={tile.key}
                {...(clickable
                  ? {
                      type: "button",
                      onClick: () =>
                        updateParams({
                          verification: active ? null : tile.verification,
                        }),
                      "aria-pressed": active,
                    }
                  : {})}
                className={`rounded-xl border border-slate-200 px-4 py-3 text-left transition ${
                  clickable ? "hover:border-brand-400 hover:bg-brand-50/40" : ""
                } ${active ? "border-brand-500 ring-1 ring-brand-500/30" : ""}`}
              >
                <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
                  {tile.label}
                </p>
                <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
                  {tile.value === undefined || tile.value === null ? "—" : tile.value}
                </p>
                {tile.hint && <p className="mt-0.5 text-[11px] text-slate-500">{tile.hint}</p>}
              </Wrapper>
            );
          })}
        </div>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}
      {notice && (
        <InlineAlert
          tone="success"
          message={notice}
          onDismiss={() => setNotice(null)}
          autoDismiss={5000}
        />
      )}

      {/* Filters — all applied before pagination. */}
      <section className="card px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-60">
            <label htmlFor="visit-search" className="block text-sm font-medium text-slate-700">
              Search
            </label>
            <div className="relative mt-1.5">
              <Icon
                name="search"
                className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-400"
              />
              <input
                id="visit-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Farmer, RSBSA #, ear tag, technician…"
                className="field pl-9"
                aria-label="Search field visits"
              />
            </div>
          </div>

          <div className="w-full sm:w-44">
            <label htmlFor="visit-verification-filter" className="block text-sm font-medium text-slate-700">
              Verification
            </label>
            <select
              id="visit-verification-filter"
              className="field mt-1.5"
              value={verificationFilter}
              onChange={(event) => updateParams({ verification: event.target.value === "all" ? null : event.target.value })}
              aria-label="Filter by verification"
            >
              <option value="all">All visits</option>
              <option value="review">Off-site / needs review</option>
              <option value="on_site">On site</option>
              <option value="off_site">Off site</option>
              <option value="low_accuracy">Low accuracy</option>
              <option value="no_reference_location">No registered pin</option>
              <option value="no_gps">No GPS</option>
            </select>
          </div>

          <div className="w-full sm:w-44">
            <label htmlFor="visit-purpose-filter" className="block text-sm font-medium text-slate-700">
              Visit purpose
            </label>
            <select
              id="visit-purpose-filter"
              className="field mt-1.5"
              value={purposeFilter}
              onChange={(event) => updateParams({ purpose: event.target.value || null })}
              aria-label="Filter by purpose"
            >
              <option value="">All purposes</option>
              {purposes.map((value) => (
                <option key={value} value={value}>
                  {purposeLabel(value)}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-40">
            <label htmlFor="visit-from" className="block text-sm font-medium text-slate-700">
              From
            </label>
            <input
              id="visit-from"
              type="date"
              className="field mt-1.5"
              value={fromFilter}
              onChange={(event) => updateParams({ from: event.target.value || null })}
              aria-label="Visits from date"
            />
          </div>

          <div className="w-full sm:w-40">
            <label htmlFor="visit-to" className="block text-sm font-medium text-slate-700">
              To
            </label>
            <input
              id="visit-to"
              type="date"
              className="field mt-1.5"
              value={toFilter}
              onChange={(event) => updateParams({ to: event.target.value || null })}
              aria-label="Visits to date"
            />
          </div>

          {user?.role === "admin" && (
            <>
              <div className="w-full sm:w-48">
                <label htmlFor="visit-technician-filter" className="block text-sm font-medium text-slate-700">
                  Technician
                </label>
                <select
                  id="visit-technician-filter"
                  className="field mt-1.5"
                  value={technicianFilter}
                  onChange={(event) => updateParams({ technician: event.target.value || null })}
                  aria-label="Filter by technician"
                >
                  <option value="">All technicians</option>
                  {technicians.map((technician) => (
                    <option key={technician.id} value={technician.id}>
                      {technician.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="w-full sm:w-48">
                <label htmlFor="visit-barangay-filter" className="block text-sm font-medium text-slate-700">
                  Barangay
                </label>
                <select
                  id="visit-barangay-filter"
                  className="field mt-1.5"
                  value={barangayFilter}
                  onChange={(event) => updateParams({ barangay: event.target.value || null })}
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
            </>
          )}

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

      {/* Derived worklist: assigned households with no contact in 60 days. */}
      {due && (due.total > 0 || followUp || coverage.length > 0) && (
        <section className="card px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h3 className="font-display text-sm font-semibold text-slate-900">Visits due</h3>
            <span className="rounded-pill bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
              {due.total} household{due.total === 1 ? "" : "s"}
            </span>
            <span className="text-[11px] text-slate-500">
              no monitoring or visit in {due.window_days} days
            </span>
            <button
              type="button"
              onClick={() => setFollowUp((previous) => !previous)}
              aria-pressed={followUp}
              className={`ml-auto rounded-pill px-3 py-1 text-[11px] font-semibold transition ${
                followUp
                  ? "bg-brand-700 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Dispersal follow-up
            </button>
          </div>

          {coverage.length > 0 && (
            <p className="mt-2 text-[11px] text-slate-500">
              Coverage (30 days):{" "}
              {coverage
                .map(
                  (row) =>
                    `${row.name} ${row.visited_30d}/${row.assigned}${
                      row.coverage_pct !== null ? ` (${row.coverage_pct}%)` : ""
                    }`,
                )
                .join(" · ")}
            </p>
          )}

          {due.households.length > 0 ? (
            <ul className="mt-2 divide-y divide-slate-100">
              {due.households.map((household) => (
                <li key={household.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                  <Link
                    to={`/dashboard/${roleKey}/beneficiaries/${household.id}/lineage`}
                    className="font-semibold text-slate-900 underline-offset-2 hover:text-brand-800 hover:underline"
                  >
                    {household.name_of_farmer}
                  </Link>
                  <span className="text-slate-500">{household.address}</span>
                  <span className="text-slate-400">
                    · last contact{" "}
                    {household.last_visit_on ?? household.last_monitoring_on ?? "never"}
                  </span>
                  {canLog && (
                    <button
                      type="button"
                      onClick={() =>
                        openLogFor({
                          id: household.id,
                          name_of_farmer: household.name_of_farmer,
                          address: household.address,
                        })
                      }
                      className="ml-auto rounded-pill px-2.5 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100"
                    >
                      Log visit
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              {followUp
                ? "No dispersal follow-ups are overdue."
                : "No households are overdue for a visit."}
            </p>
          )}
        </section>
      )}

      <section className="card overflow-hidden">
        {loading ? (
          <SkeletonList rows={4} />
        ) : visits.length === 0 ? (
          <EmptyState
            title={hasFilters ? "No visits match these filters" : "No field visits yet"}
            description={
              hasFilters
                ? "Clear the filters to see the whole log."
                : canLog
                  ? "Log a visit after each trip out — even one that found nobody home."
                  : "Visits appear here once the field team logs them."
            }
          />
        ) : (
          <>
            <BulkActionBar
              count={selected.size}
              noun="visit"
              onClear={clear}
              onDelete={() => setBulkOpen(true)}
              busy={bulkBusy}
            />

            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-xs">
                <thead className="sticky top-0 z-10 bg-white">
                  <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                    {deletableIds.length > 0 && (
                      <th scope="col" className="w-10 px-4 py-2.5">
                        <SelectAllCheckbox
                          ids={deletableIds}
                          selected={selected}
                          onToggleAll={toggleAll}
                          label="Select all field visits you can delete"
                        />
                      </th>
                    )}
                    <th scope="col" className="px-4 py-2.5 font-semibold">Date</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Farmer</th>
                    <th scope="col" className="hidden px-4 py-2.5 font-semibold md:table-cell">Animal</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Photo</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Purpose</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">On-site location</th>
                    <th scope="col" className="hidden px-4 py-2.5 font-semibold lg:table-cell">Technician</th>
                    <th scope="col" className="w-16 px-4 py-2.5 text-right font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visits.map((visit) => (
                    <tr key={visit.id} className="transition hover:bg-brand-50/40">
                      {deletableIds.length > 0 && (
                        <td className="px-4 py-2.5">
                          {canModify(visit) ? (
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded accent-brand-700"
                              aria-label={`Select visit to ${visit.name_of_farmer}`}
                              checked={selected.has(visit.id)}
                              onChange={() => toggle(visit.id)}
                            />
                          ) : null}
                        </td>
                      )}

                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {formatDate(visit.visited_on)}
                      </td>

                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        <Link
                          to={`/dashboard/${roleKey}/beneficiaries/${visit.beneficiary_id}/lineage`}
                          className="block truncate underline-offset-2 transition hover:text-brand-800 hover:underline"
                          title="Open the household record"
                        >
                          {visit.name_of_farmer}
                        </Link>
                        <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] font-normal text-slate-500">
                          <span>{visit.barangay ?? visit.address}</span>
                          {visit.ear_tag_number && <span>Ear tag {visit.ear_tag_number}</span>}
                          {visit.rsbsa_number && <span>RSBSA {visit.rsbsa_number}</span>}
                        </span>
                      </td>

                      <td className="hidden truncate px-4 py-2.5 text-slate-600 md:table-cell">
                        {visit.animal_type}
                        {visit.sex ? ` (${visit.sex})` : ""}
                      </td>

                      <td className="px-4 py-2.5">
                        {visit.photo?.thumbnail_url ? (
                          <button
                            type="button"
                            onClick={() => setLightbox(visit)}
                            aria-label={`View photo for ${visit.name_of_farmer}`}
                            className="block overflow-hidden rounded ring-1 ring-slate-200 transition hover:ring-brand-400"
                          >
                            <img
                              src={visit.photo.thumbnail_url}
                              alt=""
                              loading="lazy"
                              className="h-9 w-12 object-cover"
                            />
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400">No photo</span>
                        )}
                      </td>

                      <td className="px-4 py-2.5">
                        <span className="rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
                          {purposeLabel(visit.purpose)}
                        </span>
                        {visit.dispersal && (
                          <span className="mt-0.5 block text-[10px] text-slate-500">
                            {visit.dispersal.dispersal_type} · {visit.dispersal.date_dispersed}
                          </span>
                        )}
                        {visit.notes && (
                          <span
                            className="mt-0.5 block max-w-[14rem] truncate text-[11px] text-slate-500"
                            title={visit.notes}
                          >
                            {visit.notes}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <VerificationBadge
                          status={visit.verification_status}
                          distanceM={visit.distance_m}
                          accuracyM={visit.gps_accuracy_m}
                          compact
                        />
                        {visit.has_location ? (
                          <span className="mt-0.5 block text-[11px] text-slate-500">
                            {visit.distance_m !== null && visit.distance_m !== undefined
                              ? `${verificationDistance(visit.distance_m)} from the registered pin`
                              : "Captured on site"}
                          </span>
                        ) : (
                          <span className="mt-0.5 block text-[11px] text-slate-400">
                            Not captured
                          </span>
                        )}
                        {visit.verification_note && (
                          <span
                            className="mt-0.5 block max-w-[16rem] truncate text-[11px] text-slate-500"
                            title={visit.verification_note}
                          >
                            Justification: {visit.verification_note}
                          </span>
                        )}
                      </td>

                      <td className="hidden px-4 py-2.5 whitespace-nowrap text-slate-600 lg:table-cell">
                        {visit.technician?.name ?? "—"}
                      </td>

                      <td className="px-4 py-2.5 text-right">
                        <ActionMenu
                          label={`Actions for visit to ${visit.name_of_farmer}`}
                          items={rowMenuItems(visit)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationFooter
              meta={meta}
              shown={visits.length}
              noun="visit"
              onPageChange={(next) =>
                updateParams({ page: next <= 1 ? null : next }, { resetPage: false })
              }
              pageSize={perPage}
              pageSizeOptions={[25, 50]}
              onPageSizeChange={(size) =>
                updateParams({ per_page: size === 25 ? null : size })
              }
            />
          </>
        )}
      </section>

      <FieldVisitFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initialBeneficiary={initialBeneficiary}
        purposes={purposes}
        visit={editing}
        onsiteThresholdM={threshold}
        onSaved={async () => {
          await load(true);
          setNotice(editing ? "Field visit updated." : "Field visit logged.");
        }}
      />

      {/* Read-only details window, built entirely from the loaded row. */}
      <Modal
        open={detail !== null}
        title="Field visit details"
        onClose={() => setDetail(null)}
      >
        {detail && (
          <div className="space-y-4 text-sm">
            {detail.photo?.image_url && (
              <a
                href={detail.photo.image_url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-xl border border-slate-200"
              >
                <img
                  src={detail.photo.image_url}
                  alt={`Visit photo for ${detail.name_of_farmer}`}
                  className="max-h-52 w-full object-cover"
                />
              </a>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
              {[
                ["Date", formatDate(detail.visited_on)],
                ["Purpose", purposeLabel(detail.purpose)],
                ["Technician", detail.technician?.name ?? "—"],
                ["Farmer", detail.name_of_farmer],
                ["Barangay", detail.barangay ?? detail.address],
                ["RSBSA #", detail.rsbsa_number || "—"],
                ["Ear tag #", detail.ear_tag_number || "—"],
                ["Animal", `${detail.animal_type ?? "—"}${detail.sex ? ` (${detail.sex})` : ""}`],
                ["MOA", detail.moa_signed === null || detail.moa_signed === undefined
                  ? "Not on file"
                  : detail.moa_signed
                    ? "Signed"
                    : "Not signed"],
                ["Verdict", detail.verification_status ?? "Not verified"],
                ["Distance", detail.distance_m !== null && detail.distance_m !== undefined
                  ? `${verificationDistance(detail.distance_m)} from the registered pin`
                  : "Not measured"],
                ["GPS accuracy", detail.gps_accuracy_m !== null && detail.gps_accuracy_m !== undefined
                  ? `${Math.round(detail.gps_accuracy_m)} m`
                  : "—"],
                ["Dispersal", detail.dispersal
                  ? `${detail.dispersal.dispersal_type} on ${detail.dispersal.date_dispersed}`
                  : "Not linked"],
                ["Last monitoring", detail.last_monitored_on || "—"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>

            {detail.notes && (
              <div>
                <p className="text-xs text-slate-500">Notes</p>
                <p className="mt-1 text-sm text-slate-700">{detail.notes}</p>
              </div>
            )}

            {detail.verification_note && (
              <div>
                <p className="text-xs text-slate-500">Justification</p>
                <p className="mt-1 text-sm text-slate-700">{detail.verification_note}</p>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
              <Link
                to={`/dashboard/${roleKey}/beneficiaries/${detail.beneficiary_id}/lineage`}
                className="btn-secondary !px-3.5 !py-1.5 text-xs"
              >
                Open household
              </Link>
              {canModify(detail) && (
                <button
                  type="button"
                  className="btn-primary !px-3.5 !py-1.5 text-xs"
                  onClick={() => {
                    setDetail(null);
                    setEditing(detail);
                    setInitialBeneficiary(null);
                    setFormOpen(true);
                  }}
                >
                  Edit visit
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={lightbox !== null}
        title={`Visit photo — ${lightbox?.name_of_farmer ?? ""}`}
        onClose={() => setLightbox(null)}
      >
        {lightbox?.photo?.image_url && (
          <img
            src={lightbox.photo.image_url}
            alt={`Visit photo for ${lightbox.name_of_farmer}`}
            className="max-h-[70vh] w-full object-contain"
          />
        )}
      </Modal>

      <Modal open={deleting !== null} title="Delete field visit" onClose={() => setDeleting(null)}>
        <p className="text-sm text-slate-600">
          Delete the visit to <strong>{deleting?.name_of_farmer}</strong> on{" "}
          {formatDate(deleting?.visited_on)}? This removes it from the field log and
          cannot be undone.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setDeleting(null)}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={confirmDelete} disabled={removing}>
            {removing ? (
              <>
                <ButtonSpinner />
                Deleting…
              </>
            ) : (
              "Delete visit"
            )}
          </button>
        </div>
      </Modal>

      <Modal
        open={bulkOpen}
        title={`Delete ${selected.size} ${selected.size === 1 ? "field visit" : "field visits"}`}
        onClose={() => setBulkOpen(false)}
      >
        <p className="text-sm text-slate-600">
          Delete <strong>{selected.size}</strong> selected field visit
          {selected.size === 1 ? "" : "s"}? This removes them from the field log
          and cannot be undone.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setBulkOpen(false)}>
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

      <Modal open={noting !== null} title="Justify this visit" onClose={() => setNoting(null)}>
        <p className="text-sm text-slate-600">
          The server measured <strong>{noting?.name_of_farmer}</strong>
          {noting?.distance_m !== null && noting?.distance_m !== undefined
            ? ` ${verificationDistance(noting.distance_m)} from the registered pin`
            : ""}
          {noting?.verification_status === "low_accuracy"
            ? ", and the fix's accuracy radius was wider than the on-site threshold"
            : ""}
          . Add a short reason if you know why — it does not change the
          measurement or block the visit.
        </p>

        <label htmlFor="verification-note" className="mt-4 block text-xs font-semibold text-slate-600">
          Justification (optional)
        </label>
        <textarea
          id="verification-note"
          value={noteText}
          onChange={(event) => setNoteText(event.target.value)}
          maxLength={500}
          rows={3}
          placeholder="e.g. Met the farmer at the alternate site"
          className="field mt-1.5 w-full"
        />
        <p className="mt-1 text-[11px] text-slate-500">{noteText.length}/500</p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setNoting(null)}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={confirmNote} disabled={noteBusy}>
            {noteBusy ? (
              <>
                <ButtonSpinner />
                Saving…
              </>
            ) : (
              "Save justification"
            )}
          </button>
        </div>
      </Modal>

      <Modal
        open={adopting !== null}
        title="Use this visit's location?"
        onClose={() => setAdopting(null)}
      >
        <p className="text-sm text-slate-600">
          <strong>{adopting?.name_of_farmer}</strong> has no registered pin
          (including households created by the Excel import). Adopt the fix
          captured on this visit —{" "}
          {adopting?.latitude}, {adopting?.longitude} — as the household's
          registered location? Every stored verification verdict for the
          household is re-computed, and the change is recorded in the audit
          trail.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setAdopting(null)}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={confirmAdopt} disabled={adoptBusy}>
            {adoptBusy ? (
              <>
                <ButtonSpinner />
                Saving…
              </>
            ) : (
              "Use this location"
            )}
          </button>
        </div>
      </Modal>

      <QrScanner open={scanOpen} onClose={() => setScanOpen(false)} onResult={handleScan} />
    </div>
  );
}
