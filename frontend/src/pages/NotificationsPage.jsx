import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { notificationsApi } from "../api/notificationsApi";
import { useInvalidate, useNotificationsFeed } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { PaginationFooter } from "../components/PaginationFooter";
import { Icon } from "../components/Icons";
import {
  FilterField,
  FilterToolbar,
} from "../components/FilterToolbar";
import { SearchField } from "../components/SearchField";
import { useFlashHighlight } from "../hooks/useFlashHighlight";
import { getRole } from "../config/roles";

/**
 * Staff notification centre.
 *
 * One feed, two kinds of alert: stored events (read/archive state, bulk
 * management) and derived vaccination/dispersal alerts (read-only, cleared by
 * the record they describe). Stored filters are applied server-side by the
 * same endpoint the header bell reads.
 */

const TYPE_ICONS = {
  "vaccination-overdue": "alert-circle",
  "vaccination-due-soon": "calendar",
  dispersal: "truck",
  "re-dispersal": "refresh",
  "beneficiary-added": "users",
  "technician-assigned": "user",
  "technician-reassigned": "refresh",
  "field-visit-photo": "map-pin",
  "field-visit-completed": "clipboard-check",
  "animal-dispersed": "truck",
  "animal-re-dispersed": "refresh",
  "animal-returned": "arrow-left",
  "animal-event-voided": "alert-circle",
  "smart-vaccination-overdue": "alert-circle",
  "smart-bcs-out-of-range": "medical-cross",
  "smart-no-recent-visit": "map-pin",
  "smart-barangay-flag": "chart",
  "cluster-alert": "shield",
};

const URGENCY_TONES = {
  urgent: "bg-red-50 text-red-700 dark:bg-red-100 dark:text-red-700",
  warning: "bg-amber-50 text-amber-800 dark:bg-amber-100 dark:text-amber-800",
  info: "bg-brand-50 text-brand-800 dark:bg-brand-100 dark:text-brand-800",
};

const PRIORITY_TONES = {
  critical: "bg-red-50 text-red-700 dark:bg-red-100 dark:text-red-700",
  high: "bg-amber-50 text-amber-800 dark:bg-amber-100 dark:text-amber-800",
  normal: "bg-slate-100 text-slate-600 dark:bg-slate-200/60 dark:text-slate-600",
  low: "bg-slate-50 text-slate-500 dark:bg-slate-100/60 dark:text-slate-400",
};

const PRIORITY_LABELS = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};

const CATEGORY_LABELS = {
  beneficiaries: "Beneficiaries",
  dispersals: "Dispersals",
  field_visits: "Field Visits",
  monitoring: "Monitoring",
  technicians: "Technicians",
  system: "System Updates",
  security: "Security Alerts",
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS).map(([key, label]) => ({ key, label }));

