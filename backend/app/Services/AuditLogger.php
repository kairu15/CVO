<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\User;
use App\Support\SensitiveMask;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The single write path for the security audit trail.
 *
 * Append-only by design: rows are inserted, never updated or deleted, so the
 * log remains trustworthy after the fact. Writers pass the actor explicitly
 * (rather than resolving auth()->user()) because most audit-worthy moments
 * happen BEFORE authentication succeeds — failed logins, lockouts — where
 * there is no authenticated user and guessing could attribute an event to the
 * wrong account. Model changes go through App\Models\Concerns\Auditable,
 * which resolves the actor from the session (null ⇒ a system action).
 *
 * Failure policy differs by context, because the two goals conflict:
 *
 *  - Outside a transaction (a login, a lockout) logging must never take the
 *    action down: a login response should not 500 because the audit insert
 *    hiccupped, so the failure is reported to the application log and
 *    swallowed.
 *  - Inside a transaction (a model change and its audit row) the trail must
 *    not lose a committed change: the insert is part of the same
 *    transaction, so a failure rethrows and the caller's CHANGE is rolled
 *    back with it. A committed change therefore always has its log row, and a
 *    rolled-back change leaves none.
 *
 * Values written here are masked (App\Support\SensitiveMask) before storage —
 * the log is never the copy that leaks an identifier.
 */
class AuditLogger
{
    /** Header the offline queue sends with a replayed submission. */
    public const OFFLINE_QUEUED_AT_HEADER = 'X-Offline-Queued-At';

    public function __construct(private readonly Request $request) {}

    /**
     * Record an audit event.
     *
     * @param  User|int|null  $actor  The acting user (or id) — null for
     *                                anonymous events such as a failed login
     *                                against an unknown identifier.
     * @param  string  $action     One of ActivityLog::ACTIONS.
     * @param  mixed  $target      Optional model / class-string the action was
     *                             performed on; becomes target_type + target_id.
     * @param  array<string, mixed>  $context  Structured, action-specific
     *                               details (kept small — no payloads, no
     *                               credentials, no raw remarks text).
     * @param  array<string, mixed>|null  $oldValues  Values before the change.
     * @param  array<string, mixed>|null  $newValues  Values after the change.
     */
    public function log(
        User|int|null $actor,
        string $action,
        mixed $target = null,
        array $context = [],
        ?array $oldValues = null,
        ?array $newValues = null,
    ): void {
        if (! in_array($action, ActivityLog::ACTIONS, true)) {
            throw new \InvalidArgumentException("Unknown audit action [{$action}].");
        }

        // A submission replayed from the offline queue carries the device's
        // original timestamp: the row's created_at is the SYNC time (when the
        // server learned), and this records when it actually happened, so the
        // trail never misrepresents field work as happening at sync time.
        $context = $this->withOfflineContext($context);

        try {
            ActivityLog::create([
                'actor_id' => $actor instanceof User ? $actor->id : $actor,
                'actor_role' => $actor instanceof User ? $actor->role : null,
                'action' => $action,
                'target_type' => $this->targetType($target),
                'target_id' => $target instanceof \Illuminate\Database\Eloquent\Model ? $target->getKey() : null,
                'ip_address' => $this->request->ip(),
                'user_agent' => mb_substr((string) $this->request->userAgent(), 0, 500),
                'context' => $context === [] ? null : $context,
                'old_values' => $oldValues === null || $oldValues === [] ? null : SensitiveMask::apply($oldValues),
                'new_values' => $newValues === null || $newValues === [] ? null : SensitiveMask::apply($newValues),
            ]);
        } catch (\Throwable $e) {
            report($e);

            // Inside a transaction the log belongs to the change: losing the
            // row means the change must not survive either.
            if (DB::transactionLevel() > 0) {
                throw $e;
            }
        }
    }

    /**
     * An offline replay is annotated with the device timestamp and the sync
     * time; live requests are left alone.
     *
     * @param  array<string, mixed>  $context
     * @return array<string, mixed>
     */
    private function withOfflineContext(array $context): array
    {
        $queuedAt = $this->request->header(self::OFFLINE_QUEUED_AT_HEADER);

        if (! is_string($queuedAt) || $queuedAt === '') {
            return $context;
        }

        try {
            $context['device_created_at'] = Carbon::parse($queuedAt)->toIso8601String();
        } catch (\Throwable) {
            // Unparseable header (a modified client) — record the raw value
            // rather than dropping the fact that the row was replayed.
            $context['device_created_at'] = mb_substr($queuedAt, 0, 40);
        }

        $context['synced_at'] = now()->toIso8601String();

        return $context;
    }

    /**
     * target_type is a short class basename ('Beneficiary'), not a FQCN, so
     * the admin log table renders without namespace noise.
     */
    private function targetType(mixed $target): ?string
    {
        if ($target instanceof \Illuminate\Database\Eloquent\Model) {
            return class_basename($target);
        }

        if (is_string($target) && class_exists($target)) {
            return class_basename($target);
        }

        return null;
    }
}
