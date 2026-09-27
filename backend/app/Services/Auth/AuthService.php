<?php

namespace App\Services\Auth;

use App\Models\MonitoringRecord;
use App\Models\User;
use App\Models\UserNotification;
use App\Services\AuditLogger;
use App\Services\NotificationService;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

class AuthService
{
    public function __construct(
        private readonly NotificationService $notifications,
        private readonly AccountLockout $lockout,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Register a new user and return them.
     *
     * Public self-registration can only ever create a farmer. Staff roles
     * (admin, doctor, technician) are assigned by an administrator, so the
     * role is hard-coded here rather than taken from the request.
     *
     * When dispersal details are supplied, a beneficiary record is created in
     * the same transaction — those identity fields (name of farmer, address,
     * animal type, sex) are what every future monitoring record auto-fills
     * from, so they are captured exactly once, here. The structured location
     * (barangay_id/purok_id) rides along; RegisterRequest has already checked
     * that the purok belongs to the barangay.
     *
     * @param  array{name_of_farmer?: string, address?: string, animal_type?: string, sex?: string, latitude?: float|null, longitude?: float|null, location_source?: string, barangay_id?: int|null, purok_id?: int|null}|null  $dispersal
     */
    public function register(
        string $name,
        string $username,
        string $email,
        string $password,
        ?array $dispersal = null,
    ): User {
        $user = DB::transaction(function () use ($name, $username, $email, $password, $dispersal): User {
            $user = User::create([
                'name' => $name,
                'username' => Str::lower($username),
                'email' => $email,
                'password' => $password,
                'role' => User::DEFAULT_ROLE,
            ]);

            if ($dispersal !== null && array_filter($dispersal)) {
                // Every registration address is a covered barangay (the
                // dropdown is validated server-side), so a pin can ALWAYS be
                // resolved: use the GPS/map-pin fix when the browser captured
                // one, otherwise fall back to the barangay's authoritative
                // center. Without this fallback a farmer who skipped the map
                // step produced a coordinate-less row — invisible on the
                // dispersal map, despite the address naming a real place.
                $latitude = $dispersal['latitude'] ?? null;
                $longitude = $dispersal['longitude'] ?? null;
                $locationSource = $dispersal['location_source'] ?? 'manual';

                if ($latitude === null || $longitude === null) {
                    $center = \App\Support\Barangays::centerFor(
                        \App\Support\Barangays::normalize((string) ($dispersal['address'] ?? '')),
                    );

                    if ($center !== null) {
                        [$latitude, $longitude] = $center;
                        $locationSource = 'manual';
                    }
                }

                $beneficiary = $user->beneficiaries()->create([
                    'name_of_farmer' => ($dispersal['name_of_farmer'] ?? '') !== '' ? $dispersal['name_of_farmer'] : $name,
                    'address' => $dispersal['address'] ?? '',
                    'barangay_id' => $dispersal['barangay_id'] ?? null,
                    'purok_id' => $dispersal['purok_id'] ?? null,
                    'animal_type' => $dispersal['animal_type'] ?? '',
                    'sex' => $dispersal['sex'] ?? 'F',
                    'latitude' => $latitude,
                    'longitude' => $longitude,
                    // How the location was captured — gps fix, moved map pin
                    // (or a confirmed suggestion), or a manual dropdown
                    // choice. Staff use it to judge coordinate quality.
                    'location_source' => $locationSource,
                ]);

                // The registration IS the first monitoring entry: the admin
                // sees the new farmer on the Monitoring table immediately,
                // flagged `new`, without waiting for a technician visit.
                // Same transaction — a farmer account can never exist without
                // its record, and a retried/partial registration can never
                // create two. The countdown targets the upcoming midnight
                // (app timezone): accepted or not, the flag clears next day.
                $record = $beneficiary->monitoringRecords()->create([
                    'technician_id' => null,
                    'registration_status' => MonitoringRecord::REGISTRATION_NEW,
                    'registered_at' => now(),
                    'status_expires_at' => now()->addDay()->startOfDay(),
                ]);

                // Tell every admin a new farmer needs review — the event is
                // the record they see flagged "New" on the monitoring table.
                // Inside the transaction: an account, its record, and the
                // admins' notifications all commit together or not at all.
                User::query()->where('role', 'admin')->get()->each(
                    fn (User $admin) => $this->notifications->create($admin, [
                        'type' => UserNotification::TYPE_REGISTRATION_NEW,
                        'actor_id' => $user->id,
                        'beneficiary_id' => $beneficiary->id,
                        'monitoring_record_id' => $record->id,
                        'title' => 'New farmer registered',
                        'message' => "{$beneficiary->name_of_farmer} in {$beneficiary->address} registered a new dispersal — awaiting review.",
                        'link' => '/dashboard/admin/monitoring',
                    ]),
                );
            }

            return $user;
        });

        return $user;
    }

    /**
     * Validate credentials and return the matching user.
     *
     * The identifier may be either an email address or a username.
     *
     * Hardening (items 1, 2, 7): every attempt — success or failure — is
     * audited; failed attempts feed the per-account lockout; and a locked
     * account refuses authentication with 423 BEFORE any credential check.
     *
     * Stateless by design; the controller starts the session (SPA)
     * or issues a token (mobile) afterwards.
     *
     * @throws ValidationException
     */
    public function login(string $identifier, string $password): User
    {
        $identifier = Str::lower(trim($identifier));

        $user = User::query()
            ->where('email', $identifier)
            ->orWhere('username', $identifier)
            ->first();

        if (! $user) {
            // Unknown identifier: the failure is still audited (with no actor
            // — there is no account to attribute it to) but cannot count
            // toward any account's lockout.
            $this->audit->log(null, 'failed_login', User::class, [
                'identifier' => $identifier,
                'reason' => 'unknown_account',
            ]);

            throw ValidationException::withMessages([
                'identifier' => __('These credentials do not match our records.'),
            ]);
        }

        // Item 2: refuse BEFORE checking credentials, so a locked account
        // gives no oracle about password correctness during the cooldown.
        $this->lockout->assertNotLocked($user);

        if (! Hash::check($password, $user->password)) {
            $this->lockout->recordFailure($user);

            $this->audit->log($user, 'failed_login', User::class, [
                'reason' => 'bad_password',
            ]);

            throw ValidationException::withMessages([
                'identifier' => __('These credentials do not match our records.'),
            ]);
        }

        $this->lockout->clear($user);

        $this->audit->log($user, 'login', User::class);

        return $user;
    }

    /**
     * Issue a personal access token for the user (mobile clients).
     *
     * Item 1: every token carries an absolute `expires_at` (config
     * security.token_absolute); the idle window is enforced on every request
     * by IdleExpiringGuard. Audited as token_issued so the log shows device
     * sessions an account holds.
     */
    public function issueToken(User $user, string $deviceName): string
    {
        $expiresAt = now()->addMinutes(max(1, (int) config('security.token_absolute', 10080)));

        $token = $user->createToken($deviceName, ['*'], $expiresAt)->plainTextToken;

        $this->audit->log($user, 'token_issued', User::class, [
            'device_name' => $deviceName,
        ]);

        return $token;
    }

    /**
     * Revoke the current access token (if any) or log out the session.
     */
    public function logout(User $user, bool $hasSession): void
    {
        if ($user->currentAccessToken() instanceof PersonalAccessToken) {
            $user->currentAccessToken()->delete();

            $this->audit->log($user, 'logout', User::class, ['scope' => 'token']);

            return;
        }

        if ($hasSession) {
            Auth::guard('web')->logout();

            $this->audit->log($user, 'logout', User::class, ['scope' => 'session']);
        }
    }

    /**
     * "Log me out everywhere": revoke every personal access token and every
     * cookie session the account holds (item 1).
     *
     * Used by the dedicated logout-all endpoint AND automatically after a
     * password change or reset, so a stolen session/token does not survive a
     * credential change.
     *
     * @return int The number of tokens revoked (sessions are rows in the
     *             `sessions` table; they are deleted, not counted).
     */
    public function logoutEverywhere(User $user): int
    {
        $revoked = $user->tokens()->delete();

        // Cookie sessions: the database session driver stores rows keyed by
        // session id with a user_id column (see the sessions migration).
        DB::table(config('session.table', 'sessions'))
            ->where('user_id', $user->id)
            ->delete();

        return (int) $revoked;
    }

    /**
     * Invalidate every OTHER session/token, keeping the caller's own alive
     * (item 1: password change). The device that just presented the current
     * password stays signed in; a stolen session on some other device does
     * not. Sanctum's AuthenticateSession middleware independently kills even
     * the current cookie session on password change — belt and braces.
     */
    public function revokeOtherSessions(User $user, ?string $currentSessionId, ?PersonalAccessToken $currentToken): void
    {
        $sessionQuery = DB::table(config('session.table', 'sessions'))
            ->where('user_id', $user->id);

        if ($currentSessionId !== null) {
            $sessionQuery->where('id', '!=', $currentSessionId);
        }

        $sessionQuery->delete();

        $tokenQuery = $user->tokens();

        if ($currentToken !== null) {
            $tokenQuery->where('id', '!=', $currentToken->id);
        }

        $tokenQuery->delete();
    }
}