const STATUS_OPTIONS = [
  { value: "all", label: "All active" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
  { value: "archived", label: "Archived" },
];

/** Two bands, because "a vet needs to act" and "something happened" differ. */
const BANDS = [
  { key: "attention", title: "Needs attention", urgencies: ["urgent", "warning"] },
  { key: "activity", title: "Recent activity", urgencies: ["info"] },
];

const ROLE_COPY = {
  admin:
    "Beneficiary, technician, field-visit, dispersal and monitoring activity across the city, with the items that need action first.",
  technician:
    "Your field-visit and monitoring activity, plus every dispersal or vaccination alert for the animals under your care.",
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

/** "32 days overdue" / "due in 19 days". */
function dueHint(days) {
  if (days === null || days === undefined) return null;
  if (days === 0) return "due today";
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue`;
  return `due in ${days} ${days === 1 ? "day" : "days"}`;
}

function isEvent(alert) {
  return typeof alert.id === "string" && alert.id.startsWith("event-");
}

function eventId(alert) {
  return Number(alert.id.slice("event-".length));
}

function priorityOf(alert) {
  if (alert.priority) return alert.priority;
  if (alert.urgency === "urgent") return "critical";
  if (alert.urgency === "warning") return "high";
  return "normal";
}

function categoryOf(alert) {
  return alert.category ?? "system";
}

function categoryLabel(alert) {
  return alert.category_label ?? CATEGORY_LABELS[categoryOf(alert)] ?? "System Updates";
}

function priorityLabel(alert) {
  return alert.priority_label ?? PRIORITY_LABELS[priorityOf(alert)] ?? "Normal";
}

export default function NotificationsPage({ roleKey = "admin" }) {
  const config = getRole(roleKey);
  const invalidate = useInvalidate();
  const navigate = useNavigate();

  const [flashId, setFlashId] = useFlashHighlight(null, 1500);
  const navTimer = useRef(null);
  useEffect(() => () => clearTimeout(navTimer.current), []);

  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState([]);
  const [detail, setDetail] = useState(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Debounce the free-text term so typing does not launch a request per key.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = useMemo(
    () => ({
      status: status !== "all" ? status : undefined,
      category: category || undefined,
      priority: priority || undefined,
      search: debouncedSearch || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [status, category, priority, debouncedSearch, from, to],
  );

  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [tab, status, category, priority, debouncedSearch, from, to]);

  const { data, isLoading: loading, error: queryError } = useNotificationsFeed(50, tab, page, filters);

  const alerts = data?.alerts ?? [];
  const counts = data?.counts ?? {};
  const error = queryError ? getErrorMessage(queryError) : null;

  const total = counts.total ?? alerts.length;
  const urgent = counts.urgent ?? 0;
  const unreadEvents = counts.unread_events ?? 0;
  const readEvents = counts.read_events ?? Math.max(0, total - unreadEvents);
  const important = counts.important ?? urgent + (counts.warning ?? 0);
  const archivedCount = counts.archived_events ?? 0;
  const smartCount = counts.smart ?? 0;

  const eventAlerts = alerts.filter(isEvent);
  const selectableIds = eventAlerts.map(eventId);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.includes(id));
  const filtersActive = Boolean(
    debouncedSearch || category || priority || status !== "all" || from || to || tab === "smart",
  );

  function toggleSelected(id) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function toggleAllOnPage() {
    setSelected((current) => {
      if (allSelected) return current.filter((id) => !selectableIds.includes(id));
      return [...new Set([...current, ...selectableIds])];
    });
  }

  async function applyBulk(action, ids = selected) {
    if (!ids.length) return;

    setBulkBusy(true);
    setActionError(null);

    try {
      await notificationsApi.bulk(ids, action);
      invalidate.notifications();
      setSelected([]);

      if (detail && isEvent(detail) && ids.includes(eventId(detail))) {
        setDetail(null);
      }
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBulkBusy(false);
    }
  }

  async function markAllRead() {
    setActionError(null);

    try {
      await notificationsApi.markAllRead();
      invalidate.notifications();
    } catch (err) {
      setActionError(getErrorMessage(err));
    }
  }

  async function markOneRead(alert) {
    if (!isEvent(alert) || alert.read) return;

    try {
      await notificationsApi.markRead(eventId(alert));
      invalidate.notifications();
    } catch (err) {
      setActionError(getErrorMessage(err));
    }
  }

  function clearFilters() {
    setSearch("");
    setDebouncedSearch("");
    setCategory("");
    setPriority("");
    setStatus("all");
    setFrom("");
    setTo("");
    setTab("all");
  }

  function openAlert(event, alert) {
    event.preventDefault();
    setFlashId(alert.id);

    if (isEvent(alert) && !alert.read) {
      markOneRead(alert);
    }

    const state =
      alert.beneficiary_id !== null && alert.beneficiary_id !== undefined
        ? { highlightBeneficiaryId: alert.beneficiary_id }
        : undefined;

    clearTimeout(navTimer.current);
    navTimer.current = setTimeout(() => navigate(alert.link, { state }), 220);
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{config?.label ?? "Staff"}</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Notifications
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              {ROLE_COPY[roleKey] ?? ROLE_COPY.admin}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-brand-50 px-3 py-1.5 text-[11px] font-semibold text-brand-800">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />
              Live updates
            </span>
            <button
              type="button"
              onClick={() => setPreferencesOpen(true)}
              className="btn-secondary px-3.5 py-2 text-xs"
            >
              <Icon name="sliders" className="h-4 w-4" />
              Preferences
            </button>
          </div>
        </div>

        <div className="mt-5 inline-flex rounded-pill border border-slate-200 bg-slate-50 p-1 dark:border-slate-200/70 dark:bg-slate-100/60">
          <button
            type="button"
            onClick={() => {
              setTab("all");
              setPage(1);
            }}
            aria-pressed={tab === "all"}
            className={`rounded-pill px-3.5 py-1.5 text-xs font-semibold transition ${
              tab === "all"
                ? "bg-white text-brand-800 shadow-sm"
                : "text-slate-600 hover:text-brand-800"
            }`}
          >
            All alerts
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("smart");
              setPage(1);
            }}
            aria-pressed={tab === "smart"}
            className={`inline-flex items-center gap-2 rounded-pill px-3.5 py-1.5 text-xs font-semibold transition ${
              tab === "smart"
                ? "bg-white text-brand-800 shadow-sm"
                : "text-slate-600 hover:text-brand-800"
            }`}
          >
            Smart alerts
            {smartCount > 0 && (
              <span className="rounded-pill bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">
                {smartCount}
              </span>
            )}
          </button>
        </div>

        {!loading && total > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-pill bg-slate-100 px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:bg-slate-200/60 dark:text-slate-600">
              <Icon name="bell" className="h-4 w-4" />
              {total} {total === 1 ? "alert" : "alerts"}
            </span>
            {urgent > 0 && (
              <span className="inline-flex items-center gap-2 rounded-pill bg-red-50 px-3.5 py-1.5 text-xs font-semibold text-red-700 dark:bg-red-100 dark:text-red-700">
                <Icon name="alert-circle" className="h-4 w-4" />
                {urgent} needing action
              </span>
            )}
            {unreadEvents > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="rounded-pill bg-brand-100 px-3.5 py-1.5 text-xs font-semibold text-brand-800 transition hover:bg-brand-500 hover:text-white"
              >
                Mark {unreadEvents} as read
              </button>
            )}
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-semibold text-slate-500 underline-offset-2 transition hover:text-brand-800 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <OverviewCard label="Total notifications" value={total} icon="bell" />
        <OverviewCard label="Unread" value={unreadEvents} icon="mail" tone="brand" />
        <OverviewCard label="Read" value={readEvents} icon="check" />
        <OverviewCard label="Important" value={important} icon="alert-circle" tone="amber" />
      </section>

      {error && <InlineAlert message={error} />}
      {actionError && (
        <InlineAlert message={actionError} onDismiss={() => setActionError(null)} />
      )}

      <section className="card p-4">
        <FilterToolbar
          collapsible
          search={
            <SearchField
              id="notification-search"
              value={search}
              onChange={setSearch}
              placeholder="Search title, message, farmer, RSBSA or ear tag"
              ariaLabel="Search notifications"
            />
          }
          activeFilters={[
            status !== "all"
              ? {
                  key: "status",
                  label: `Status: ${
                    STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
                  }`,
                  onClear: () => setStatus("all"),
                }
              : null,
            priority
              ? {
                  key: "priority",
                  label: `Priority: ${PRIORITY_LABELS[priority] ?? priority}`,
                  onClear: () => setPriority(""),
                }
              : null,
            category
              ? {
                  key: "category",
                  label: `Category: ${
                    CATEGORY_OPTIONS.find((option) => option.key === category)?.label ?? category
                  }`,
                  onClear: () => setCategory(""),
                }
              : null,
            from
              ? {
                  key: "from",
                  label: `From: ${from}`,
                  onClear: () => setFrom(""),
                }
              : null,
            to
              ? {
                  key: "to",
                  label: `To: ${to}`,
                  onClear: () => setTo(""),
                }
              : null,
          ].filter(Boolean)}
          onClearAll={clearFilters}
          onReset={clearFilters}
        >
          <FilterField label="Status" htmlFor="notification-status">
            <select
              id="notification-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              aria-label="Filter by status"
              className="field"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value === "archived" && archivedCount > 0
                    ? `${option.label} (${archivedCount})`
                    : option.label}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Priority" htmlFor="notification-priority">
            <select
              id="notification-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              aria-label="Filter by priority"
              className="field"
            >
              <option value="">All priorities</option>
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="From" htmlFor="notification-from">
            <input
              id="notification-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              aria-label="Filter from date"
              className="field"
            />
          </FilterField>

          <FilterField label="To" htmlFor="notification-to">
            <input
              id="notification-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              aria-label="Filter to date"
              className="field"
            />
          </FilterField>
        </FilterToolbar>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-0.5">
          <CategoryChip
            active={!category}
            label="All categories"
            onClick={() => setCategory("")}
          />
          {CATEGORY_OPTIONS.map((option) => (
            <CategoryChip
              key={option.key}
              active={category === option.key}
              label={option.label}
              onClick={() => setCategory(category === option.key ? "" : option.key)}
            />
          ))}
        </div>
      </section>

      {loading ? (
        <section className="card overflow-hidden">
          <SkeletonList rows={3} rowClassName="h-16" />
        </section>
      ) : alerts.length === 0 ? (
        <section className="card">
          <EmptyState
            title={
              filtersActive
                ? "No notifications match"
                : tab === "smart"
                  ? "No Smart Alerts"
                  : "No notifications"
            }
            description={
              filtersActive
                ? "Try a different category, priority, status or date range, or clear the filters."
                : tab === "smart"
                  ? "No rule-based flag currently matches your records. The scan runs daily and flags clear themselves once the record behind them is updated."
                  : "Nothing needs your attention and no movements have been recorded for your animals yet. Alerts appear here when the City Veterinary Office records a dispersal or a vaccination falls due."
            }
            action={
              filtersActive ? (
                <button type="button" className="btn-secondary px-4 py-2 text-xs" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : undefined
            }
          />
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-slate-200 bg-white px-4 py-3 dark:border-slate-200/60">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAllOnPage}
                disabled={selectableIds.length === 0}
                aria-label="Select all event notifications on this page"
                className="h-4 w-4 accent-brand-700"
              />
              Select event notifications
            </label>

            {selected.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">
                  {selected.length} selected
                </span>
                <BulkButton icon="check" label="Mark read" onClick={() => applyBulk("read")} disabled={bulkBusy} />
                <BulkButton icon="archive" label="Archive" onClick={() => applyBulk("archive")} disabled={bulkBusy} />
                <BulkButton icon="trash" label="Delete" tone="danger" onClick={() => applyBulk("delete")} disabled={bulkBusy} />
                <button
                  type="button"
                  onClick={() => setSelected([])}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700"
                >
                  Clear
                </button>
              </div>
            ) : (
              <span className="text-[11px] text-slate-500">
                Select stored events to mark read, archive or delete together.
              </span>
            )}
          </div>

          {BANDS.map((band) => {
            const rows = alerts.filter((alert) => band.urgencies.includes(alert.urgency));

            if (rows.length === 0) return null;

            return (
              <section key={band.key} className="card overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 dark:border-slate-200/60 dark:bg-slate-100/40">
                  <h3 className="font-display text-xs font-semibold tracking-wide text-slate-700 uppercase">
                    {band.title}
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    {rows.length} {rows.length === 1 ? "alert" : "alerts"}
                  </span>
                </div>

                <ul className="divide-y divide-slate-100">
                  {rows.map((alert) => {
                    const hint = dueHint(alert.days_until_due);
                    const event = isEvent(alert);
                    const id = event ? eventId(alert) : null;

                    return (
                      <li
                        key={alert.id}
                        className={`flex flex-wrap items-start gap-3 px-4 py-3.5 transition-colors duration-700 ${
                          flashId === alert.id
                            ? "bg-sky-50 dark:bg-sky-100/50"
                            : selected.includes(id)
                              ? "bg-brand-50/70 dark:bg-brand-100/40"
                              : "hover:bg-brand-50/40"
                        }`}
                      >
                        {event ? (
                          <input
                            type="checkbox"
                            checked={selected.includes(id)}
                            onChange={() => toggleSelected(id)}
                            aria-label={`Select ${alert.title}`}
                            className="mt-2.5 h-4 w-4 shrink-0 accent-brand-700"
                          />
                        ) : (
                          <span className="mt-2.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        )}

                        <span
                          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                            URGENCY_TONES[alert.urgency] ?? URGENCY_TONES.info
                          }`}
                        >
                          <Icon name={TYPE_ICONS[alert.type] ?? "bell"} className="h-4 w-4" />
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setDetail(alert)}
                              className="text-left text-sm font-semibold text-slate-900 hover:text-brand-800 hover:underline"
                            >
                              {alert.title}
                            </button>
                            <span
                              className={`rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${
                                PRIORITY_TONES[priorityOf(alert)] ?? PRIORITY_TONES.normal
                              }`}
                            >
                              {priorityLabel(alert)}
                            </span>
                            <span className="rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600 dark:bg-slate-200/60 dark:text-slate-600">
                              {categoryLabel(alert)}
                            </span>
                            {event && !alert.read && (
                              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-label="Unread" />
                            )}
                            {alert.archived && (
                              <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                                Archived
                              </span>
                            )}
                          </div>

                          <p className="mt-1 text-xs text-slate-600">{alert.message}</p>

                          <p className="mt-1 text-[11px] text-slate-500">
                            {formatDate(alert.date)}
                            {hint && <span className="ml-1.5 font-medium text-slate-600">· {hint}</span>}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDetail(alert)}
                            aria-label={`Details for ${alert.title}`}
                            className="rounded-pill p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                          >
                            <Icon name="eye" className="h-4 w-4" />
                          </button>
                          <Link
                            to={alert.link}
                            onClick={(clickEvent) => openAlert(clickEvent, alert)}
                            className="shrink-0 rounded-pill px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100"
                          >
                            View
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          <PaginationFooter
            meta={{
              total,
              current_page: counts.current_page,
              last_page: counts.last_page,
            }}
            shown={alerts.length}
            noun="alert"
            onPageChange={setPage}
          />
        </>
      )}

      <p className="inline-flex items-start gap-2 text-[11px] text-slate-500">
        <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Notifications are written from system activity. Archiving removes one from this inbox without deleting the
        record it refers to; derived vaccination and dispersal alerts clear when their underlying record changes.
      </p>

      {detail && (
        <NotificationDetail
          alert={detail}
          onClose={() => setDetail(null)}
          onOpen={(event, alert) => openAlert(event, alert)}
          onBulk={applyBulk}
          onMarkRead={markOneRead}
        />
      )}

      {preferencesOpen && (
        <PreferencesDialog onClose={() => setPreferencesOpen(false)} />
      )}
    </div>
  );
}

