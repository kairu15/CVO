<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\Beneficiary;
use App\Models\FieldVisit;
use App\Models\FieldVisitPlan;
use App\Models\MonitoringRecord;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * The technician's task-oriented landing page.
 *
 * One aggregate request answers "what do I need to do today?": planned visits,
 * overdue plans, assigned households, visits due, and recent activity. It reads
 * the same Beneficiary, FieldVisit and FieldVisitPlan rows the module screens
 * use; nothing is copied into a second task store.
 */
class TechnicianDashboardService
{
    private const TODAY_LIMIT = 8;

    private const UPCOMING_LIMIT = 5;

    private const BENEFICIARY_LIMIT = 6;

    private const ACTIVITY_LIMIT = 6;

    private const TASK_LIMIT = 25;

    public function __construct(
        private readonly FieldVisitService $visits,
        private readonly SettingsService $settings,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function overview(User $technician): array
    {
        $today = today();
        $openPlans = FieldVisitPlan::query()
            ->where('technician_id', $technician->id)
            ->whereHas('beneficiary')
            ->open();

        $todayTasks = (clone $openPlans)
            ->with('beneficiary')
            ->whereDate('planned_for', '<=', $today)
            ->orderBy('planned_for')
            ->orderBy('id')
            ->limit(self::TODAY_LIMIT)
            ->get();

        $upcomingTasks = (clone $openPlans)
            ->with('beneficiary')
            ->whereDate('planned_for', '>', $today)
            ->orderBy('planned_for')
            ->orderBy('id')
            ->limit(self::UPCOMING_LIMIT)
            ->get();

        $due = $this->visits->visitsDueFor($technician);
        $map = $this->mapHouseholds($technician);

        return [
            'generated_at' => now()->toIso8601String(),
            'counts' => [
                'assigned_beneficiaries' => Beneficiary::query()
                    ->where('technician_id', $technician->id)
                    ->count(),
                // The four cards on the technician workspace: open plans,
                // all completed trips, and households whose delivery has no
                // dispersal record yet. The plan-specific counters stay for
                // the existing worklist fields and their tests.
                'pending_field_visits' => (clone $openPlans)->count(),
                'completed_field_visits' => FieldVisit::query()
                    ->where('technician_id', $technician->id)
                    ->count(),
                'pending_dispersals' => Beneficiary::query()
                    ->where('technician_id', $technician->id)
                    ->whereDoesntHave('dispersalEvents')
                    ->count(),
                'today_tasks' => (clone $openPlans)->whereDate('planned_for', '<=', $today)->count(),
                'overdue_tasks' => (clone $openPlans)->whereDate('planned_for', '<', $today)->count(),
                'visits_today' => FieldVisit::query()
                    ->where('technician_id', $technician->id)
                    ->whereDate('visited_on', $today)
                    ->count(),
                'due_households' => (int) $due['total'],
            ],
            'today_tasks' => $todayTasks->map(fn (FieldVisitPlan $plan): array => $this->planRow($plan))->all(),
            'upcoming_tasks' => $upcomingTasks->map(fn (FieldVisitPlan $plan): array => $this->planRow($plan))->all(),
            // One permission-safe work queue for the compact task table:
            // every open plan plus the due households that have no plan yet.
            'assigned_tasks' => $this->assignedTasks($technician, $due),
            'overdue_households' => array_slice($due['households'], 0, 5),
            'assigned_beneficiaries' => $this->assignedPreview($technician),
            'recent_activity' => $this->recentActivity($technician),
            'barangays' => $this->barangayCounts($technician),
            // Assigned household locations for the embedded map. Households
            // without their own pin fall back to their barangay centre and
            // are marked approximate; rows with neither are counted, never
            // invented at 0,0.
            'map_households' => $map['households'],
            'map' => [
                'mapped' => count($map['households']),
                'unlocated' => $map['unlocated'],
                'total' => count($map['households']) + $map['unlocated'],
            ],
            'purposes' => $this->settings->fieldVisitPurposes(),
            'window_days' => $due['window_days'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function planRow(FieldVisitPlan $plan): array
    {
        return [
            'id' => $plan->id,
            'beneficiary_id' => $plan->beneficiary_id,
            'name_of_farmer' => $plan->beneficiary?->name_of_farmer,
            'address' => $plan->beneficiary?->address,
            'animal_type' => $plan->beneficiary?->animal_type,
            'planned_for' => $plan->planned_for?->toDateString(),
            'purpose' => $plan->purpose,
            'purpose_label' => Str::headline($plan->purpose),
            'status' => $plan->status,
            'is_overdue' => $plan->isOverdue(),
            'notes' => $plan->notes,
            'field_visit_id' => $plan->field_visit_id,
        ];
    }

    /**
     * The compact "My assigned tasks" queue.
     *
     * Plans are the scheduled work; a household already past the shared
     * contact window is added as a follow-up when it has no open plan, so the
     * same household is never presented twice. Every row carries the fields
     * the table displays (task type, place, scheduled date, status, link).
     *
     * @param  array<string, mixed>  $due
     * @return list<array<string, mixed>>
     */
    private function assignedTasks(User $technician, array $due): array
    {
        $plans = FieldVisitPlan::query()
            ->where('technician_id', $technician->id)
            ->whereHas('beneficiary')
            ->open()
            ->with('beneficiary')
            ->orderBy('planned_for')
            ->orderBy('id')
            ->limit(self::TASK_LIMIT)
            ->get();

        $plannedHouseholds = $plans
            ->pluck('beneficiary_id')
            ->map(fn ($id): int => (int) $id)
            ->all();

        $tasks = $plans->map(function (FieldVisitPlan $plan): array {
            $status = $plan->isOverdue() ? 'overdue' : $plan->status;

            return [
                'key' => "plan-{$plan->id}",
                'kind' => 'plan',
                'plan_id' => $plan->id,
                'beneficiary_id' => $plan->beneficiary_id,
                'name_of_farmer' => $plan->beneficiary?->name_of_farmer,
                'address' => $plan->beneficiary?->address,
                'animal_type' => $plan->beneficiary?->animal_type,
                'task_type' => 'Field visit',
                'purpose' => $plan->purpose,
                'purpose_label' => Str::headline($plan->purpose),
                'scheduled_for' => $plan->planned_for?->toDateString(),
                'status' => $status,
                'is_overdue' => $plan->isOverdue(),
                'notes' => $plan->notes,
                'field_visit_id' => $plan->field_visit_id,
                'link' => "/dashboard/technician/beneficiaries/{$plan->beneficiary_id}/lineage",
            ];
        })->all();

        $windowDays = (int) ($due['window_days'] ?? BeneficiaryDirectoryService::OVERDUE_DAYS);

        foreach ($due['households'] as $household) {
            if (in_array((int) $household['id'], $plannedHouseholds, true)) {
                continue;
            }

            $lastContact = $this->latestDate(
                $household['last_visit_on'] ?? null,
                $household['last_monitoring_on'] ?? null,
            );
            $dueOn = $lastContact?->copy()->addDays($windowDays);

            $tasks[] = [
                'key' => "follow-up-{$household['id']}",
                'kind' => 'follow_up',
                'plan_id' => null,
                'beneficiary_id' => (int) $household['id'],
                'name_of_farmer' => $household['name_of_farmer'],
                'address' => $household['address'],
                'animal_type' => null,
                'task_type' => 'Follow-up visit',
                'purpose' => null,
                'purpose_label' => 'No recent contact',
                'scheduled_for' => $dueOn?->toDateString(),
                'status' => 'overdue',
                'is_overdue' => true,
                'notes' => $lastContact
                    ? 'Last contact '.$lastContact->toDateString().
                        "; the {$windowDays}-day follow-up window has passed."
                    : 'No monitoring record or field visit has been recorded yet.',
                'field_visit_id' => null,
                'link' => "/dashboard/technician/beneficiaries/{$household['id']}/lineage",
            ];
        }

        usort($tasks, function (array $a, array $b): int {
            $rank = ['overdue' => 0, 'in_progress' => 1, 'pending' => 2];

            return [
                $rank[$a['status']] ?? 3,
                $a['scheduled_for'] ?? '0000-00-00',
                strtolower((string) ($a['name_of_farmer'] ?? '')),
            ] <=> [
                $rank[$b['status']] ?? 3,
                $b['scheduled_for'] ?? '0000-00-00',
                strtolower((string) ($b['name_of_farmer'] ?? '')),
            ];
        });

        return array_slice($tasks, 0, self::TASK_LIMIT);
    }

    /**
     * The six assigned households with the oldest last contact first. The
     * correlated ordering is done in SQL so a technician with hundreds of
     * assignments does not ship every row to the browser just to sort it.
     *
     * @return list<array<string, mixed>>
     */
    private function assignedPreview(User $technician): array
    {
        $cutoff = now()->subDays(BeneficiaryDirectoryService::OVERDUE_DAYS)->startOfDay();

        return Beneficiary::query()
            ->where('technician_id', $technician->id)
            ->withMax('fieldVisits as last_visit_on', 'visited_on')
            ->withMax('monitoringRecords as last_monitoring_on', 'date_monitored')
            ->orderByRaw(
                "COALESCE(
                    (select max(fv.visited_on) from field_visits fv
                     where fv.beneficiary_id = beneficiaries.id and fv.deleted_at is null),
                    (select max(mr.date_monitored) from monitoring_records mr
                     where mr.beneficiary_id = beneficiaries.id and mr.deleted_at is null),
                    '1970-01-01'
                ) asc"
            )
            ->orderBy('name_of_farmer')
            ->limit(self::BENEFICIARY_LIMIT)
            ->get()
            ->map(function (Beneficiary $beneficiary) use ($cutoff): array {
                $lastContact = $this->latestDate($beneficiary->last_visit_on, $beneficiary->last_monitoring_on);

                return [
                    'id' => $beneficiary->id,
                    'name_of_farmer' => $beneficiary->name_of_farmer,
                    'address' => $beneficiary->address,
                    'animal_type' => $beneficiary->animal_type,
                    'ear_tag_number' => $beneficiary->ear_tag_number,
                    'last_contact_on' => $lastContact?->toDateString(),
                    'needs_visit' => $lastContact === null || $lastContact->lt($cutoff),
                ];
            })
            ->all();
    }

    /**
     * Completed visits, monitoring reports, dispersal updates and beneficiary
     * corrections authored by this technician, merged into one newest-first
     * activity feed. The audit log supplies the actions that have no
     * technician-authored row of their own (dispersals and beneficiary edits).
     *
     * @return list<array<string, mixed>>
     */
    private function recentActivity(User $technician): array
    {
        $visits = FieldVisit::query()
            ->with('beneficiary:id,name_of_farmer')
            ->where('technician_id', $technician->id)
            ->latest('visited_on')
            ->latest('id')
            ->limit(self::ACTIVITY_LIMIT)
            ->get()
            ->map(fn (FieldVisit $visit): array => [
                'key' => "visit-{$visit->id}",
                'type' => 'field_visit',
                'label' => 'Field visit completed',
                'subject' => $visit->beneficiary?->name_of_farmer,
                'occurred_on' => $visit->visited_on?->toDateString(),
                'occurred_at' => $visit->created_at?->toIso8601String(),
                'status' => 'completed',
                'status_label' => 'Completed',
                'sort_at' => $visit->created_at?->toIso8601String()
                    ?? $visit->visited_on?->toIso8601String(),
                'link' => '/dashboard/technician/field-visits',
            ]);

        $monitoring = MonitoringRecord::query()
            ->with('beneficiary:id,name_of_farmer')
            ->where('technician_id', $technician->id)
            ->latest('date_monitored')
            ->latest('id')
            ->limit(self::ACTIVITY_LIMIT)
            ->get()
            ->map(fn (MonitoringRecord $record): array => [
                'key' => "monitoring-{$record->id}",
                'type' => 'monitoring',
                'label' => 'Monitoring report submitted',
                'subject' => $record->beneficiary?->name_of_farmer,
                'occurred_on' => $record->date_monitored?->toDateString(),
                'occurred_at' => $record->created_at?->toIso8601String(),
                'status' => 'submitted',
                'status_label' => 'Submitted',
                'sort_at' => $record->created_at?->toIso8601String()
                    ?? $record->date_monitored?->toIso8601String(),
                'link' => '/dashboard/technician/monitoring',
            ]);

        return $visits
            ->concat($monitoring)
            ->concat($this->dispersalActivity($technician))
            ->concat($this->beneficiaryActivity($technician))
            ->sortByDesc('sort_at')
            ->take(self::ACTIVITY_LIMIT)
            ->map(function (array $activity): array {
                unset($activity['sort_at']);

                return $activity;
            })
            ->values()
            ->all();
    }

    /**
     * Dispersal actions recorded by this technician, read from the audit trail
     * because an ownership event does not store an author column.
     *
     * @return Collection<int, array<string, mixed>>
     */
    private function dispersalActivity(User $technician)
    {
        $labels = [
            'dispersal_recorded' => 'Dispersal recorded',
            're_dispersal_recorded' => 'Re-dispersal recorded',
            'pass_on_recorded' => 'Pass-on recorded',
            'return_recorded' => 'Animal returned',
        ];

        $logs = ActivityLog::query()
            ->where('actor_id', $technician->id)
            ->whereIn('action', array_keys($labels))
            ->latest('created_at')
            ->latest('id')
            ->limit(self::ACTIVITY_LIMIT)
            ->get();

        $beneficiaryIds = $logs
            ->map(function (ActivityLog $log): ?int {
                $context = $log->context ?? [];

                return isset($context['to_beneficiary_id'])
                    ? (int) $context['to_beneficiary_id']
                    : (isset($context['from_beneficiary_id']) ? (int) $context['from_beneficiary_id'] : null);
            })
            ->filter()
            ->unique()
            ->values();

        $names = Beneficiary::query()
            ->whereIn('id', $beneficiaryIds)
            ->pluck('name_of_farmer', 'id');

        return $logs->map(function (ActivityLog $log) use ($labels, $names): array {
            $context = $log->context ?? [];
            $beneficiaryId = isset($context['to_beneficiary_id'])
                ? (int) $context['to_beneficiary_id']
                : (isset($context['from_beneficiary_id']) ? (int) $context['from_beneficiary_id'] : null);
            $animal = isset($context['ear_tag_number']) && $context['ear_tag_number'] !== null
                ? "Animal {$context['ear_tag_number']}"
                : (isset($context['animal_id']) ? "Animal #{$context['animal_id']}" : 'Animal');
            $farmer = $beneficiaryId !== null ? $names->get($beneficiaryId) : null;

            return [
                'key' => "dispersal-{$log->id}",
                'type' => 'dispersal',
                'label' => $labels[$log->action] ?? 'Dispersal updated',
                'subject' => $farmer ? "{$animal} · {$farmer}" : $animal,
                'occurred_on' => isset($context['event_date'])
                    ? (string) $context['event_date']
                    : $log->created_at?->toDateString(),
                'occurred_at' => $log->created_at?->toIso8601String(),
                'status' => 'recorded',
                'status_label' => 'Recorded',
                'sort_at' => $log->created_at?->toIso8601String(),
                'link' => $beneficiaryId !== null
                    ? "/dashboard/technician/beneficiaries/{$beneficiaryId}/lineage"
                    : '/dashboard/technician/map',
            ];
        });
    }

    /**
     * Beneficiary corrections made by this technician. This is normally an
     * administrator action, but the feed can still show it when the capability
     * matrix grants the technician the edit.
     *
     * @return Collection<int, array<string, mixed>>
     */
    private function beneficiaryActivity(User $technician)
    {
        $logs = ActivityLog::query()
            ->where('actor_id', $technician->id)
            ->where('action', 'beneficiary_updated')
            ->where('target_type', 'Beneficiary')
            ->latest('created_at')
            ->latest('id')
            ->limit(self::ACTIVITY_LIMIT)
            ->get();

        $names = Beneficiary::query()
            ->whereIn('id', $logs->pluck('target_id')->filter()->unique())
            ->pluck('name_of_farmer', 'id');

        return $logs->map(function (ActivityLog $log) use ($names): array {
            $farmer = $log->target_id !== null ? $names->get($log->target_id) : null;

            return [
                'key' => "beneficiary-{$log->id}",
                'type' => 'beneficiary',
                'label' => 'Beneficiary record updated',
                'subject' => $farmer ?? 'Household record',
                'occurred_on' => $log->created_at?->toDateString(),
                'occurred_at' => $log->created_at?->toIso8601String(),
                'status' => 'updated',
                'status_label' => 'Updated',
                'sort_at' => $log->created_at?->toIso8601String(),
                'link' => $log->target_id !== null
                    ? "/dashboard/technician/beneficiaries/{$log->target_id}/lineage"
                    : null,
            ];
        });
    }

    /**
     * Every assigned household that can be placed on the map. A household's
     * own coordinates win; otherwise the barangay centre is used and marked
     * approximate. Rows with neither are counted as unlocated.
     *
     * @return array{households: list<array<string, mixed>>, unlocated: int}
     */
    private function mapHouseholds(User $technician): array
    {
        $unlocated = 0;

        $households = Beneficiary::query()
            ->where('technician_id', $technician->id)
            ->with('barangay:id,name,latitude,longitude')
            ->orderBy('name_of_farmer')
            ->get()
            ->map(function (Beneficiary $beneficiary) use (&$unlocated): ?array {
                [$latitude, $longitude, $source, $approximate] = $this->locationFor($beneficiary);

                if ($latitude === null || $longitude === null) {
                    $unlocated += 1;

                    return null;
                }

                return [
                    'id' => $beneficiary->id,
                    'name_of_farmer' => $beneficiary->name_of_farmer,
                    'address' => $beneficiary->address,
                    'barangay' => $beneficiary->barangay?->name ?? $beneficiary->address,
                    'animal_type' => $beneficiary->animal_type,
                    'ear_tag_number' => $beneficiary->ear_tag_number,
                    'latitude' => $latitude,
                    'longitude' => $longitude,
                    'location_source' => $source,
                    'approximate' => $approximate,
                ];
            })
            ->filter()
            ->values()
            ->all();

        return ['households' => $households, 'unlocated' => $unlocated];
    }

    /**
     * @return array{0: ?float, 1: ?float, 2: string, 3: bool}
     */
    private function locationFor(Beneficiary $beneficiary): array
    {
        if ($this->validCoordinates($beneficiary->latitude, $beneficiary->longitude)) {
            return [
                (float) $beneficiary->latitude,
                (float) $beneficiary->longitude,
                (string) ($beneficiary->location_source ?? 'beneficiary'),
                false,
            ];
        }

        $barangay = $beneficiary->barangay;

        if ($barangay !== null && $this->validCoordinates($barangay->latitude, $barangay->longitude)) {
            return [
                (float) $barangay->latitude,
                (float) $barangay->longitude,
                'barangay_centroid',
                true,
            ];
        }

        return [null, null, 'none', true];
    }

    private function validCoordinates(mixed $latitude, mixed $longitude): bool
    {
        if (! is_numeric($latitude) || ! is_numeric($longitude)) {
            return false;
        }

        $latitude = (float) $latitude;
        $longitude = (float) $longitude;

        return $latitude >= -90
            && $latitude <= 90
            && $longitude >= -180
            && $longitude <= 180
            && ! ($latitude === 0.0 && $longitude === 0.0);
    }

    /**
     * Assigned households per barangay — a compact place summary that links to
     * the full, row-scoped dispersal map.
     *
     * @return list<array{name: string, total: int}>
     */
    private function barangayCounts(User $technician): array
    {
        return Beneficiary::query()
            ->where('technician_id', $technician->id)
            ->select('address')
            ->selectRaw('count(*) as total')
            ->groupBy('address')
            ->orderByDesc('total')
            ->orderBy('address')
            ->get()
            ->map(fn (Beneficiary $row): array => [
                'name' => (string) $row->address,
                'total' => (int) $row->total,
            ])
            ->all();
    }

    /** The later of two optional dates, or null when both are absent. */
    private function latestDate(?string $first, ?string $second): ?Carbon
    {
        $dates = collect([$first, $second])
            ->filter()
            ->map(fn (string $date): Carbon => Carbon::parse($date));

        return $dates->isEmpty() ? null : $dates->sortDesc()->first();
    }
}
