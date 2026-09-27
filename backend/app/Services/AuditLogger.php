<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * The single write path for the security audit trail.
 *
 * Append-only by design: rows are inserted, never updated or deleted, so the
 * log remains trustworthy after the fact. Writers pass the actor explicitly
 * (rather than resolving auth()->user()) because most audit-worthy moments
 * happen BEFORE authentication succeeds — failed logins, lockouts — where
 * there is no authenticated user and guessing could attribute an event to the
 * wrong account.
 *
 * Failures inside logging must never take the action itself down: a login
 * response should not 500 because the audit insert hiccupped, so logging is
 * wrapped and silently swallowed (a log write failure is not itself
 * loggable — it surfaces in the application log instead).
 */
class AuditLogger
{
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
     */
    public function log(User|int|null $actor, string $action, mixed $target = null, array $context = []): void
    {
        if (! in_array($action, ActivityLog::ACTIONS, true)) {
            throw new \InvalidArgumentException("Unknown audit action [{$action}].");
        }

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
            ]);
        } catch (\Throwable $e) {
            report($e);
        }
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