function OverviewCard({ label, value, icon, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-200/60 dark:text-slate-600",
    brand: "bg-brand-50 text-brand-700 dark:bg-brand-100 dark:text-brand-800",
    amber: "bg-amber-50 text-amber-800 dark:bg-amber-100 dark:text-amber-800",
  };

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{label}</span>
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${tones[tone] ?? tones.slate}`}>
          <Icon name={icon} className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
    </div>
  );
}

function CategoryChip({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-pill border px-3 py-1.5 text-[11px] font-semibold transition ${
        active
          ? "border-brand-300 bg-brand-100 text-brand-800"
          : "border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-800 dark:border-slate-200/60 dark:bg-slate-950/50"
      }`}
    >
      {label}
    </button>
  );
}

function BulkButton({ icon, label, onClick, disabled, tone = "normal" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[11px] font-semibold transition disabled:opacity-50 ${
        tone === "danger"
          ? "border-red-200 text-red-700 hover:bg-red-50 dark:border-red-200/60 dark:hover:bg-red-100/40"
          : "border-slate-200 text-slate-700 hover:border-brand-300 hover:bg-brand-50 dark:border-slate-200/60 dark:hover:bg-brand-100/40"
      }`}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function NotificationDetail({ alert, onClose, onOpen, onBulk, onMarkRead }) {
  const event = isEvent(alert);

  useEffect(() => {
    function onKeyDown(keyboardEvent) {
      if (keyboardEvent.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close notification details"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-slate-950/30"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Notification details: ${alert.title}`}
        className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-panel dark:border-slate-200/60 dark:bg-slate-950"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              {categoryLabel(alert)}
            </p>
            <h3 className="mt-1 font-display text-lg font-bold text-slate-900">{alert.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className={`rounded-pill px-2.5 py-1 text-[10px] font-semibold uppercase ${PRIORITY_TONES[priorityOf(alert)] ?? PRIORITY_TONES.normal}`}>
            {priorityLabel(alert)}
          </span>
          {event && !alert.read && (
            <span className="rounded-pill bg-brand-50 px-2.5 py-1 text-[10px] font-semibold text-brand-800">
              Unread
            </span>
          )}
          {alert.archived && (
            <span className="rounded-pill bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
              Archived
            </span>
          )}
        </div>

        <p className="mt-4 text-sm leading-6 text-slate-700">{alert.message}</p>

        <dl className="mt-5 space-y-3 border-y border-slate-100 py-4 text-xs">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Timestamp</dt>
            <dd className="text-right font-medium text-slate-700">{formatDateTime(alert.created_at ?? alert.date)}</dd>
          </div>
          {alert.days_until_due !== null && alert.days_until_due !== undefined && (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Vaccination</dt>
              <dd className="text-right font-medium text-slate-700">{dueHint(alert.days_until_due)}</dd>
            </div>
          )}
          {alert.beneficiary_id !== null && alert.beneficiary_id !== undefined && (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Related record</dt>
              <dd className="text-right font-medium text-slate-700">Beneficiary #{alert.beneficiary_id}</dd>
            </div>
          )}
        </dl>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            to={alert.link}
            onClick={(clickEvent) => {
              onClose();
              onOpen(clickEvent, alert);
            }}
            className="btn-primary px-4 py-2 text-xs"
          >
            Open record
            <Icon name="arrow-right" className="h-3.5 w-3.5" />
          </Link>

          {event && (
            <>
              <button
                type="button"
                onClick={() => (alert.read ? onBulk("unread", [eventId(alert)]) : onMarkRead(alert))}
                className="btn-secondary px-3.5 py-2 text-xs"
              >
                {alert.read ? "Mark unread" : "Mark read"}
              </button>
              <button
                type="button"
                onClick={() => onBulk(alert.archived ? "unarchive" : "archive", [eventId(alert)])}
                className="btn-secondary px-3.5 py-2 text-xs"
              >
                <Icon name="archive" className="h-3.5 w-3.5" />
                {alert.archived ? "Restore" : "Archive"}
              </button>
              <button
                type="button"
                onClick={() => onBulk("delete", [eventId(alert)])}
                className="inline-flex items-center gap-1.5 rounded-pill border border-red-200 px-3.5 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50"
              >
                <Icon name="trash" className="h-3.5 w-3.5" />
                Delete
              </button>
            </>
          )}
        </div>

        {!event && (
          <p className="mt-4 text-[11px] text-slate-500">
            This alert is derived from a live record, so it has no read or archive state. It clears when the record it
            describes is updated.
          </p>
        )}
      </aside>
    </div>
  );
}

