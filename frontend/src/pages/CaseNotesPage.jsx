import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { caseNotesApi } from "../api/caseNotesApi";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { getErrorMessage } from "../api/client";
import { useAutoRefresh } from "../api/queries";
import { useBarangays } from "../hooks/useBarangays";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useRowSelection } from "../hooks/useRowSelection";
import { useAuth } from "../context/AuthContext";
import { getRole } from "../config/roles";
import { CaseNoteFormModal } from "../components/CaseNoteFormModal";
import { CaseFollowUpModal } from "../components/CaseFollowUpModal";
import { Modal } from "../components/Modal";
import { ActionMenu } from "../components/ActionMenu";
import { InlineAlert } from "../components/InlineAlert";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { PaginationFooter } from "../components/PaginationFooter";
import { SelectAllCheckbox } from "../components/SelectAllCheckbox";
import { BulkActionBar } from "../components/BulkActionBar";
import { Icon } from "../components/Icons";
import {
  CASE_CATEGORY_TONES,
  CASE_FOLLOW_UP_TONES,
  CASE_STATUS_TONES,
  caseCategoryLabel,
  caseFollowUpLabel,
  caseStatusLabel,
  formatCaseDate,
  formatCaseDateTime,
} from "../lib/caseLabels";

const ACTIVE_CARD =
  "border-brand-500 ring-1 ring-brand-500/30 bg-brand-50/30";
const CARD =
  "rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:border-brand-400 hover:bg-brand-50/40";

function StatusBadge({ status }) {
  return (
    <span
      className={`rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${
        CASE_STATUS_TONES[status] ?? CASE_STATUS_TONES.open
      }`}
    >
      {caseStatusLabel(status)}
    </span>
  );
}

