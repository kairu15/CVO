import { useState } from "react";
import { Link } from "react-router-dom";
import { notificationsApi } from "../api/notificationsApi";
import { useInvalidate, useNotificationsFeed } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { Icon } from "../components/Icons";
import { getRole } from "../config/roles";

/**
 * Farmer "Notifications" screen.
 *
 * Read-only, and with no "mark as read" — because there is nothing to write.
 * Every alert restates a dispersal or a vaccination already on record, so an
 * alert clears when the record it describes is recorded, and a read flag would
 * require a stored feed this system deliberately does not have. The page says
 * so rather than pretending a dismiss button exists.
 *
 * Same feed the header bell reads, so the two cannot disagree.
 */

const TYPE_ICONS = {
  "vaccination-overdue": "alert-circle",
  "vaccination-due-soon": "calendar",
  dispersal: "truck",
  "re-dispersal": "refresh",
  // Smart Alerts — the daily rule-based flags, in their own tab.
  "smart-vaccination-overdue": "alert-circle",
  "smart-bcs-out-of-range": "medical-cross",
  "smart-no-recent-visit": "map-pin",
  "smart-barangay-flag": "chart",
};

const URGENCY_TONES = {
  urgent: "bg-red-50 text-red-700 dark:bg-red-100 dark:text-red-700",
  warning: "bg-amber-50 text-amber-800 dark:bg-amber-100 dark:text-amber-800",
  info: "bg-brand-50 text-brand-800 dark:bg-brand-100 dark:text-brand-800",
};

const URGENCY_LABELS = {
  urgent: "Urgent",
  warning: "Due soon",
  info: "Activity",
};

/** Two bands, because "a vet needs to act" and "something happened" differ. */
const BANDS = [
  { key: "attention", title: "Needs attention", urgencies: ["urgent", "warning"] },
  { key: "activity", title: "Recent activity", urgencies: ["info"] },
];

/** Per-role intro copy — the feed is the same endpoint, the framing differs. */
const ROLE_COPY = {
  admin: "New registrations, acceptances, field-visit photos and every dispersal or vaccination alert across the city, most needing action first.",
  doctor: "Field-visit photo submissions and every vaccination or dispersal alert for the animals under veterinary care.",
  technician: "Your assignments, plus dispersal and vaccination alerts for the households you monitor.",
  farmer: "Dispersal, vaccination and re-dispersal alerts for the animals on your account, most needing action first.",
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

/**
 * "32 days overdue" / "due in 19 days".
 *
 * The day count comes from the API, which derives it from the same thresholds
 * the vaccination schedule filters on — so this page cannot disagree with that
 * one about how late an animal is.
 */
function dueHint(days) {
  if (days === null || days === undefined) return null;

  if (days === 0) return "due today";
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue`;

  return `due in ${days} ${days === 1 ? "day" : "days"}`;
}

export default function NotificationsPage({ roleKey = "farmer" }) {
  const config = getRole(roleKey);
  const invalidate = useInvalidate();

  // Smart Alerts are written for admins and technicians only (plus the
  // assigned technician for household-level flags), so the tab is hidden
  // where it could never have anything in it.
  const canSeeSmart = roleKey === "admin" || roleKey === "technician";
  const [tab, setTab] = useState("all");

  const { data, isLoading: loading, error: queryError } = useNotificationsFeed(50, tab);

  const alerts = data?.alerts ?? [];
  const counts = data?.counts ?? {};
  const error = queryError ? getErrorMessage(queryError) : null;

  const total = counts.total ?? alerts.length;
  const urgent = counts.urgent ?? 0;
  const unreadEvents = counts.unread_events ?? 0;
  const smartCount = counts.smart ?? 0;

  /** Write read-all through, then refresh the polled feed + badge. */
  async function markAllRead() {
    await notificationsApi.markAllRead();
    invalidate.notifications();
  }

  /**
   * Opening an event marks just that one read, so the badge decrements by one
   * rather than clearing wholesale; a derived alert has no read state to
   * write. The write races the navigation but never blocks it.
   */
  function openAlert(alert) {
    if (typeof alert.id === "string" && alert.id.startsWith("event-") && !alert.read) {
      const id = Number(alert.id.slice("event-".length));

      notificationsApi
        .markRead(id)
        .then(() => invalidate.notifications())
        .catch(() => {});
    }
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <p className="eyebrow">{config?.label ?? "Farmer / Beneficiary"}</p>
        <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
          Notifications
        </h2>            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              {ROLE_COPY[roleKey] ?? ROLE_COPY.farmer}
            </p>

        {canSeeSmart && (
          <div className="mt-5 inline-flex rounded-pill border border-slate-200 bg-slate-50 p-1 dark:border-slate-200/70 dark:bg-slate-100/60">
            <button
              type="button"
              onClick={() => setTab("all")}
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
              onClick={() => setTab("smart")}
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
        )}

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
          </div>
        )}

        {/* Says why there is no dismiss control, instead of leaving its absence
            to be guessed at. The Smart Alerts tab gives the extra context: a
            flag is a rule match on existing records, not a diagnosis. */}
        <p className="mt-4 inline-flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-600 dark:border-slate-200/70 dark:bg-slate-100/50 dark:text-slate-500">
          <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {tab === "smart"
            ? "Smart Alerts are rule-based flags computed from records already in the system — not a diagnosis. A flag clears itself once the underlying record is updated."
            : "Alerts come from your dispersal and vaccination records, so they clear once the visit or movement is recorded — there is nothing to mark as read here."}
        </p>
      </section>

      {error && <InlineAlert message={error} />}

      {loading ? (
        <section className="card overflow-hidden">
          <SkeletonList rows={3} rowClassName="h-16" />
        </section>
      ) : alerts.length === 0 ? (
        <section className="card">
          <EmptyState
            title={tab === "smart" ? "No Smart Alerts" : "No notifications"}
            description={
              tab === "smart"
                ? "No rule-based flag currently matches your records. The scan runs daily and flags clear themselves once the record behind them is updated."
                : "Nothing needs your attention and no movements have been recorded for your animals yet. Alerts appear here when the City Veterinary Office records a dispersal or a vaccination falls due."
            }
          />
        </section>
      ) : (
        BANDS.map((band) => {
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
                  const isSmart = alert.is_smart === true;

                  return (
                    <li
                      key={alert.id}
                      className="flex flex-wrap items-start gap-3 px-4 py-3.5 transition hover:bg-brand-50/40"
                    >
                      <span
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                          URGENCY_TONES[alert.urgency] ?? URGENCY_TONES.info
                        }`}
                      >
                        <Icon name={TYPE_ICONS[alert.type] ?? "bell"} className="h-4 w-4" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">{alert.title}</p>
                          <span
                            className={`rounded-pill px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${
                              URGENCY_TONES[alert.urgency] ?? URGENCY_TONES.info
                            }`}
                          >
                            {isSmart ? "Flagged" : URGENCY_LABELS[alert.urgency] ?? alert.urgency}
                          </span>
                        </div>

                        <p className="mt-1 text-xs text-slate-600">{alert.message}</p>

                        <p className="mt-1 text-[11px] text-slate-500">
                          {formatDate(alert.date)}
                          {hint && <span className="ml-1.5 font-medium text-slate-600">· {hint}</span>}
                        </p>
                      </div>

                      <Link
                        to={alert.link}
                        onClick={() => openAlert(alert)}
                        className="shrink-0 rounded-pill px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100"
                      >
                        View
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
