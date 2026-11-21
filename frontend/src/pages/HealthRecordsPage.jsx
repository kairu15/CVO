import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { healthRecordsApi } from "../api/healthRecordsApi";
import { useAutoRefresh } from "../api/queries";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { getErrorMessage } from "../api/client";
import { HealthRecordFormModal, outcomeLabel } from "../components/HealthRecordFormModal";
import { Modal } from "../components/Modal";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { Icon } from "../components/Icons";
import { SelectAllCheckbox } from "../components/SelectAllCheckbox";
import { BulkActionBar } from "../components/BulkActionBar";
import { PaginationFooter } from "../components/PaginationFooter";
import { ActionMenu } from "../components/ActionMenu";
import { useRowSelection } from "../hooks/useRowSelection";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useBarangays } from "../hooks/useBarangays";
import { useAuth } from "../context/AuthContext";
import { getRole } from "../config/roles";

/**
 * Technician "Health Records" screen.
 *
 * Clinical examinations are separate from the monthly monitoring workbook.
 * Every filter is applied server-side before pagination; the overview cards
 * and follow-up counters come from one scoped aggregate. Row visibility and
 * write permission remain server-enforced (HealthRecordService/Policy).
 */

const OUTCOME_TONES = {
  recovered: "bg-brand-100 text-brand-900",
  improving: "bg-sky-50 text-sky-800",
  ongoing: "bg-amber-50 text-amber-800",
  referred: "bg-slate-100 text-slate-700",
  deceased: "bg-red-50 text-red-700",
};

const FOLLOW_UP_TONES = {
  overdue: "bg-red-50 text-red-700 ring-1 ring-red-200",
  upcoming: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  completed: "bg-brand-50 text-brand-800 ring-1 ring-brand-200",
};