function FollowUpBadge({ status, date }) {
  if (!status && !date) {
    return <span className="text-[11px] text-slate-400">No follow-up</span>;
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span
        className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold ${
          CASE_FOLLOW_UP_TONES[status] ?? "bg-slate-100 text-slate-600"
        }`}
      >
        {caseFollowUpLabel(status)}
      </span>
      {date && <span className="text-[10px] text-slate-500">{formatCaseDate(date)}</span>}
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

/**
 * Merge the original case report and every append-only update into one
 * chronological timeline. The update rows themselves are never rewritten.
 */
function timelineFor(detail) {
  if (!detail) return [];

  const events = [
    {
      key: "case-opened",
      date: detail.date_reported ?? detail.date_noted,
      title: "Case opened",
      observations: detail.body ?? detail.observations,
      actions: detail.actions_taken,
      recommendations: detail.recommendations,
      doctor: detail.doctor,
      status: detail.status,
      followUp: detail.follow_up_on,
    },
    ...(detail.updates ?? []).map((update) => ({
      key: `update-${update.id}`,
      date: update.happened_on,
      title: update.status ? "Status / progress update" : "Follow-up update",
      observations: update.observations,
      actions: update.actions_taken,
      recommendations: update.recommendations,
      doctor: update.doctor,
      status: update.status,
      followUp: update.follow_up_on,
      healthRecord: update.health_record,
      fieldVisit: update.field_visit,
      id: update.id,
    })),
  ];

  return events.sort((left, right) => {
    const byDate = String(left.date ?? "").localeCompare(String(right.date ?? ""));
    if (byDate !== 0) return byDate;
    return String(left.key).localeCompare(String(right.key));
  });
}

function CaseDetailDrawer({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined;

    function onKey(event) {
      if (event.key === "Escape") onClose();
    }

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
        aria-label="Case details"
        className="absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
              Case management
            </p>
            <h3 className="mt-0.5 font-display text-lg font-bold text-slate-900">
              Case details
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close case details"
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

function CaseDetailModal({
  detail,
  loading,
  error,
  canModify,
  canAddUpdate,
  followUpBusy,
  onClose,
  onEdit,
  onAddFollowUp,
  onToggleFollowUp,
  roleKey,
}) {
  const timeline = timelineFor(detail);
  const relatedHealth = detail?.related_health_records ?? [];
  const relatedVisits = detail?.related_field_visits ?? [];

  return (
    <CaseDetailDrawer open={detail !== null} onClose={onClose}>
      {detail && (
        <div className="space-y-5 text-sm">
          {loading && <p className="text-xs text-slate-500">Loading case history…</p>}
          {error && <InlineAlert message={error} />}

          {detail.photo_url && (
            <a
              href={detail.photo_url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-xl border border-slate-200"
            >
              <img
                src={detail.photo_url}
                alt={`Supporting photo for case ${detail.reference_number ?? detail.id}`}
                className="max-h-64 w-full object-cover"
              />
            </a>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                    {detail.reference_number ?? "Case"}
                  </span>
                  <StatusBadge status={detail.status} />
                  <span
                    className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold ${
                      CASE_CATEGORY_TONES[detail.category] ?? CASE_CATEGORY_TONES.general
                    }`}
                  >
                    {caseCategoryLabel(detail.category)}
                  </span>
                </div>
                <p className="mt-2 font-display text-base font-bold text-slate-900">
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
            <DetailRow label="Date reported" value={formatCaseDate(detail.date_reported)} />
            <DetailRow
              label="Animal"
              value={`${detail.animal_type ?? "—"}${detail.sex ? ` (${detail.sex})` : ""}`}
            />
            <DetailRow label="Location / sitio" value={detail.location ?? detail.address} />
            <DetailRow label="Recorded by" value={detail.doctor?.name ?? "—"} />
            <DetailRow label="Follow-up date" value={formatCaseDate(detail.follow_up_on)} />
            <DetailRow
              label="Follow-up status"
              value={
                detail.follow_up_status
                  ? caseFollowUpLabel(detail.follow_up_status)
                  : "Not scheduled"
              }
            />
            <DetailRow
              label="Follow-up completed"
              value={
                detail.follow_up_completed_at
                  ? formatCaseDateTime(detail.follow_up_completed_at)
                  : "Not completed"
              }
            />
            <DetailRow
              label="Resolved"
              value={detail.resolved_at ? formatCaseDateTime(detail.resolved_at) : "Not resolved"}
            />
            <DetailRow
              label="Timeline entries"
              value={String((detail.updates?.length ?? 0) + 1)}
            />
          </dl>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold text-slate-500">Initial observations</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {detail.body ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500">Actions taken</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {detail.actions_taken ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500">Recommendations</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {detail.recommendations ?? "—"}
              </p>
            </div>
          </div>

          {(detail.health_record || detail.field_visit) && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
              <p className="text-[10px] font-semibold tracking-wider text-brand-800 uppercase">
                Linked to this case
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {detail.health_record && (
                  <div className="rounded-lg bg-white p-3 text-xs ring-1 ring-brand-100">
                    <p className="font-semibold text-slate-900">Health examination</p>
                    <p className="mt-0.5 text-slate-600">
                      {formatCaseDate(detail.health_record.date_recorded)} ·{" "}
                      {detail.health_record.diagnosis}
                    </p>
                    <p className="mt-0.5 text-slate-500">
                      Outcome: {detail.health_record.outcome ?? "Open"}
                    </p>
                  </div>
                )}
                {detail.field_visit && (
                  <div className="rounded-lg bg-white p-3 text-xs ring-1 ring-brand-100">
                    <p className="font-semibold text-slate-900">Field visit</p>
                    <p className="mt-0.5 text-slate-600">
                      {formatCaseDate(detail.field_visit.visited_on)} ·{" "}
                      {detail.field_visit.purpose?.replace("-", " ") ?? "visit"}
                    </p>
                    {detail.field_visit.notes && (
                      <p className="mt-0.5 line-clamp-2 text-slate-500">
                        {detail.field_visit.notes}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div>
                <h4 className="font-display text-sm font-semibold text-slate-900">
                  Case history timeline
                </h4>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Original observations and every follow-up are preserved in order.
                </p>
              </div>
              <span className="rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                {timeline.length} {timeline.length === 1 ? "entry" : "entries"}
              </span>
            </div>

            <ol className="divide-y divide-slate-100">
              {timeline.map((event) => (
                <li key={event.key} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-900">
                        {formatCaseDate(event.date)}
                      </span>
                      <span className="rounded-pill bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        {event.title}
                      </span>
                      {event.status && <StatusBadge status={event.status} />}
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {event.doctor?.name ?? "—"}
                    </span>
                  </div>

                  {event.observations && (
                    <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
                      {event.observations}
                    </p>
                  )}
                  {event.actions && (
                    <p className="mt-1 text-xs text-slate-600">
                      <span className="font-semibold text-slate-700">Actions:</span>{" "}
                      {event.actions}
                    </p>
                  )}
                  {event.recommendations && (
                    <p className="mt-1 text-xs text-slate-600">
                      <span className="font-semibold text-slate-700">Recommendations:</span>{" "}
                      {event.recommendations}
                    </p>
                  )}
                  {event.followUp && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Follow-up: {formatCaseDate(event.followUp)}
                    </p>
                  )}
                  {event.healthRecord && (
                    <p className="mt-1 text-[11px] font-medium text-brand-800">
                      Linked health record · {event.healthRecord.diagnosis}
                    </p>
                  )}
                  {event.fieldVisit && (
                    <p className="mt-1 text-[11px] font-medium text-brand-800">
                      Linked field visit · {formatCaseDate(event.fieldVisit.visited_on)}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {(relatedHealth.length > 0 || relatedVisits.length > 0) && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-display text-sm font-semibold text-slate-900">
                    Related health examinations
                  </h4>
                  <Link
                    to={`/dashboard/${roleKey}/health-records?search=${encodeURIComponent(detail.name_of_farmer)}`}
                    className="text-[11px] font-semibold text-brand-800 hover:underline"
                  >
                    Open
                  </Link>
                </div>
                {relatedHealth.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">No examinations on record.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {relatedHealth.slice(0, 5).map((record) => (
                      <li key={record.id} className="text-xs text-slate-600">
                        <span className="font-medium text-slate-800">
                          {formatCaseDate(record.date_recorded)}
                        </span>{" "}
                        · {record.diagnosis}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-display text-sm font-semibold text-slate-900">
                    Related field visits
                  </h4>
                  <Link
                    to={`/dashboard/${roleKey}/field-visits?search=${encodeURIComponent(detail.name_of_farmer)}`}
                    className="text-[11px] font-semibold text-brand-800 hover:underline"
                  >
                    Open
                  </Link>
                </div>
                {relatedVisits.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">No field visits on record.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {relatedVisits.slice(0, 5).map((visit) => (
                      <li key={visit.id} className="text-xs text-slate-600">
                        <span className="font-medium text-slate-800">
                          {formatCaseDate(visit.visited_on)}
                        </span>{" "}
                        · {visit.purpose?.replace("-", " ") ?? "visit"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
            {canAddUpdate && detail.follow_up_on && detail.follow_up_status !== "completed" && (
              <button
                type="button"
                className="btn-secondary !px-3.5 !py-1.5 text-xs"
                onClick={() => onToggleFollowUp(detail, true)}
                disabled={followUpBusy}
              >
                {followUpBusy ? "Saving…" : "Mark follow-up complete"}
              </button>
            )}
            {canAddUpdate && detail.follow_up_status === "completed" && (
              <button
                type="button"
                className="btn-secondary !px-3.5 !py-1.5 text-xs"
                onClick={() => onToggleFollowUp(detail, false)}
                disabled={followUpBusy}
              >
                {followUpBusy ? "Saving…" : "Reopen follow-up"}
              </button>
            )}
            {canAddUpdate && (
              <button
                type="button"
                className="btn-secondary !px-3.5 !py-1.5 text-xs"
                onClick={() => onAddFollowUp(detail)}
              >
                Add follow-up note
              </button>
            )}
            {canModify(detail) && (
              <button
                type="button"
                className="btn-primary !px-3.5 !py-1.5 text-xs"
                onClick={() => onEdit(detail)}
              >
                Edit case
              </button>
            )}
          </div>
        </div>
      )}
    </CaseDetailDrawer>
  );
}

export default function CaseNotesPage({ roleKey = "technician" }) {
  const { user } = useAuth();
  const config = getRole(roleKey);
  const [params, setParams] = useSearchParams();
  const [barangays] = useBarangays();

  const [cases, setCases] = useState([]);
  const [meta, setMeta] = useState(null);
  const [summary, setSummary] = useState({});
  const [options, setOptions] = useState({});
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [followUpCase, setFollowUpCase] = useState(null);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const { selected, toggle, toggleAll, clear } = useRowSelection();

  const canAuthor = user?.role === "technician";
  const canAddUpdate = user?.role === "technician";
  const canModify = useCallback(
    (caseItem) =>
      user?.role === "admin" ||
      (user?.role === "technician" && caseItem.doctor_id === user?.id),
    [user?.id, user?.role],
  );

  const searchTerm = params.get("search") ?? "";
  const statusFilter = params.get("status") ?? "all";
  const categoryFilter = params.get("category") ?? "";
  const barangayFilter = params.get("barangay") ?? "";
  const followUpFilter = params.get("follow_up") ?? "";
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
      category: categoryFilter || undefined,
      barangay: barangayFilter || undefined,
      follow_up: followUpFilter || undefined,
      sort,
      direction,
    }),
    [searchTerm, statusFilter, categoryFilter, barangayFilter, followUpFilter, sort, direction],
  );

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);

      try {
        const [casesRes, summaryRes] = await Promise.all([
          caseNotesApi.list({ ...filters, per_page: perPage, page }),
          caseNotesApi.summary().catch(() => null),
        ]);

        setCases(casesRes?.data ?? []);
        setMeta(casesRes?.meta ?? null);
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

    caseNotesApi
      .options()
      .then((result) => {
        if (active) setOptions(result ?? {});
      })
      .catch(() => {
        // The forms still work with their shipped fallback vocabulary.
      });

    if (canAuthor) {
      beneficiariesApi
        .list({ per_page: 50 })
        .then((result) => {
          if (active) setBeneficiaries(result ?? []);
        })
        .catch(() => {
          if (active) setBeneficiaries([]);
        });
    }

    return () => {
      active = false;
    };
  }, [canAuthor]);

  const deletableIds = cases.filter(canModify).map((caseItem) => caseItem.id);
  const hasFilters = Boolean(
    searchTerm ||
      statusFilter !== "all" ||
      categoryFilter ||
      barangayFilter ||
      followUpFilter,
  );

  function clearFilters() {
    setSearchInput("");
    updateParams({
      search: null,
      status: null,
      category: null,
      barangay: null,
      follow_up: null,
    });
  }

  function setStatusFromCard(status) {
    setSearchInput("");
    updateParams({
      search: null,
      status,
      follow_up: null,
      category: null,
      barangay: null,
    });
  }

  function setFollowUpFromCard(value) {
    setSearchInput("");
    updateParams({
      search: null,
      follow_up: value,
      status: null,
      category: null,
      barangay: null,
    });
  }

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(caseItem) {
    setEditing(caseItem);
    setFormOpen(true);
  }

  async function fetchDetail(id) {
    return caseNotesApi.get(id);
  }

  async function openDetail(caseItem) {
    setDetail(caseItem);
    setDetailError(null);
    setDetailLoading(true);

    try {
      setDetail(await fetchDetail(caseItem.id));
    } catch (err) {
      setDetailError(getErrorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshOpenDetail(id) {
    if (!detail || detail.id !== id) return;

    try {
      setDetail(await fetchDetail(id));
    } catch (err) {
      setDetailError(getErrorMessage(err));
    }
  }

  async function openFollowUp(caseItem) {
    setError(null);

    if (caseItem.updates) {
      setFollowUpCase(caseItem);
      return;
    }

    try {
      setFollowUpCase(await fetchDetail(caseItem.id));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function toggleFollowUp(caseItem, completed) {
    setFollowUpBusy(true);
    setError(null);

    try {
      await caseNotesApi.update(caseItem.id, { follow_up_completed: completed });
      await load(true);
      await refreshOpenDetail(caseItem.id);
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
      await caseNotesApi.remove(deleting.id);
      const removed = deleting;
      setDeleting(null);
      await load(true);
      setNotice(`Deleted case ${removed.reference_number ?? ""}.`);
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
      const result = await caseNotesApi.bulkRemove([...selected]);
      const failed = result?.failed_ids?.length ?? 0;

      setBulkOpen(false);
      clear();
      await load(true);
      setNotice(
        failed > 0
          ? `Deleted ${result.deleted} of ${result.deleted + failed} cases; ${failed} could not be deleted.`
          : `Deleted ${result.deleted} ${result.deleted === 1 ? "case" : "cases"}.`,
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBulkBusy(false);
    }
  }

  function rowMenuItems(caseItem) {
    const items = [
      { label: "View details", onClick: () => openDetail(caseItem) },
    ];

    if (canAddUpdate) {
      items.push({
        label: "Add follow-up",
        ariaLabel: `Add follow-up for ${caseItem.name_of_farmer}`,
        onClick: () => openFollowUp(caseItem),
      });
    }

    items.push({
      label: "Open household",
      to: `/dashboard/${roleKey}/beneficiaries/${caseItem.beneficiary_id}/lineage`,
    });

    if (canModify(caseItem)) {
      items.push({
        label: "Edit case",
        ariaLabel: `Edit case for ${caseItem.name_of_farmer}`,
        onClick: () => openEdit(caseItem),
      });
      items.push({
        label: "Delete case",
        ariaLabel: `Delete case for ${caseItem.name_of_farmer}`,
        onClick: () => setDeleting(caseItem),
      });
    }

    return items;
  }

  const overview = [
    {
      key: "total",
      label: "Total cases",
      value: summary.total_cases,
      hint: "all documented cases",
      active: !hasFilters,
      onClick: clearFilters,
    },
    {
      key: "open",
      label: "Open cases",
      value: summary.open_cases,
      hint: "need initial action",
      active: statusFilter === "open" && !followUpFilter,
      onClick: () => setStatusFromCard("open"),
    },
    {
      key: "observation",
      label: "Under observation",
      value: summary.observation_cases,
      hint: "waiting on progress",
      active: statusFilter === "observation" && !followUpFilter,
      onClick: () => setStatusFromCard("observation"),
    },
    {
      key: "resolved",
      label: "Resolved cases",
      value: summary.resolved_cases,
      hint: "closed successfully",
      active: statusFilter === "resolved" && !followUpFilter,
      onClick: () => setStatusFromCard("resolved"),
    },
  ];

  const followUpCards = [
    { label: "Upcoming follow-ups", value: summary.follow_up_upcoming, key: "upcoming" },
    { label: "Overdue follow-ups", value: summary.follow_up_overdue, key: "overdue" },
    { label: "Completed follow-ups", value: summary.follow_up_completed, key: "completed" },
  ];

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{config?.label ?? "Technician"}</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Case Notes
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Document livestock and poultry cases, preserve observations, and
              coordinate follow-ups with health records and field visits.
            </p>
          </div>

          {canAuthor && (
            <button type="button" onClick={openCreate} className="btn-primary">
              <Icon name="plus" className="h-4 w-4" />
              Open new case
            </button>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {overview.map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={card.onClick}
              aria-pressed={card.active}
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

        <div className="mt-3 flex flex-wrap gap-2">
          {followUpCards.map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={() => setFollowUpFromCard(card.key)}
              aria-pressed={followUpFilter === card.key}
              className={`inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 text-xs font-semibold transition ${
                followUpFilter === card.key
                  ? "border-brand-500 bg-brand-50 text-brand-900"
                  : "border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:bg-brand-50/40"
              }`}
            >
              {card.label}
              <span className="rounded-pill bg-white/80 px-1.5 py-0.5 text-[10px] tabular-nums ring-1 ring-slate-200">
                {card.value ?? "—"}
              </span>
            </button>
          ))}
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

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="case-search" className="sr-only">
              Search cases
            </label>
            <div className="relative">
              <Icon
                name="search"
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                id="case-search"
                type="search"
                className="field !pl-9"
                placeholder="Search reference, farmer, animal, observation…"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
          </div>

          <div>
            <label htmlFor="case-status-filter" className="sr-only">
              Status
            </label>
            <select
              id="case-status-filter"
              className="field !w-auto"
              value={statusFilter}
              onChange={(event) => updateParams({ status: event.target.value, follow_up: null })}
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="observation">Under observation</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>

          <div>
            <label htmlFor="case-category-filter" className="sr-only">
              Category
            </label>
            <select
              id="case-category-filter"
              className="field !w-auto"
              value={categoryFilter}
              onChange={(event) => updateParams({ category: event.target.value })}
            >
              <option value="">All categories</option>
              {(options.categories ?? []).map((category) => (
                <option key={category} value={category}>
                  {caseCategoryLabel(category)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="case-barangay-filter" className="sr-only">
              Barangay
            </label>
            <select
              id="case-barangay-filter"
              className="field !w-auto"
              value={barangayFilter}
              onChange={(event) => updateParams({ barangay: event.target.value })}
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
            <label htmlFor="case-sort" className="sr-only">
              Sort
            </label>
            <select
              id="case-sort"
              className="field !w-auto"
              value={`${sort}:${direction}`}
              onChange={(event) => {
                const [nextSort, nextDirection] = event.target.value.split(":");
                updateParams({ sort: nextSort, direction: nextDirection });
              }}
            >
              <option value="date:desc">Newest reported</option>
              <option value="date:asc">Oldest reported</option>
              <option value="reference:asc">Reference A–Z</option>
              <option value="farmer:asc">Farmer A–Z</option>
              <option value="status:asc">Status</option>
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
        ) : cases.length === 0 ? (
          <EmptyState
            title={hasFilters ? "No cases match" : "No cases yet"}
            description={
              hasFilters
                ? "Try a different search, status, category or barangay."
                : canAuthor
                  ? "Open a case to start documenting observations, actions and follow-ups."
                  : "Cases appear here once a technician has opened one."
            }
          />
        ) : (
          <>
            {deletableIds.length > 0 && (
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                <SelectAllCheckbox
                  ids={deletableIds}
                  selected={selected}
                  onToggleAll={toggleAll}
                  label="Select all cases you can delete"
                />
                <span className="text-xs font-semibold text-slate-600">Select all</span>
              </div>
            )}

            <BulkActionBar
              count={selected.size}
              noun="case"
              onClear={clear}
              onDelete={() => setBulkOpen(true)}
              busy={bulkBusy}
            />

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                  <tr>
                    {deletableIds.length > 0 && <th className="w-10 px-3 py-2.5" />}
                    <th className="px-3 py-2.5">Reference</th>
                    <th className="px-3 py-2.5">Beneficiary</th>
                    <th className="px-3 py-2.5">Animal</th>
                    <th className="px-3 py-2.5">Barangay</th>
                    <th className="px-3 py-2.5">Category</th>
                    <th className="px-3 py-2.5">Reported</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Follow-up</th>
                    <th className="w-12 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cases.map((caseItem) => (
                    <tr key={caseItem.id} className="align-top transition hover:bg-brand-50/30">
                      {deletableIds.length > 0 && (
                        <td className="px-3 py-2.5">
                          {canModify(caseItem) && (
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded accent-brand-700"
                              aria-label={`Select case ${caseItem.reference_number}`}
                              checked={selected.has(caseItem.id)}
                              onChange={() => toggle(caseItem.id)}
                            />
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openDetail(caseItem)}
                          className="font-mono text-[11px] font-semibold text-brand-800 hover:underline"
                        >
                          {caseItem.reference_number ?? "—"}
                        </button>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {caseItem.updates_count ?? 0} update
                          {caseItem.updates_count === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => openDetail(caseItem)}
                          className="text-left font-semibold text-slate-900 hover:text-brand-800 hover:underline"
                        >
                          {caseItem.name_of_farmer}
                        </button>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {caseItem.rsbsa_number ?? caseItem.ear_tag_number ?? "No registry ID"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-700">
                        {caseItem.animal_type}
                        {caseItem.sex ? ` · ${caseItem.sex}` : ""}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-600">
                        {caseItem.barangay ?? caseItem.address}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold ${
                            CASE_CATEGORY_TONES[caseItem.category] ??
                            CASE_CATEGORY_TONES.general
                          }`}
                        >
                          {caseCategoryLabel(caseItem.category)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-600">
                        {formatCaseDate(caseItem.date_reported)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <StatusBadge status={caseItem.status} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <FollowUpBadge
                          status={caseItem.follow_up_status}
                          date={caseItem.follow_up_on}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <ActionMenu
                          label={`Actions for ${caseItem.reference_number ?? caseItem.name_of_farmer}`}
                          items={rowMenuItems(caseItem)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationFooter
              meta={meta}
              shown={cases.length}
              noun="case"
              onPageChange={(nextPage) => updateParams({ page: nextPage }, { resetPage: false })}
              pageSize={perPage}
              pageSizeOptions={[15, 25, 50]}
              onPageSizeChange={(size) => updateParams({ per_page: size })}
            />
          </>
        )}
      </section>

      <CaseNoteFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        beneficiaries={beneficiaries}
        note={editing}
        options={options}
        onSaved={async (saved) => {
          await load(true);
          setNotice(editing ? "Case updated." : "Case opened.");
          if (saved?.id) await refreshOpenDetail(saved.id);
        }}
      />

      <CaseFollowUpModal
        open={followUpCase !== null}
        caseDetail={followUpCase}
        onClose={() => setFollowUpCase(null)}
        onSaved={async () => {
          const id = followUpCase?.id;
          setNotice("Follow-up added to the case.");
          await load(true);
          if (id) await refreshOpenDetail(id);
        }}
      />

      <CaseDetailModal
        detail={detail}
        loading={detailLoading}
        error={detailError}
        canModify={canModify}
        canAddUpdate={canAddUpdate}
        followUpBusy={followUpBusy}
        onClose={() => setDetail(null)}
        onEdit={(caseItem) => {
          setDetail(null);
          openEdit(caseItem);
        }}
        onAddFollowUp={openFollowUp}
        onToggleFollowUp={toggleFollowUp}
        roleKey={roleKey}
      />

      <Modal
        open={deleting !== null}
        title="Delete case"
        onClose={() => setDeleting(null)}
      >
        <p className="text-sm text-slate-600">
          Delete case <strong>{deleting?.reference_number}</strong> for{" "}
          <strong>{deleting?.name_of_farmer}</strong>? Its observations and
          follow-up timeline will be removed from the active case list.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setDeleting(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary bg-red-600 hover:bg-red-700"
            onClick={confirmDelete}
            disabled={removing}
          >
            {removing ? (
              <>
                <ButtonSpinner />
                Deleting…
              </>
            ) : (
              "Delete case"
            )}
          </button>
        </div>
      </Modal>

      <Modal
        open={bulkOpen}
        title={`Delete ${selected.size} ${selected.size === 1 ? "case" : "cases"}`}
        onClose={() => setBulkOpen(false)}
      >
        <p className="text-sm text-slate-600">
          Delete <strong>{selected.size}</strong> selected case
          {selected.size === 1 ? "" : "s"}? Their full timelines will be removed
          from the active list.
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
