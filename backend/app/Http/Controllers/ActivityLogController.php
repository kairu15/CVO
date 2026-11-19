<?php

namespace App\Http\Controllers;

use App\Http\Requests\ActivityLogRequest;
use App\Http\Resources\ActivityLogResource;
use App\Http\Resources\ActivityLogSummaryResource;
use App\Models\ActivityLog;
use App\Models\User;
use App\Services\AuditLogger;
use App\Support\AuditTaxonomy;
use App\Support\Pagination;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Carbon;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Read-only access to the security audit trail (item 7).
 *
 * There is deliberately no store/update/destroy here: the log is append-only
 * (writes go through AuditLogger from the actions themselves) and must never
 * be editable through the API. The controller offers four read shapes over
 * the same filtered query:
 *
 *   GET /admin/activity-logs            paginated rows (full or summary)
 *   GET /admin/activity-logs/summary    overview figures for those filters
 *   GET /admin/activity-logs/{id}       one row with its before/after diff
 *   GET /admin/activity-logs/export     the same rows as a streamed CSV
 */
class ActivityLogController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

    /**
     * Paginated, filterable audit log, newest first.
     */
    public function index(ActivityLogRequest $request): AnonymousResourceCollection
    {
        $validated = $request->validated();
        $query = $this->filtered($validated);

        $perPage = Pagination::perPage($validated['per_page'] ?? null);

        // The SPA asks for the lightweight row; the default stays the full
        // shape so existing callers and saved integrations keep working.
        if ($request->boolean('summary')) {
            $query->select([
                'id', 'actor_id', 'actor_name', 'actor_email', 'actor_role',
                'action', 'target_type', 'target_id', 'ip_address',
                'old_values', 'new_values', 'created_at',
            ]);

            return ActivityLogSummaryResource::collection($query->paginate($perPage));
        }

        return ActivityLogResource::collection($query->paginate($perPage));
    }

    /**
     * One entry with its complete context and changed-field pair — fetched by
     * the detail drawer so the list never ships diffs nobody opened.
     */
    public function show(int $id): ActivityLogResource
    {
        $log = ActivityLog::query()
            ->with(['actor' => fn ($query) => $query->withTrashed()])
            ->findOrFail($id);

        return new ActivityLogResource($log);
    }

    /**
     * Overview figures for the active filters, plus a global last-24-hours
     * security snapshot. Kept to a handful of indexed aggregates rather than
     * one query per card.
     */
    public function summary(ActivityLogRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $base = $this->filtered($validated);
        $today = now()->startOfDay();

        $logins = AuditTaxonomy::LOGIN_ACTIONS;
        $critical = AuditTaxonomy::CRITICAL_ACTIONS;

        $loginPlaceholders = implode(',', array_fill(0, count($logins), '?'));
        $criticalPlaceholders = implode(',', array_fill(0, count($critical), '?'));

        $totals = (clone $base)
            // An aggregate row has no single created_at/id to sort by, and
            // MySQL's ONLY_FULL_GROUP_BY rejects the inherited ORDER BY.
            ->reorder()
            ->selectRaw(
                'COUNT(*) as total, '
                .'COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) as today, '
                ."COALESCE(SUM(CASE WHEN action IN ({$loginPlaceholders}) THEN 1 ELSE 0 END), 0) as logins, "
                ."COALESCE(SUM(CASE WHEN action = 'failed_login' THEN 1 ELSE 0 END), 0) as failed_logins, "
                ."COALESCE(SUM(CASE WHEN action IN ({$criticalPlaceholders}) THEN 1 ELSE 0 END), 0) as critical, "
                .'MAX(created_at) as latest_at',
                [$today, ...$logins, ...$critical],
            )
            ->first();

        $failed24h = ActivityLog::query()
            ->where('action', 'failed_login')
            ->where('created_at', '>=', now()->subDay());

        $repeatSources = (clone $failed24h)
            ->whereNotNull('ip_address')
            ->select('ip_address')
            ->groupBy('ip_address')
            ->havingRaw('COUNT(*) >= 3')
            ->get()
            ->count();

        return response()->json(['data' => [
            'total' => (int) ($totals->total ?? 0),
            'today' => (int) ($totals->today ?? 0),
            'logins' => (int) ($totals->logins ?? 0),
            'failed_logins' => (int) ($totals->failed_logins ?? 0),
            'critical' => (int) ($totals->critical ?? 0),
            'latest_at' => $totals?->latest_at !== null
                ? Carbon::parse($totals->latest_at)->toIso8601String()
                : null,
            'security' => [
                'failed_logins_24h' => (clone $failed24h)->count(),
                'locked_accounts_24h' => ActivityLog::query()
                    ->where('action', 'account_locked')
                    ->where('created_at', '>=', now()->subDay())
                    ->count(),
                'repeat_sources_24h' => $repeatSources,
            ],
        ]]);
    }

    /**
     * The filter vocabulary for the audit page, in one response: the action
     * list AuditLogger validates writes against, the entity types that exist
     * so far, the actors who appear in the log, and the taxonomy the screen
     * groups them by.
     */
    public function actions(): JsonResponse
    {
        return response()->json([
            'data' => [
                'actions' => ActivityLog::ACTIONS,
                'target_types' => ActivityLog::query()
                    ->whereNotNull('target_type')
                    ->distinct()
                    ->orderBy('target_type')
                    ->pluck('target_type')
                    ->all(),
                'actors' => ActivityLog::query()
                    ->whereNotNull('actor_id')
                    ->distinct()
                    ->orderBy('actor_id')
                    ->limit(200)
                    ->pluck('actor_id')
                    ->pipe(fn ($ids) => User::query()
                        ->withTrashed()
                        ->whereIn('id', $ids)
                        ->get(['id', 'name', 'email'])
                        ->values()),
                'roles' => AuditTaxonomy::roles(),
                'modules' => AuditTaxonomy::modules(),
                'statuses' => AuditTaxonomy::statuses(),
            ],
        ]);
    }

    /**
     * Stream the filtered trail as CSV.
     *
     * The export reuses the list's filters, adds its own audit row (an export
     * of the trail is itself an audit-worthy event), and streams chunk by
     * chunk so a year of history never has to fit in memory. Values are
     * escaped against spreadsheet formula injection.
     */
    public function export(ActivityLogRequest $request): StreamedResponse
    {
        $validated = $request->validated();
        $query = $this->filtered($validated);
        // Snapshot the matching rows before writing this export to the trail:
        // otherwise the event's own `exported` row would be streamed into the
        // file it is describing.
        $maxId = (clone $query)->max('id');
        $count = (clone $query)->where('id', '<=', $maxId ?? 0)->count();

        $filters = collect($validated)
            ->except(['summary', 'per_page'])
            ->filter(fn ($value) => $value !== null && $value !== '')
            ->all();

        // Log before streaming: an interrupted download was still an export.
        $this->audit->log($request->user(), 'exported', null, [
            'resource' => 'audit_trail',
            'format' => 'csv',
            'rows' => $count,
            'filters' => $filters,
        ]);

        $filename = 'audit-trail-'.now()->format('Y-m-d-His').'.csv';

        return response()->streamDownload(function () use ($query, $maxId): void {
            $out = fopen('php://output', 'w');

            // UTF-8 BOM so Excel opens the file with the right encoding.
            fwrite($out, "\xEF\xBB\xBF");

            fputcsv($out, [
                'id', 'created_at', 'actor_name', 'actor_email', 'actor_role',
                'action', 'module', 'status', 'target_type', 'target_id',
                'ip_address', 'context', 'old_values', 'new_values',
            ]);

            $query->where('id', '<=', $maxId ?? 0)
                ->select([
                    'id', 'created_at', 'actor_name', 'actor_email', 'actor_role',
                    'action', 'target_type', 'target_id', 'ip_address',
                    'context', 'old_values', 'new_values',
                ])->chunkById(500, function ($rows) use ($out): void {
                foreach ($rows as $row) {
                    fputcsv($out, [
                        $row->id,
                        $row->created_at?->toIso8601String(),
                        $row->actor_name,
                        $row->actor_email,
                        $row->actor_role,
                        $row->action,
                        AuditTaxonomy::moduleFor($row->action, $row->target_type),
                        AuditTaxonomy::statusFor($row->action),
                        $row->target_type,
                        $row->target_id,
                        $row->ip_address,
                        $this->csvValue($row->context),
                        $this->csvValue($row->old_values),
                        $this->csvValue($row->new_values),
                    ]);
                }
            });

            fclose($out);
        }, $filename, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /**
     * The one query every read shape starts from. All filters are applied in
     * SQL, and date bounds are inclusive days (a `date_to` of today must not
     * stop at midnight).
     *
     * @param  array<string, mixed>  $validated
     */
    private function filtered(array $validated): Builder
    {
        return ActivityLog::query()
            ->with(['actor' => fn ($query) => $query->withTrashed()])
            ->when($validated['action'] ?? null, fn ($q, $action) => $q->where('action', $action))
            ->when($validated['actor_id'] ?? null, fn ($q, $actorId) => $q->where('actor_id', $actorId))
            ->when($validated['actor_role'] ?? null, fn ($q, $role) => $q->where('actor_role', $role))
            ->when($validated['target_type'] ?? null, fn ($q, $type) => $q->where('target_type', $type))
            ->when($validated['ip_address'] ?? null, fn ($q, $ip) => $q->where('ip_address', $ip))
            ->when($validated['module'] ?? null, function ($q, $module): void {
                $actions = AuditTaxonomy::actionsForModule($module);
                $types = AuditTaxonomy::targetTypesForModule($module);

                $q->where(function ($q) use ($actions, $types): void {
                    $applied = false;

                    if ($actions !== []) {
                        $q->whereIn('action', $actions);
                        $applied = true;
                    }

                    if ($types !== []) {
                        $applied ? $q->orWhereIn('target_type', $types) : $q->whereIn('target_type', $types);
                    }
                });
            })
            ->when($validated['status'] ?? null, function ($q, $status): void {
                if ($status === AuditTaxonomy::STATUS_SUCCESS) {
                    $q->whereNotIn('action', array_unique([
                        ...AuditTaxonomy::FAILED_ACTIONS,
                        ...AuditTaxonomy::SECURITY_ACTIONS,
                    ]));

                    return;
                }

                $q->whereIn('action', AuditTaxonomy::actionsForStatus($status));
            })
            ->when($validated['date_from'] ?? null, fn ($q, $from) => $q
                ->where('created_at', '>=', Carbon::parse($from)->startOfDay()))
            ->when($validated['date_to'] ?? null, fn ($q, $to) => $q
                ->where('created_at', '<=', Carbon::parse($to)->endOfDay()))
            ->when($validated['search'] ?? null, function ($q, $search): void {
                $term = trim($search);

                if ($term === '') {
                    return;
                }

                $q->where(function ($q) use ($term): void {
                    $like = "%{$term}%";

                    $q->whereHas('actor', function ($uq) use ($like): void {
                        $uq->withTrashed()
                            ->where('name', 'like', $like)
                            ->orWhere('email', 'like', $like)
                            ->orWhere('username', 'like', $like);
                    })
                        ->orWhere('actor_name', 'like', $like)
                        ->orWhere('actor_email', 'like', $like)
                        ->orWhere('action', 'like', $like)
                        ->orWhere('target_type', 'like', $like)
                        ->orWhere('ip_address', 'like', $like);

                    if (ctype_digit($term)) {
                        $q->orWhere('target_id', (int) $term);
                    }
                });
            })
            ->latest('created_at')
            ->latest('id');
    }

    /**
     * JSON for a CSV cell, with spreadsheet formula injection neutralised.
     */
    private function csvValue(mixed $value): string
    {
        if ($value === null || $value === []) {
            return '';
        }

        $encoded = is_string($value) ? $value : (string) json_encode($value);

        if ($encoded !== '' && in_array($encoded[0], ['=', '+', '-', '@', "\t", "\r"], true)) {
            return "'".$encoded;
        }

        return $encoded;
    }
}