function PreferencesDialog({ onClose }) {
  const [preferences, setPreferences] = useState({});
  const [categories, setCategories] = useState(CATEGORY_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    notificationsApi
      .preferences()
      .then((data) => {
        if (!active) return;
        setPreferences(data.preferences ?? {});
        if (data.categories?.length) setCategories(data.categories);
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);

    try {
      const data = await notificationsApi.updatePreferences(preferences);
      setPreferences(data.preferences ?? preferences);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button
        type="button"
        aria-label="Close notification preferences"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-slate-950/30"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Notification preferences"
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-slate-200 bg-white p-5 shadow-panel dark:border-slate-200/60 dark:bg-slate-950"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold text-slate-900">Notification preferences</h3>
            <p className="mt-1 text-xs text-slate-500">
              Choose which categories you want delivered. Security and system notices may still appear in the audit
              trail even when their notification category is off.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preferences"
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        {error && <div className="mt-4"><InlineAlert message={error} /></div>}

        {loading ? (
          <SkeletonList rows={4} rowClassName="h-9" className="mt-4 space-y-2" />
        ) : (
          <ul className="mt-4 space-y-2">
            {categories.map((category) => (
              <li
                key={category.key}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2.5"
              >
                <label htmlFor={`notify-category-${category.key}`} className="text-sm font-medium text-slate-700">
                  {category.label}
                </label>
                <input
                  id={`notify-category-${category.key}`}
                  type="checkbox"
                  checked={preferences[category.key] ?? true}
                  onChange={(event) =>
                    setPreferences((current) => ({
                      ...current,
                      [category.key]: event.target.checked,
                    }))
                  }
                  className="h-4 w-4 accent-brand-700"
                />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-xs">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={loading || saving}
            className="btn-primary px-4 py-2 text-xs disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save preferences"}
          </button>
        </div>
      </div>
    </div>
  );
}
