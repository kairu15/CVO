<?php

namespace App\Services\Auth;

use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Support\Facades\Cache;

/**
 * Per-account lockout on top of the existing 6/min IP throttle (item 2).
 *
 * The route throttle (throttle:6,1 on the auth routes) stops a fast IP-based
 * brute force; this adds the account-based half: N consecutive failed logins
 * for ONE account lock THAT account for a cooldown, regardless of source IP —
 * a distributed attack (many IPs, one account) is exactly what the route
 * throttle cannot see.
 *
 * State lives in the cache (database cache store by default, so it survives
 * restarts and works across app servers). Counters decay to zero on a
 * successful login, when the lock expires, or when the password is reset —
 * see `clear()`.
 */
class AccountLockout
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** Cache key for the failure counter of one account. */
    public static function counterKey(int $userId): string
    {
        return "security:lockout:attempts:{$userId}";
    }

    /** Cache key for an account's active lock. */
    public static function lockKey(int $userId): string
    {
        return "security:lockout:locked:{$userId}";
    }

    /**
     * Whether the account is currently locked out.
     */
    public function isLocked(User $user): bool
    {
        return Cache::has(self::lockKey($user->id));
    }

    /**
     * Seconds until the lock lifts (0 when not locked) — surfaced to the
     * client so the UI can show a countdown instead of a bare refusal.
     */
    public function lockedForSeconds(User $user): int
    {
        $expiresAt = Cache::get(self::lockKey($user->id));

        return $expiresAt ? max(0, now()->diffInSeconds($expiresAt, false)) : 0;
    }

    /**
     * Throw the 423 locked-out validation error when the account is locked.
     *
     * Deliberately the SAME generic message shape as a credential failure —
     * no extra hint about the account state beyond the error key — so the
     * endpoint does not become an oracle for whether an account exists.
     */
    public function assertNotLocked(User $user): void
    {
        if (! $this->isLocked($user)) {
            return;
        }

        throw \Illuminate\Validation\ValidationException::withMessages([
            'identifier' => __('Too many failed attempts. Try again later.'),
        ])->status(423);
    }

    /**
     * Record a failed login against the account; locks it at the threshold.
     */
    public function recordFailure(User $user): void
    {
        $max = max(1, (int) config('security.lockout.max_attempts', 5));
        $window = now()->addMinutes(max(1, (int) config('security.lockout.window_minutes', 60)));

        $attempts = (int) Cache::get(self::counterKey($user->id), 0) + 1;

        Cache::put(self::counterKey($user->id), $attempts, $window);

        if ($attempts >= $max && ! $this->isLocked($user)) {
            $minutes = max(1, (int) config('security.lockout.lockout_minutes', 15));

            Cache::put(self::lockKey($user->id), now()->addMinutes($minutes), now()->addMinutes($minutes));

            // Lockouts are exactly what the audit trail exists for.
            $this->audit->log($user, 'account_locked', null, [
                'failed_attempts' => $attempts,
                'locked_minutes' => $minutes,
            ]);
        }
    }

    /**
     * A successful login wipes the failure count.
     */
    public function clear(User $user): void
    {
        Cache::forget(self::counterKey($user->id));
    }

    /**
     * Password reset also clears the lockout: the person who just proved
     * ownership of the email is not the attacker (and the attacker's brute
     * force is reset — they still need the NEW password).
     */
    public function resetForPasswordReset(User $user): void
    {
        Cache::forget(self::counterKey($user->id));
        Cache::forget(self::lockKey($user->id));
    }
}
