import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useInvalidate, useNotificationsFeed, useTechnicianDashboard } from "../api/queries";
import { technicianApi } from "../api/technicianApi";
import { getErrorMessage } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { InlineAlert } from "../components/InlineAlert";
import { SkeletonList } from "../components/Skeleton";
import { FieldVisitFormModal } from "../components/FieldVisitFormModal";
import { PlanVisitModal } from "../components/PlanVisitModal";

// MapLibre stays out of the dashboard chunk until the assigned-household map
// section actually mounts.
const AssignedHouseholdMap = lazy(() => import("../components/TechnicianHouseholdMap"));

/**
 * Technician home — a work queue, not a statistics wall.
 *
 * The first screen answers three questions: what is planned for today, which
 * households are overdue, and who am I responsible for. Recording a visit
 * reuses the existing field-visit form; scheduling creates a plan that becomes
 * completed only when that visit exists.
 */
export default function TechnicianDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, isPending, error, refetch } = useTechnicianDashboard();
  const notifications = useNotificationsFeed(4);
  const invalidate = useInvalidate();

  const [planOpen, setPlanOpen] = useState(false);
  const [planHousehold, setPlanHousehold] = useState(null);
  const [logOpen, setLogOpen] = useState(false);
  const [logHousehold, setLogHousehold] = useState(null);
  const [completingPlan, setCompletingPlan] = useState(null);
  const [startingPlan, setStartingPlan] = useState(null);

  function openPlan(household = null) {
    setPlanHousehold(household);
    setPlanOpen(true);
  }

  function openLog(household = null, plan = null) {
    setLogHousehold(household);
    setCompletingPlan(plan);
    setLogOpen(true);
  }

  async function startPlan(plan) {
    setStartingPlan(plan.id);
    try {
      await technicianApi.updatePlan(plan.id, { status: "in_progress" });
      await refetch();
      toast.success("Visit started.");
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setStartingPlan(null);
    }
  }

  async function handleVisitSaved(visit) {
    // The visit is now part of the city-wide record; make the admin command
    // center re-read it on its next open rather than serving a stale snapshot.
    invalidate.adminDashboard();
    invalidate.beneficiaries();

    const plan = completingPlan;

    if (!plan) {
      await refetch();
      return;
    }

    if (!visit?.id) {
      toast.info("The visit is saved on this device. The plan stays in progress until it syncs.");
      await refetch();
      return;
    }

    try {
      await technicianApi.updatePlan(plan.id, {
        status: "completed",
        field_visit_id: visit.id,
      });
      toast.success("Visit completed and plan closed.");
    } catch (err) {
      toast.error(
        `Visit logged, but the plan could not be completed: ${getErrorMessage(err)}`,
      );
    } finally {
      await refetch();
    }
  }

  if (isPending) {
    return (
      <div className="space-y-6">
        <section className="card p-6">
          <SkeletonList rows={2} rowClassName="h-10" className="!p-0" />
        </section>
        <section className="card p-6">
          <SkeletonList rows={4} rowClassName="h-20" className="!p-0" />
        </section>
      </div>
    );
  }

  if (error) {
    return (
      <section className="card p-6">
        <InlineAlert message={getErrorMessage(error)} />
        <button type="button" onClick={() => refetch()} className="btn-secondary mt-3 text-xs">
          Try again
        </button>
      </section>
    );
  }

  const counts = data?.counts ?? {};
  const assignedTasks = data?.assigned_tasks ?? data?.today_tasks ?? [];
  const assigned = data?.assigned_beneficiaries ?? [];
  const overdueHouseholds = data?.overdue_households ?? [];
  const recentActivity = data?.recent_activity ?? [];
  const barangays = data?.barangays ?? [];
  const mapHouseholds = data?.map_households ?? [];
  const mapSummary = data?.map ?? { mapped: mapHouseholds.length, unlocated: 0 };
  const alerts = notifications.data?.alerts ?? [];

  return (
    <div className="space-y-6">
      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 bg-gradient-to-br from-brand-50 via-white to-white p-6 dark:border-slate-200/60 dark:from-brand-100/50 dark:via-slate-950 dark:to-slate-950">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow">{greeting()}, {firstName(user?.name)}</p>
              <h2 className="mt-1 font-display text-xl font-bold text-slate-900 sm:text-2xl">
                Today’s fieldwork
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {todayLabel()} · {counts.today_tasks ?? 0} planned or overdue{" "}
                {(counts.today_tasks ?? 0) === 1 ? "visit" : "visits"} ·{" "}
                {counts.assigned_beneficiaries ?? 0} assigned{" "}
                {(counts.assigned_beneficiaries ?? 0) === 1 ? "household" : "households"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => openPlan()} className="btn-primary text-xs">
                <Icon name="calendar" className="h-4 w-4" />
                Plan a visit
              </button>
              <button type="button" onClick={() => openLog()} className="btn-secondary text-xs">
                <Icon name="route" className="h-4 w-4" />
                Log a field visit
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 sm:divide-y-0 dark:divide-slate-200/60">
          <Kpi
            icon="users"
            label="My assigned beneficiaries"
            value={counts.assigned_beneficiaries}
            tone="brand"
          />
          <Kpi
            icon="clipboard-check"
            label="Pending field visits"
            value={counts.pending_field_visits ?? counts.today_tasks}
            hint={
              (counts.overdue_tasks ?? 0) > 0
                ? `${counts.overdue_tasks} overdue`
                : `${counts.due_households ?? 0} households need a visit`
            }
            tone="amber"
          />
          <Kpi
            icon="check"
            label="Completed field visits"
            value={counts.completed_field_visits ?? counts.visits_today}
            hint={`${counts.visits_today ?? 0} recorded today`}
            tone="slate"
          />
          <Kpi
            icon="route"
            label="Pending dispersal records"
            value={counts.pending_dispersals}
            hint="No delivery event yet"
            tone="red"
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">My assigned tasks</h3>
              <p className="mt-1 text-xs text-slate-500">
                Scheduled visits and overdue follow-ups for the households assigned to you. Open a task to view the household record.
              </p>
            </div>
            <button type="button" onClick={() => openPlan()} className="text-xs font-semibold text-brand-800 hover:underline">
              Add task
            </button>
          </div>

          {assignedTasks.length === 0 ? (
            <EmptyState
              className="!py-10"
              title="No assigned tasks"
              description="Plan a visit for an assigned household, or log a visit that is already done."
              action={
                <button type="button" onClick={() => openPlan()} className="btn-secondary text-xs">
                  <Icon name="calendar" className="h-4 w-4" />
                  Plan a visit
                </button>
              }
            />
          ) : (
            <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-200/60">
              {assignedTasks.map((task) => (
                <TaskRow
                  key={task.key ?? `plan-${task.id}`}
                  task={task}
                  starting={startingPlan === (task.plan_id ?? task.id)}
                  onStart={() => startPlan({ id: task.plan_id ?? task.id })}
                  onLog={() =>
                    openLog(
                      {
                        id: task.beneficiary_id,
                        name_of_farmer: task.name_of_farmer,
                        address: task.address,
                        animal_type: task.animal_type,
                      },
                      task.kind === "plan"
                        ? {
                            id: task.plan_id,
                            purpose: task.purpose,
                            status: task.status,
                          }
                        : null,
                    )
                  }
                  onPlan={() => openPlan({ id: task.beneficiary_id, name_of_farmer: task.name_of_farmer, address: task.address })}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">Important updates</h3>
              <p className="mt-1 text-xs text-slate-500">Assignments, upcoming visits and record changes.</p>
            </div>
            <Link to="/dashboard/technician/notifications" className="text-xs font-semibold text-brand-800 hover:underline">
              View all
            </Link>
          </div>

          {notifications.isPending ? (
            <SkeletonList rows={2} rowClassName="h-10" className="!p-0 mt-3" />
          ) : notifications.error ? (
            <p className="mt-3 text-xs text-red-700">{getErrorMessage(notifications.error)}</p>
          ) : alerts.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No new updates.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {alerts.map((alert) => (
                <li key={alert.id}>
                  <Link
                    to={alert.link}
                    className="block rounded-xl border border-slate-100 px-3 py-2 transition hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-200/60"
                  >
                    <p className="text-xs font-semibold text-slate-800">{alert.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{alert.message}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">Assigned beneficiaries map</h3>
            <p className="mt-1 text-xs text-slate-500">
              Your households across Bayawan City's barangays. Select a pin to see the household, then open its record.
            </p>
          </div>
          <Link to="/dashboard/technician/map" className="btn-secondary text-xs">
            <Icon name="map" className="h-4 w-4" />
            Open full map
          </Link>
        </div>

        {mapHouseholds.length === 0 ? (
          <EmptyState
            className="!py-10"
            title="No mapped households yet"
            description={
              mapSummary.total > 0
                ? "Your assigned households do not have a registered pin or a barangay centre yet. Add a location from a field visit or ask an administrator to geotag them."
                : "An administrator can assign households to you from User Management."
            }
          />
        ) : (
          <>
            <div className="mt-4">
              <Suspense
                fallback={
                  <div className="grid h-[360px] place-items-center rounded-xl bg-slate-50 text-sm text-slate-500">
                    Loading assigned household map…
                  </div>
                }
              >
                <AssignedHouseholdMap households={mapHouseholds} barangays={barangays} />
              </Suspense>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {mapSummary.mapped} of {mapSummary.total} assigned{" "}
              {mapSummary.total === 1 ? "household is" : "households are"} plotted.
              {mapSummary.unlocated > 0 &&
                ` ${mapSummary.unlocated} ${mapSummary.unlocated === 1 ? "has" : "have"} no pin or barangay centre yet.`}
            </p>
          </>
        )}

        {barangays.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-200/60">
            {barangays.map((barangay) => (
              <span
                key={barangay.name}
                className="inline-flex items-center gap-2 rounded-pill border border-slate-200 px-3 py-1.5 text-xs text-slate-700 dark:border-slate-200/60"
              >
                {barangay.name}
                <span className="rounded-pill bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                  {barangay.total}
                </span>
              </span>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-200/60">
          <QuickLink to="/dashboard/technician/monitoring" icon="clipboard-check" label="Monitoring records" />
          <QuickLink to="/dashboard/technician/health-records" icon="medical-cross" label="Health records" />
          <QuickLink to="/dashboard/technician/field-visits" icon="route" label="Field visit log" />
          <QuickLink to="/dashboard/technician/vaccination-schedule" icon="calendar" label="Vaccination schedule" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">My assigned households</h3>
              <p className="mt-1 text-xs text-slate-500">The households with the oldest last contact come first.</p>
            </div>
            <Link
              to="/dashboard/technician/monitoring"
              className="text-xs font-semibold text-brand-800 hover:underline"
            >
              Open monitoring
            </Link>
          </div>

          {assigned.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500">
              No households are assigned to you yet. An administrator can assign them from User Management.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-200/60">
              {assigned.map((household) => (
                <li key={household.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/dashboard/technician/beneficiaries/${household.id}/lineage`}
                      className="block truncate text-sm font-medium text-slate-900 hover:text-brand-800 hover:underline"
                    >
                      {household.name_of_farmer}
                    </Link>
                    <p className="truncate text-[11px] text-slate-500">
                      {household.address}
                      {household.animal_type ? ` · ${household.animal_type}` : ""}
                      {household.ear_tag_number ? ` · ${household.ear_tag_number}` : ""}
                    </p>
                  </div>
                  {household.needs_visit ? (
                    <span className="rounded-pill bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                      Needs visit
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500">
                      Last contact {formatDate(household.last_contact_on)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => openLog(household)}
                    className="rounded-pill px-2.5 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-50"
                  >
                    Log visit
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">Needs a visit</h3>
            <p className="mt-1 text-xs text-slate-500">
              No monitoring or field visit in {data?.window_days ?? 60} days, or never contacted.
            </p>
          </div>

          {overdueHouseholds.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500">
              No overdue households. Your assigned list is up to date.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-200/60">
              {overdueHouseholds.map((household) => (
                <li key={household.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/dashboard/technician/beneficiaries/${household.id}/lineage`}
                      className="block truncate text-sm font-medium text-slate-900 hover:text-brand-800 hover:underline"
                    >
                      {household.name_of_farmer}
                    </Link>
                    <p className="truncate text-[11px] text-slate-500">
                      {household.address} · last contact{" "}
                      {formatDate(household.last_visit_on ?? household.last_monitoring_on)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openPlan(household)}
                    className="rounded-pill bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100"
                  >
                    Plan visit
                  </button>
                  <button
                    type="button"
                    onClick={() => openLog(household)}
                    className="rounded-pill px-2.5 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-50"
                  >
                    Log visit
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">Recent activity</h3>
            <p className="mt-1 text-xs text-slate-500">Your latest visits, monitoring reports and dispersal updates.</p>
            </div>
          <Link to="/dashboard/technician/field-visits" className="text-xs font-semibold text-brand-800 hover:underline">
            View all visits
          </Link>
        </div>

        {recentActivity.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">No completed visits, monitoring reports or dispersal updates yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-200/60">
            {recentActivity.map((activity) => (
              <li key={activity.key} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-start gap-2">
                  <Icon
                    name={activityIcon(activity.type)}
                    className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      {activity.link ? (
                        <Link to={activity.link} className="hover:text-brand-800 hover:underline">
                          {activity.label}
                        </Link>
                      ) : (
                        activity.label
                      )}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">{activity.subject}</p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {activity.status && (
                    <StatusBadge status={activity.status} label={activity.status_label} />
                  )}
                  <span className="text-[11px] text-slate-500">
                    {formatActivityWhen(activity.occurred_at, activity.occurred_on)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {planOpen && (
        <PlanVisitModal
          open
          onClose={() => {
            setPlanOpen(false);
            setPlanHousehold(null);
          }}
          initialBeneficiary={planHousehold}
          purposes={data?.purposes ?? []}
          onSaved={() => refetch()}
        />
      )}

      <FieldVisitFormModal
        open={logOpen}
        onClose={() => {
          setLogOpen(false);
          setLogHousehold(null);
          setCompletingPlan(null);
        }}
        initialBeneficiary={logHousehold}
        initialPurpose={completingPlan?.purpose ?? ""}
        purposes={data?.purposes ?? []}
        onSaved={handleVisitSaved}
      />
    </div>
  );
}

function Kpi({ icon, label, value, tone = "slate", hint = null }) {
  const tones = {
    brand: "bg-brand-50 text-brand-700 dark:bg-brand-100 dark:text-brand-800",
    red: "bg-red-50 text-red-700 dark:bg-red-100 dark:text-red-700",
    amber: "bg-amber-50 text-amber-800 dark:bg-amber-100 dark:text-amber-800",
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-200/60 dark:text-slate-600",
  };

  return (
    <div className="flex items-center gap-3 px-4 py-4">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tones[tone]}`}>
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="font-display text-xl font-bold text-slate-900 tabular-nums">{value ?? 0}</p>
        <p className="truncate text-[11px] font-medium text-slate-500">{label}</p>
        {hint && <p className="truncate text-[10px] text-slate-400">{hint}</p>}
      </div>
    </div>
  );
}

function TaskRow({ task, starting, onStart, onLog, onPlan }) {
  const status = taskStatus(task);
  const isPlan = task.kind === "plan";

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={task.link}
              className="truncate text-sm font-semibold text-slate-900 hover:text-brand-800 hover:underline"
            >
              {task.name_of_farmer}
            </Link>
            <StatusBadge status={status.key} label={status.label} />
          </div>

          <dl className="mt-1.5 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
            <div className="flex min-w-0 gap-1">
              <dt className="shrink-0 text-slate-400">Barangay</dt>
              <dd className="truncate text-slate-600">{task.address || "Not recorded"}</dd>
            </div>
            <div className="flex min-w-0 gap-1">
              <dt className="shrink-0 text-slate-400">Task</dt>
              <dd className="truncate text-slate-600">
                {task.task_type}
                {task.purpose_label ? ` · ${task.purpose_label}` : ""}
              </dd>
            </div>
            <div className="flex min-w-0 gap-1">
              <dt className="shrink-0 text-slate-400">Scheduled</dt>
              <dd className="truncate text-slate-600">
                {task.scheduled_for ? formatDate(task.scheduled_for) : "Due now"}
              </dd>
            </div>
          </dl>

          {task.notes && <p className="mt-1 line-clamp-1 text-[11px] text-slate-500">{task.notes}</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Link
            to={task.link}
            className="rounded-pill px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            View task
          </Link>
          {isPlan && (task.status === "pending" || task.status === "overdue") && (
            <button
              type="button"
              onClick={onStart}
              disabled={starting}
              className="btn-secondary !px-3 !py-1.5 text-[11px] disabled:opacity-60"
            >
              {starting ? "Starting…" : "Start"}
            </button>
          )}
          {!isPlan && (
            <button
              type="button"
              onClick={onPlan}
              className="btn-secondary !px-3 !py-1.5 text-[11px]"
            >
              Plan visit
            </button>
          )}
          <button type="button" onClick={onLog} className="btn-primary !px-3 !py-1.5 text-[11px]">
            Log visit
          </button>
        </div>
      </div>
    </li>
  );
}

function StatusBadge({ status, label }) {
  const tones = {
    pending: "bg-amber-50 text-amber-800 dark:bg-amber-100 dark:text-amber-800",
    in_progress: "bg-brand-50 text-brand-800 dark:bg-brand-100 dark:text-brand-800",
    overdue: "bg-red-50 text-red-700 dark:bg-red-100 dark:text-red-700",
    completed: "bg-brand-50 text-brand-800 dark:bg-brand-100 dark:text-brand-800",
    submitted: "bg-brand-50 text-brand-800 dark:bg-brand-100 dark:text-brand-800",
    recorded: "bg-slate-100 text-slate-700 dark:bg-slate-200/60 dark:text-slate-700",
    updated: "bg-slate-100 text-slate-700 dark:bg-slate-200/60 dark:text-slate-700",
  };

  return (
    <span className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold ${tones[status] ?? tones.pending}`}>
      {label}
    </span>
  );
}

function QuickLink({ to, icon, label }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 rounded-pill border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 dark:border-slate-200/60"
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}

function taskStatus(task) {
  if (task.status === "completed") return { key: "completed", label: "Completed" };
  if (task.status === "overdue" || task.is_overdue) return { key: "overdue", label: "Overdue" };
  if (task.status === "in_progress") return { key: "in_progress", label: "In progress" };
  return { key: "pending", label: "Pending" };
}

function activityIcon(type) {
  if (type === "field_visit") return "route";
  if (type === "dispersal") return "map-pin";
  if (type === "beneficiary") return "users";
  return "clipboard-check";
}

function formatActivityWhen(occurredAt, occurredOn) {
  if (occurredAt) {
    const date = new Date(occurredAt);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  }

  return formatDate(occurredOn);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function firstName(name) {
  return String(name ?? "there").trim().split(/\s+/)[0] || "there";
}

function todayLabel() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatDate(value) {
  if (!value) return "never";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}
