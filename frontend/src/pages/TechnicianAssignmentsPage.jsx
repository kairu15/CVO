import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../api/adminApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { useToast } from "../context/ToastContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { Modal } from "../components/Modal";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { PaginationFooter } from "../components/PaginationFooter";
import { StatCard } from "../components/StatCard";
import { WorkloadBadge } from "../components/WorkloadBadge";
import { TechnicianProfileDrawer } from "../components/TechnicianProfileDrawer";
import { Icon } from "../components/Icons";
import {
  FilterActions,
  FilterField,
  FilterToolbar,
} from "../components/FilterToolbar";
import { SearchField } from "../components/SearchField";

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: "all", label: "All technicians" },
  { value: "active", label: "Active" },
  { value: "deactivated", label: "Inactive" },
];

const WORKLOAD_OPTIONS = [
  { value: "", label: "Any workload" },
  { value: "unassigned", label: "Unassigned" },
  { value: "light", label: "Light (1-9)" },
  { value: "moderate", label: "Moderate (10-19)" },
  { value: "heavy", label: "Heavy (20+)" },
];

const STATUS_PILL = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  deactivated: "bg-slate-100 text-slate-600 ring-slate-200",
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function initials(name) {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function Avatar({ technician, size = "h-10 w-10" }) {
  if (technician.avatar_url) {
    return (
      <img
        src={technician.avatar_url}
        alt=""
        className={`${size} shrink-0 rounded-xl object-cover ring-1 ring-slate-200`}
      />
    );
  }

  return (
    <span
      className={`${size} grid shrink-0 place-items-center rounded-xl bg-brand-100 font-display text-xs font-bold text-brand-800`}
    >
      {initials(technician.name)}
    </span>
  );
}

function StatusPill({ status }) {
  const inactive = status === "deactivated";
  return (
    <span
      className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ring-1 ${
        STATUS_PILL[status] ?? STATUS_PILL.deactivated
      }`}
    >
      {inactive ? "Inactive" : "Active"}
    </span>
  );
}

/**
 * Admin Technicians screen.
 *
 * The directory is technician-first: quick stats, server-side search/filter
 * controls, workload derived from assigned households, and an on-demand
 * profile drawer. Assignment stays close at hand inside the drawer and the
 * unassigned-households strip, so the screen still does the job the old
 * assignment grid did without duplicating technician records.
 */
export default function TechnicianAssignmentsPage() {
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [summary, setSummary] = useState(null);
  const [barangays, setBarangays] = useState([]);
  const [unassigned, setUnassigned] = useState({ total: 0, households: [] });

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [barangay, setBarangay] = useState("");
  const [workload, setWorkload] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const detailRequest = useRef(0);

  const [assignFor, setAssignFor] = useState(null);
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState(false);
  const [technicianOptions, setTechnicianOptions] = useState([]);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);

      try {
        const result = await adminApi.listTechnicians({
          page,
          per_page: PAGE_SIZE,
          search: debouncedSearch || undefined,
          status,
          barangay: barangay || undefined,
          workload: workload || undefined,
        });

        setRows(result.data);
        setMeta(result.meta);
        setSummary(result.summary);
        setBarangays(result.barangays);
        setUnassigned(result.unassigned);
      } catch (err) {
        if (!quiet) setError(getErrorMessage(err));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [page, debouncedSearch, status, barangay, workload],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Quietly refresh so assignment changes made elsewhere appear without a
  // manual reload.
  useAutoRefresh(load);

  /**
   * The assignment dropdown must offer every active technician, not just the
   * current page. The endpoint caps a page at 50, so walk its pages once.
   */
  const loadTechnicianOptions = useCallback(async () => {
    const first = await adminApi.listUsersPage({ role: "technician", per_page: 50, page: 1 });
    const all = [...(first?.data ?? [])];
    const lastPage = first?.meta?.last_page ?? 1;

    for (let next = 2; next <= lastPage; next += 1) {
      const result = await adminApi.listUsersPage({
        role: "technician",
        per_page: 50,
        page: next,
      });
      all.push(...(result?.data ?? []));
    }

    return all;
  }, []);

  useEffect(() => {
    let active = true;

    loadTechnicianOptions()
      .then((options) => {
        if (active) setTechnicianOptions(options);
      })
      .catch(() => {
        // The directory still renders; an empty picker is preferable to
        // failing the whole page because the optional dropdown did not load.
      });

    return () => {
      active = false;
    };
  }, [loadTechnicianOptions]);

  const loadDetail = useCallback(async (id) => {
    const request = detailRequest.current + 1;
    detailRequest.current = request;

    setDetailLoading(true);
    setDetailError(null);

    try {
      const data = await adminApi.getTechnician(id);
      if (detailRequest.current === request) setDetail(data);
    } catch (err) {
      if (detailRequest.current === request) setDetailError(getErrorMessage(err));
    } finally {
      if (detailRequest.current === request) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) loadDetail(selected.id);
  }, [selected, loadDetail]);

  function openProfile(row) {
    setDetail(null);
    setDetailError(null);
    setSelected(row);
  }

  // Stable identity: the drawer's Escape/scroll-lock effect depends on it,
  // so recreating this every render would refocus the close button and
  // re-apply the body lock on unrelated state updates.
  const closeProfile = useCallback(() => {
    detailRequest.current += 1;
    setSelected(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  function openAssignFor(beneficiary, currentTechnicianId = "") {
    setAssignFor(beneficiary);
    setPick(currentTechnicianId ? String(currentTechnicianId) : "");
  }

  async function saveAssignment() {
    if (!assignFor) return;

    const beneficiaryName = assignFor.name;
    const technicianId = pick === "" ? null : Number(pick);

    setSaving(true);
    try {
      await adminApi.assignTechnician(assignFor.id, technicianId);
      setAssignFor(null);

      const technicianName = technicianOptions.find((t) => t.id === technicianId)?.name;
      toast.success(
        technicianName
          ? `${beneficiaryName} assigned to ${technicianName}.`
          : `Technician cleared for ${beneficiaryName}.`,
      );

      await load(true);
      if (selected) await loadDetail(selected.id);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setStatus("all");
    setBarangay("");
    setWorkload("");
    setPage(1);
  }

  const hasFilters = Boolean(search || status !== "all" || barangay || workload);
  const coverage = (value) => (value === null || value === undefined ? "—" : `${value}%`);

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">User Management</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Technicians
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Manage technician accounts, assignments, and workloads. Each technician sees
              only the households assigned to them.
            </p>
          </div>
          <Link
            to="/dashboard/admin/field-visits"
            className="btn-secondary inline-flex items-center gap-2 rounded-pill px-4 py-2 text-xs font-semibold"
          >
            <Icon name="route" className="h-4 w-4" />
            Field visits
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Total technicians"
          value={summary ? summary.total : "—"}
          hint="Active and inactive"
          icon="users"
        />
        <StatCard
          label="Active"
          value={summary ? summary.active : "—"}
          hint="Can sign in and receive work"
          icon="user"
        />
        <StatCard
          label="Inactive"
          value={summary ? summary.deactivated : "—"}
          hint="Deactivated, records retained"
        />
        <StatCard
          label="With assignments"
          value={summary ? summary.with_assignments : "—"}
          hint="Active with at least 1 household"
          icon="map-pin"
          tone="brand"
        />
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}

      <section className="card px-4 py-3">
        <FilterToolbar
          collapsible
          search={
            <SearchField
              id="technician-search"
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Name or email…"
              ariaLabel="Search technicians"
            />
          }
          actions={
            hasFilters ? (
              <FilterActions>
                <button type="button" onClick={clearFilters} className="filter-reset">
                  <Icon name="close" className="h-3.5 w-3.5" />
                  Clear filters
                </button>
              </FilterActions>
            ) : null
          }
          activeFilters={[
            status !== "all"
              ? {
                  key: "status",
                  label: `Status: ${
                    STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
                  }`,
                  onClear: () => {
                    setStatus("all");
                    setPage(1);
                  },
                }
              : null,
            barangay
              ? {
                  key: "barangay",
                  label: `Barangay: ${barangay}`,
                  onClear: () => {
                    setBarangay("");
                    setPage(1);
                  },
                }
              : null,
            workload
              ? {
                  key: "workload",
                  label: `Workload: ${
                    WORKLOAD_OPTIONS.find((option) => option.value === workload)?.label ?? workload
                  }`,
                  onClear: () => {
                    setWorkload("");
                    setPage(1);
                  },
                }
              : null,
          ].filter(Boolean)}
          onClearAll={clearFilters}
          onReset={clearFilters}
        >
          <FilterField label="Status" htmlFor="technician-status">
            <select
              id="technician-status"
              className="field"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              aria-label="Filter by account status"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Barangay" htmlFor="technician-barangay">
            <select
              id="technician-barangay"
              className="field"
              value={barangay}
              onChange={(event) => {
                setBarangay(event.target.value);
                setPage(1);
              }}
              aria-label="Filter by assigned barangay"
            >
              <option value="">All barangays</option>
              {barangays.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Workload" htmlFor="technician-workload">
            <select
              id="technician-workload"
              className="field"
              value={workload}
              onChange={(event) => {
                setWorkload(event.target.value);
                setPage(1);
              }}
              aria-label="Filter by workload"
            >
              {WORKLOAD_OPTIONS.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>

        </FilterToolbar>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-200/60">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Technician Directory
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {meta ? `${meta.total} ${meta.total === 1 ? "technician" : "technicians"}` : "—"}
              {hasFilters ? " matching the current filters" : ""}
            </p>
          </div>
          <p className="text-[11px] text-slate-500">
            Workload is based on currently assigned households.
          </p>
        </div>

        {loading ? (
          <SkeletonList rows={5} rowClassName="h-16" className="space-y-3 p-5" />
        ) : rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "No technicians match" : "No technicians yet"}
            description={
              hasFilters
                ? "Try a different name, status, barangay, or workload band."
                : "Create a user account in User Management, then assign the Field Technician role."
            }
            action={
              hasFilters ? (
                <button type="button" className="btn-secondary rounded-pill px-4 py-2 text-sm" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : (
                <Link to="/dashboard/admin/users" className="btn-primary rounded-pill px-4 py-2 text-sm">
                  Open User Management
                </Link>
              )
            }
          />
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1.35fr)_minmax(0,1.2fr)_110px_110px_90px_20px] gap-4 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase lg:grid dark:border-slate-200/60 dark:bg-slate-800/40">
              <span>Technician</span>
              <span>Barangays</span>
              <span>Workload</span>
              <span>Visits</span>
              <span>Coverage</span>
              <span />
            </div>

            <ul className="divide-y divide-slate-100 dark:divide-slate-200/60">
              {rows.map((technician) => {
                const barangayPreview = technician.barangays.slice(0, 2).join(" · ");
                const extraBarangays = technician.barangays.length - 2;

                return (
                  <li key={technician.id}>
                    <button
                      type="button"
                      onClick={() => openProfile(technician)}
                      aria-label={`Open profile for ${technician.name}`}
                      className="grid w-full gap-3 px-4 py-3 text-left transition hover:bg-brand-50/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-700 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1.2fr)_110px_110px_90px_20px] lg:items-center lg:gap-4 dark:hover:bg-slate-800/40"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar technician={technician} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {technician.name}
                            </p>
                            <StatusPill status={technician.status} />
                          </div>
                          <p className="truncate text-xs text-slate-500">{technician.email}</p>
                          <p className="mt-0.5 text-[10px] text-slate-400">
                            Joined {formatDate(technician.created_at)}
                          </p>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase lg:hidden">
                          Barangays
                        </p>
                        <p className="truncate text-xs text-slate-700 dark:text-slate-300">
                          {barangayPreview || "No barangay assigned"}
                          {extraBarangays > 0 ? ` +${extraBarangays}` : ""}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {technician.assigned_households}{" "}
                          {technician.assigned_households === 1 ? "household" : "households"}
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase lg:hidden">
                          Workload
                        </p>
                        <WorkloadBadge workload={technician.workload} />
                        <p className="mt-1 text-[10px] text-slate-500">{technician.workload.range}</p>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase lg:hidden">
                          Visits
                        </p>
                        <p className="text-xs text-slate-700 dark:text-slate-300">
                          <span className="font-semibold">{technician.visits_completed}</span>{" "}
                          completed
                        </p>
                        <p
                          className={`text-[11px] ${
                            technician.due_households > 0
                              ? "text-amber-800 dark:text-amber-500"
                              : "text-slate-500"
                          }`}
                        >
                          {technician.due_households} due
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase lg:hidden">
                          Coverage
                        </p>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                            <div
                              className="h-full rounded-full bg-brand-600"
                              style={{ width: `${technician.coverage_pct ?? 0}%` }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-slate-700 tabular-nums dark:text-slate-300">
                            {coverage(technician.coverage_pct)}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] text-slate-500">
                          Last visit {formatDate(technician.last_visit_on)}
                        </p>
                      </div>

                      <Icon
                        name="chevron-down"
                        className="hidden h-4 w-4 -rotate-90 text-slate-400 lg:block"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>

            <PaginationFooter
              meta={meta}
              shown={rows.length}
              noun="technician"
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {unassigned.total > 0 && (
        <section className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Unassigned households
                <span className="ml-2 rounded-pill bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-800 uppercase ring-1 ring-amber-200">
                  {unassigned.total}
                </span>
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Households with no responsible technician. Assign one here or open the full
                directory.
              </p>
            </div>
            <Link
              to="/dashboard/admin/beneficiaries?assignment=unassigned"
              className="text-xs font-semibold text-brand-700 hover:underline"
            >
              View all
            </Link>
          </div>

          <ul className="mt-3 divide-y divide-slate-100">
            {unassigned.households.map((beneficiary) => (
              <li key={beneficiary.id} className="flex items-center gap-3 py-2.5 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{beneficiary.name}</p>
                  <p className="truncate text-slate-500">
                    {beneficiary.animal_type}
                    {beneficiary.sex ? ` (${beneficiary.sex})` : ""} · {beneficiary.address}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openAssignFor(beneficiary, "")}
                  className="ml-auto shrink-0 rounded-pill bg-brand-50 px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100"
                >
                  Assign technician
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <TechnicianProfileDrawer
        open={selected !== null}
        technician={detail}
        loading={detailLoading}
        error={detailError}
        onClose={closeProfile}
        onRetry={() => selected && loadDetail(selected.id)}
        onReassign={(beneficiary) => openAssignFor(beneficiary, selected?.id)}
      />

      <Modal
        open={assignFor !== null}
        title={`Assign technician — ${assignFor?.name ?? ""}`}
        onClose={() => setAssignFor(null)}
        contentClassName="max-w-lg"
      >
        <p className="text-xs text-slate-500">
          Only active technicians can receive households. Choose one below, or clear the
          assignment.
        </p>

        <label
          htmlFor="assign-technician"
          className="mt-4 block text-sm font-medium text-slate-700"
        >
          Responsible technician
        </label>
        <select
          id="assign-technician"
          className="field mt-1.5"
          value={pick}
          onChange={(event) => setPick(event.target.value)}
        >
          <option value="">Unassigned (no technician)</option>
          {technicianOptions.map((technician) => (
            <option key={technician.id} value={technician.id}>
              {technician.name}
            </option>
          ))}
        </select>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setAssignFor(null)}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={saveAssignment} disabled={saving}>
            {saving ? (
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
    </div>
  );
}