const FOLLOW_UP_LABELS = {
  overdue: "Overdue",
  upcoming: "Upcoming",
  completed: "Completed",
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function formatWhen(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function HealthStatusBadge({ outcome, followUpStatus, followUpOn }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {outcome ? (
        <span
          className={`rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${
            OUTCOME_TONES[outcome] ?? OUTCOME_TONES.referred
          }`}
        >
          {outcomeLabel(outcome)}
        </span>
      ) : (
        <span className="rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
          Open
        </span>
      )}

      {followUpStatus && (
        <span
          className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold ${
            FOLLOW_UP_TONES[followUpStatus] ?? FOLLOW_UP_TONES.upcoming
          }`}
          title={followUpOn ? `Follow-up ${formatDate(followUpOn)}` : undefined}
        >
          {FOLLOW_UP_LABELS[followUpStatus] ?? followUpStatus}
        </span>
      )}
    </div>
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

function RecordDetails({
  detail,
  loading,
  error,
  canModify,
  followUpBusy,
  onClose,
  onEdit,
  onToggleFollowUp,
  roleKey,
}) {
  const history = detail?.history ?? (detail ? [detail] : []);

  return (
    <Modal
      open={detail !== null}
      title="Health record details"
      onClose={onClose}
      contentClassName="max-w-3xl"
    >
      {detail && (
        <div className="space-y-5 text-sm">
          {error && <InlineAlert message={error} />}
          {loading && <p className="text-xs text-slate-500">Loading examination history…</p>}

          {detail.photo_url && (
            <a
              href={detail.photo_url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-xl border border-slate-200"
            >
              <img
                src={detail.photo_url}
                alt={`Clinical photo for ${detail.name_of_farmer}`}
                className="max-h-64 w-full object-cover"
              />
            </a>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                  Beneficiary
                </p>
                <p className="mt-1 font-display text-base font-bold text-slate-900">
                  {detail.name_of_farmer}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {detail.address}
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
            <DetailRow label="Examination date" value={formatDate(detail.date_recorded)} />
            <DetailRow
              label="Animal"
              value={`${detail.animal_type ?? "—"}${detail.sex ? ` (${detail.sex})` : ""}`}
            />
            <DetailRow label="Animals examined" value={String(detail.animal_quantity ?? 1)} />
            <DetailRow label="Barangay" value={detail.barangay ?? detail.address} />
            <DetailRow label="Health status" value={outcomeLabel(detail.outcome)} />
            <DetailRow label="Recorded by" value={detail.doctor?.name ?? "—"} />
            <DetailRow label="Follow-up date" value={formatDate(detail.follow_up_on)} />
            <DetailRow
              label="Follow-up status"
              value={
                detail.follow_up_status
                  ? FOLLOW_UP_LABELS[detail.follow_up_status] ?? detail.follow_up_status
                  : "Not scheduled"
              }
            />
            <DetailRow
              label="Follow-up completed"
              value={formatWhen(detail.follow_up_completed_at)}
            />
          </dl>

          {detail.symptoms && (
            <div>
              <p className="text-xs font-semibold text-slate-500">Observations / symptoms</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{detail.symptoms}</p>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-slate-500">Diagnosis</p>
            <p className="mt-1 text-sm text-slate-700">{detail.diagnosis}</p>
          </div>

          {detail.treatment && (
            <div>
              <p className="text-xs font-semibold text-slate-500">Treatment</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{detail.treatment}</p>
            </div>
          )}

          {detail.remarks && (
            <div>
              <p className="text-xs font-semibold text-slate-500">
                Recommendations / follow-up notes
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{detail.remarks}</p>
            </div>
          )}

          <div className="rounded-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h4 className="font-display text-sm font-semibold text-slate-900">
                  Health history
                </h4>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Earlier examinations are preserved, never overwritten.
                </p>
              </div>
              <span className="rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                {history.length} {history.length === 1 ? "examination" : "examinations"}
              </span>
            </div>

            <ol className="space-y-0 divide-y divide-slate-100">
              {history.map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-900">
                        {formatDate(item.date_recorded)}
                      </span>
                      {item.id === detail.id && (
                        <span className="rounded-pill bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-900">
                          This record
                        </span>
                      )}
                      <HealthStatusBadge
                        outcome={item.outcome}
                        followUpStatus={item.follow_up_status}
                        followUpOn={item.follow_up_on}
                      />
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {item.doctor?.name ?? "—"}
                    </span>
                  </div>

                  <p className="mt-1.5 text-xs font-medium text-slate-800">{item.diagnosis}</p>
                  {item.symptoms && (
                    <p className="mt-1 text-xs text-slate-600">
                      <span className="font-medium text-slate-700">Observations:</span>{" "}
                      {item.symptoms}
                    </p>
                  )}
                  {item.treatment && (
                    <p className="mt-1 text-xs text-slate-600">
                      <span className="font-medium text-slate-700">Treatment:</span>{" "}
                      {item.treatment}
                    </p>
                  )}
                  {item.follow_up_on && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Follow-up {formatDate(item.follow_up_on)}
                      {item.follow_up_completed_at
                        ? ` · completed ${formatWhen(item.follow_up_completed_at)}`
                        : ""}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
            {canModify(detail) && detail.follow_up_on && detail.follow_up_status !== "completed" && (
              <button
                type="button"
                className="btn-secondary !px-3.5 !py-1.5 text-xs"
                onClick={() => onToggleFollowUp(detail, true)}
                disabled={followUpBusy}
              >
                {followUpBusy ? "Saving…" : "Mark follow-up complete"}
              </button>
            )}
            {canModify(detail) && detail.follow_up_status === "completed" && (
              <button
                type="button"
                className="btn-secondary !px-3.5 !py-1.5 text-xs"
                onClick={() => onToggleFollowUp(detail, false)}
                disabled={followUpBusy}
              >
                {followUpBusy ? "Saving…" : "Reopen follow-up"}
              </button>
            )}
            {canModify(detail) && (
              <button
                type="button"
                className="btn-primary !px-3.5 !py-1.5 text-xs"
                onClick={() => onEdit(detail)}
              >
                Edit record
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function HealthRecordsPage({ roleKey = "technician" }) {
  const { user } = useAuth();
  const config = getRole(roleKey);
  const [params, setParams] = useSearchParams();
  const [barangays] = useBarangays();

  const [records, setRecords] = useState([]);
  const [meta, setMeta] = useState(null);
  const [summary, setSummary] = useState({});
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [outcomes, setOutcomes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const { selected, toggle, toggleAll, clear } = useRowSelection();

  const canAuthor = user?.role === "technician";
  const canModify = useCallback(
    (record) =>
      user?.role === "admin" ||
      (user?.role === "technician" && record.doctor_id === user?.id),
    [user?.id, user?.role],
  );

  const searchTerm = params.get("search") ?? "";
  const statusFilter = params.get("status") ?? "all";
  const barangayFilter = params.get("barangay") ?? "";
  const fromFilter = params.get("from") ?? "";
  const toFilter = params.get("to") ?? "";
  const sort = params.get("sort") ?? "date";
  const direction = params.get("direction") ?? "desc";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const perPage = Number(params.get("per_page") ?? "15") || 15;

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

  const [searchInput, setSearchInput] = useState(searchTerm);
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if ((params.get("search") ?? "") === debouncedSearch) return;
    updateParams({ search: debouncedSearch || null });
  }, [debouncedSearch, params, updateParams]);

  useEffect(() => {
    if (searchTerm === searchInput) return;
    setSearchInput(searchTerm);
    // Only mirror an external URL change into the input; typing owns state.
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
        const [recordsRes, summaryRes] = await Promise.all([
          healthRecordsApi.list({ ...filters, per_page: perPage, page }),
          healthRecordsApi.summary().catch(() => null),
        ]);

        setRecords(recordsRes?.data ?? []);
        setMeta(recordsRes?.meta ?? null);
        if (summaryRes) setSummary(summaryRes);
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

  useEffect(() => {
    let active = true;

    healthRecordsApi
      .options()
      .then((res) => {
        if (active) setOutcomes(res?.outcomes ?? []);
      })
      .catch(() => {
        // The table still works; the form's outcome list falls back empty.
      });

    if (canAuthor) {
      beneficiariesApi
        .list({ per_page: 50 })
        .then((res) => {
          if (active) setBeneficiaries(res ?? []);
        })
        .catch(() => {
          if (active) setBeneficiaries([]);
        });
    }

    return () => {
      active = false;
    };
  }, [canAuthor]);

  const deletableIds = records.filter(canModify).map((record) => record.id);
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

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(record) {
    setEditing(record);
    setDetail(null);
    setFormOpen(true);
  }

  async function openDetail(record) {
    setDetail(record);
    setDetailError(null);
    setDetailLoading(true);

    try {
      const full = await healthRecordsApi.get(record.id);
      setDetail(full);
    } catch (err) {
      setDetailError(getErrorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  }

  async function toggleFollowUp(record, completed) {
    setFollowUpBusy(true);
    setError(null);

    try {
      const saved = await healthRecordsApi.update(record.id, {
        follow_up_completed: completed,
      });

      setDetail((previous) => {
        if (!previous || previous.id !== saved.id) return previous;

        return {
          ...previous,
          ...saved,
          history: previous.history?.map((item) =>
            item.id === saved.id ? { ...item, ...saved } : item,
          ),
        };
      });
      await load(true);
      setNotice(completed ? "Follow-up marked complete." : "Follow-up reopened.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setFollowUpBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;

    setRemoving(true);
    setError(null);

    try {
      await healthRecordsApi.remove(deleting.id);
      const removed = deleting;
      setDeleting(null);
      await load(true);
      setNotice(`Deleted the record for ${removed.name_of_farmer}.`);
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
      const result = await healthRecordsApi.bulkRemove([...selected]);
      const failed = result?.failed_ids?.length ?? 0;

      setBulkOpen(false);
      clear();
      await load(true);
      setNotice(
        failed > 0
          ? `Deleted ${result.deleted} of ${result.deleted + failed} records; ${failed} could not be deleted.`
          : `Deleted ${result.deleted} ${result.deleted === 1 ? "record" : "records"}.`,
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBulkBusy(false);
    }
  }

  function rowMenuItems(record) {
    const items = [
      { label: "View details", onClick: () => openDetail(record) },
      {
        label: "Open household",
        to: `/dashboard/${roleKey}/beneficiaries/${record.beneficiary_id}/lineage`,
      },
    ];

    if (canModify(record)) {
      if (record.follow_up_on && record.follow_up_status !== "completed") {
        items.push({
          label: "Mark follow-up complete",
          onClick: () => toggleFollowUp(record, true),
        });
      }
      if (record.follow_up_status === "completed") {
        items.push({
          label: "Reopen follow-up",
          onClick: () => toggleFollowUp(record, false),
        });
      }
      items.push({
        label: "Edit",
        ariaLabel: `Edit record for ${record.name_of_farmer}`,
        onClick: () => openEdit(record),
      });
      items.push({
        label: "Delete",
        ariaLabel: `Delete record for ${record.name_of_farmer}`,
        onClick: () => setDeleting(record),
      });
    }

    return items;
  }

  const overview = [
    {
      key: "total",
      label: "Total health records",
      value: summary.total_health_records,
      hint: "all examinations",
      status: null,
    },
    {
      key: "healthy",
      label: "Healthy animals",
      value: summary.healthy_animals,
      hint: "latest exam recovered",
      status: "healthy",
    },
    {
      key: "observation",
      label: "Under observation",
      value: summary.observation_animals,
      hint: "latest exam open or improving",
      status: "observation",
    },
    {
      key: "follow_up",
      label: "Requiring follow-up",
      value: summary.follow_up_required,
      hint:
        summary.follow_up_overdue > 0
          ? `${summary.follow_up_overdue} overdue`
          : "scheduled rechecks",
      status: "follow_up",
    },
  ];

  const followUpCards = [
    { label: "Upcoming", value: summary.follow_up_upcoming, status: "upcoming" },
    { label: "Overdue", value: summary.follow_up_overdue, status: "overdue" },
    { label: "Completed", value: summary.follow_up_completed, status: "completed" },
  ];

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{config?.label ?? "Technician"}</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Health Records
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Clinical examinations, treatments, and follow-ups for program
              animals. Every record is preserved in the animal&apos;s history.
            </p>
          </div>

          {canAuthor && (
            <button type="button" onClick={openCreate} className="btn-primary">
              <Icon name="medical-cross" className="h-4 w-4" />
              New record
            </button>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {overview.map((tile) => {
            const active = tile.status === null
              ? statusFilter === "all"
              : statusFilter === tile.status;

            return (
              <button
                key={tile.key}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  updateParams({ status: tile.status === null ? null : tile.status })
                }
                className={`rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:border-brand-400 hover:bg-brand-50/40 ${
                  active ? "border-brand-500 ring-1 ring-brand-500/30" : ""
                }`}
              >
                <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
                  {tile.label}
                </p>
                <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
                  {tile.value ?? "—"}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">{tile.hint}</p>
              </button>
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

      <section className="card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Follow-up monitoring
          </h3>
          <span className="text-[11px] text-slate-500">
            Scheduled rechecks, overdue work, and completed visits.
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {followUpCards.map((card) => {
            const active = statusFilter === card.status;
            const overdue = card.status === "overdue" && (card.value ?? 0) > 0;

            return (
              <button
                key={card.status}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  updateParams({ status: active ? null : card.status })
                }
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  overdue
                    ? "border-red-200 bg-red-50/60 hover:border-red-300"
                    : "border-slate-200 hover:border-brand-400 hover:bg-brand-50/40"
                } ${active ? "ring-1 ring-brand-500/40" : ""}`}
              >
                <span className="block text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                  {card.label}
                </span>
                <span
                  className={`mt-0.5 block font-display text-lg font-bold tabular-nums ${
                    overdue ? "text-red-700" : "text-slate-900"
                  }`}
                >
                  {card.value ?? "—"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-60">
            <label htmlFor="health-search" className="block text-sm font-medium text-slate-700">
              Search
            </label>
            <div className="relative mt-1.5">
              <Icon
                name="search"
                className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-400"
              />
              <input
                id="health-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Farmer, RSBSA #, ear tag, diagnosis…"
                className="field pl-9"
              />
            </div>
          </div>

          <div className="w-full sm:w-44">
            <label htmlFor="health-status" className="block text-sm font-medium text-slate-700">
              Health status
            </label>
            <select
              id="health-status"
              className="field mt-1.5"
              value={statusFilter}
              onChange={(event) =>
                updateParams({ status: event.target.value === "all" ? null : event.target.value })
              }
            >
              <option value="all">All records</option>
              <option value="healthy">Healthy</option>
              <option value="observation">Under observation</option>
              <option value="follow_up">Follow-up required</option>
              <option value="overdue">Follow-up overdue</option>
              <option value="upcoming">Follow-up upcoming</option>
              <option value="completed">Follow-up completed</option>
            </select>
          </div>

          <div className="w-full sm:w-44">
            <label htmlFor="health-barangay" className="block text-sm font-medium text-slate-700">
              Barangay
            </label>
            <select
              id="health-barangay"
              className="field mt-1.5"
              value={barangayFilter}
              onChange={(event) => updateParams({ barangay: event.target.value || null })}
            >
              <option value="">All barangays</option>
              {barangays.map((barangay) => (
                <option key={barangay.name} value={barangay.name}>
                  {barangay.name}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-36">
            <label htmlFor="health-from" className="block text-sm font-medium text-slate-700">
              From
            </label>
            <input
              id="health-from"
              type="date"
              className="field mt-1.5"
              value={fromFilter}
              onChange={(event) => updateParams({ from: event.target.value || null })}
            />
          </div>

          <div className="w-full sm:w-36">
            <label htmlFor="health-to" className="block text-sm font-medium text-slate-700">
              To
            </label>
            <input
              id="health-to"
              type="date"
              className="field mt-1.5"
              value={toFilter}
              onChange={(event) => updateParams({ to: event.target.value || null })}
            />
          </div>

          <div className="w-full sm:w-44">
            <label htmlFor="health-sort" className="block text-sm font-medium text-slate-700">
              Sort
            </label>
            <select
              id="health-sort"
              className="field mt-1.5"
              value={`${sort}:${direction}`}
              onChange={(event) => {
                const [nextSort, nextDirection] = event.target.value.split(":");
                updateParams({ sort: nextSort, direction: nextDirection });
              }}
            >
              <option value="date:desc">Newest examination</option>
              <option value="date:asc">Oldest examination</option>
              <option value="farmer:asc">Farmer A–Z</option>
              <option value="farmer:desc">Farmer Z–A</option>
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

      <section className="card overflow-hidden">
        {loading ? (
          <SkeletonList rows={4} />
        ) : records.length === 0 ? (
          <EmptyState
            title={hasFilters ? "No records match these filters" : "No health records yet"}
            description={
              hasFilters
                ? "Clear the filters to see the full examination history."
                : canAuthor
                  ? "Records you author appear here, with their follow-up schedule and history."
                  : "Health records appear here once a technician has examined an animal."
            }
          />
        ) : (
          <>
            <BulkActionBar
              count={selected.size}
              noun="record"
              onClear={clear}
              onDelete={() => setBulkOpen(true)}
              busy={bulkBusy}
            />

            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-xs">
                <thead className="sticky top-0 z-10 bg-white">
                  <tr className="border-b border-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                    {deletableIds.length > 0 && (
                      <th scope="col" className="w-10 px-4 py-2.5">
                        <SelectAllCheckbox
                          ids={deletableIds}
                          selected={selected}
                          onToggleAll={toggleAll}
                          label="Select all health records you can delete"
                        />
                      </th>
                    )}
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      <button
                        type="button"
                        onClick={() =>
                          updateParams({
                            sort: "farmer",
                            direction: sort === "farmer" && direction === "asc" ? "desc" : "asc",
                          })
                        }
                        className="inline-flex items-center gap-1 uppercase hover:text-brand-800"
                      >
                        Beneficiary
                        {sort === "farmer" && (
                          <Icon
                            name="chevron-down"
                            className={`h-3 w-3 ${direction === "asc" ? "rotate-180" : ""}`}
                          />
                        )}
                      </button>
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Animal</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Barangay</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Health status</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      <button
                        type="button"
                        onClick={() =>
                          updateParams({
                            sort: "date",
                            direction: sort === "date" && direction === "desc" ? "asc" : "desc",
                          })
                        }
                        className="inline-flex items-center gap-1 uppercase hover:text-brand-800"
                      >
                        Examination
                        {sort === "date" && (
                          <Icon
                            name="chevron-down"
                            className={`h-3 w-3 ${direction === "asc" ? "rotate-180" : ""}`}
                          />
                        )}
                      </button>
                    </th>
                    <th scope="col" className="w-16 px-4 py-2.5 text-right font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {records.map((record) => (
                    <tr key={record.id} className="transition hover:bg-brand-50/40">
                      {deletableIds.length > 0 && (
                        <td className="px-4 py-2.5">
                          {canModify(record) ? (
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded accent-brand-700"
                              aria-label={`Select record for ${record.name_of_farmer}`}
                              checked={selected.has(record.id)}
                              onChange={() => toggle(record.id)}
                            />
                          ) : null}
                        </td>
                      )}

                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => openDetail(record)}
                          className="block max-w-[15rem] truncate text-left font-medium text-slate-900 underline-offset-2 hover:text-brand-800 hover:underline"
                          title="View examination details"
                        >
                          {record.name_of_farmer}
                        </button>
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          {record.rsbsa_number ? `RSBSA ${record.rsbsa_number}` : record.ear_tag_number ? `Ear tag ${record.ear_tag_number}` : "—"}
                        </span>
                      </td>

                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {record.animal_type}
                        {record.sex ? ` (${record.sex})` : ""}
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          {record.animal_quantity ?? 1}{" "}
                          {(record.animal_quantity ?? 1) === 1 ? "head" : "heads"}
                        </span>
                      </td>

                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {record.barangay ?? record.address}
                      </td>

                      <td className="px-4 py-2.5">
                        <HealthStatusBadge
                          outcome={record.outcome}
                          followUpStatus={record.follow_up_status}
                          followUpOn={record.follow_up_on}
                        />
                        <span className="mt-0.5 block max-w-[16rem] truncate text-[11px] text-slate-500" title={record.diagnosis}>
                          {record.diagnosis}
                        </span>
                      </td>

                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {formatDate(record.date_recorded)}
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          by {record.doctor?.name ?? "—"}
                        </span>
                        {record.follow_up_on && (
                          <span
                            className={`mt-0.5 block text-[11px] ${
                              record.follow_up_status === "overdue"
                                ? "font-semibold text-red-700"
                                : "text-slate-500"
                            }`}
                          >
                            Follow-up {formatDate(record.follow_up_on)}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-2.5 text-right">
                        <ActionMenu
                          label={`Actions for ${record.name_of_farmer}`}
                          items={rowMenuItems(record)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationFooter
              meta={meta}
              shown={records.length}
              noun="record"
              onPageChange={(next) =>
                updateParams({ page: next <= 1 ? null : next }, { resetPage: false })
              }
              pageSize={perPage}
              pageSizeOptions={[15, 25, 50]}
              onPageSizeChange={(size) =>
                updateParams({ per_page: size === 15 ? null : size })
              }
            />
          </>
        )}
      </section>

      <HealthRecordFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        beneficiaries={beneficiaries}
        outcomes={outcomes}
        record={editing}
        onSaved={async () => {
          await load(true);
          setNotice(editing ? "Health record updated." : "Health record saved.");
        }}
      />

      <RecordDetails
        detail={detail}
        loading={detailLoading}
        error={detailError}
        canModify={canModify}
        followUpBusy={followUpBusy}
        onClose={() => setDetail(null)}
        onEdit={openEdit}
        onToggleFollowUp={toggleFollowUp}
        roleKey={roleKey}
      />

      <Modal
        open={deleting !== null}
        title="Delete health record"
        onClose={() => setDeleting(null)}
      >
        <p className="text-sm text-slate-600">
          Delete the record for <strong>{deleting?.name_of_farmer}</strong> dated{" "}
          {formatDate(deleting?.date_recorded)}? This removes the diagnosis from the
          animal&apos;s history and cannot be undone.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setDeleting(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={confirmDelete}
            disabled={removing}
          >
            {removing ? (
              <>
                <ButtonSpinner />
                Deleting…
              </>
            ) : (
              "Delete record"
            )}
          </button>
        </div>
      </Modal>

      <Modal
        open={bulkOpen}
        title={`Delete ${selected.size} ${selected.size === 1 ? "health record" : "health records"}`}
        onClose={() => setBulkOpen(false)}
      >
        <p className="text-sm text-slate-600">
          Delete <strong>{selected.size}</strong> selected health record
          {selected.size === 1 ? "" : "s"}? This removes them from the animals&apos;
          histories and cannot be undone.
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
    </div>
  );
}
