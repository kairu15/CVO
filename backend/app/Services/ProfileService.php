<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\User;
use App\Support\ImageSanitizer;
use Carbon\Carbon;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * The authenticated user's own profile — read and write.
 *
 * Everything keys off the User instance handed in by the controller
 * ($request->user()); no lookup-by-id exists here, so the surface is
 * structurally self-scoped.
 */
class ProfileService
{
    /**
     * The profile payload: the account plus one role-specific section.
     *
     * @return array<string, mixed>
     */
    public function profile(User $user): array
    {
        $data = [
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'username' => $user->username,
                'email' => $user->email,
                'phone' => $user->phone,
                'address' => $user->address,
                'role' => $user->role,
                'status' => $user->deleted_at === null ? 'active' : 'deactivated',
                'avatar_url' => $user->avatar_url,
                'last_login_at' => $user->last_login_at?->toIso8601String(),
                'created_at' => $user->created_at?->toIso8601String(),
            ],
        ];

        if ($user->role === 'technician') {
            // The technician role carries the field work AND the clinical
            // record-keeping, so its profile shows both footprints.
            $data['technician'] = [
                'assigned_farmers' => $user->assignedBeneficiaries()->count(),
            ];

            // No credential/license field exists in the data model — show the
            // clinical footprint the system does track instead.
            $data['clinical'] = [
                'health_records_count' => $user->authoredHealthRecords()->count(),
                'case_notes_count' => $user->authoredCaseNotes()->count(),
            ];
        }

        return $data;
    }

    /**
     * Update the signed-in account's profile (name, email and personal
     * contact details). Role and username are deliberately not accepted.
     *
     * There is no household location to edit here: beneficiaries are program
     * records managed by staff, not things an account owns — the admin
     * Beneficiaries screen is where a household's location is corrected.
     *
     * @param  array<string, mixed>  $validated  output of UpdateProfileRequest::validated()
     */
    public function update(User $user, array $validated): array
    {
        return DB::transaction(function () use ($user, $validated): array {
            $account = collect($validated)->only(['name', 'email', 'phone', 'address'])->all();

            if ($account !== []) {
                $user->fill($account)->save();
            }

            return $this->profile($user->refresh());
        });
    }

    /**
     * Security information for the caller's own account: last sign-in,
     * active browser/mobile sessions, and a short account-activity history.
     * Session payloads are never returned; browser session ids are hashed, and
     * only the caller's own rows are queried.
     *
     * @return array<string, mixed>
     */
    public function security(
        User $user,
        ?string $currentSessionId = null,
        ?PersonalAccessToken $currentToken = null,
    ): array {
        // The sessions table is present for every deployment (the migration
        // ships with the app). Reading it directly is safe even when a
        // different driver is configured, and it keeps browser sessions
        // visible instead of silently reporting only mobile tokens.
        $sessions = DB::table(config('session.table', 'sessions'))
            ->where('user_id', $user->id)
            ->orderByDesc('last_activity')
            ->limit(20)
            ->get()
            ->map(fn ($session): array => [
                'key' => hash('sha256', 'browser:'.$session->id),
                'kind' => 'browser',
                'device' => $this->deviceLabel($session->user_agent),
                'ip_address' => $session->ip_address,
                'last_active' => Carbon::createFromTimestamp((int) $session->last_activity)->toIso8601String(),
                'current' => $currentSessionId !== null
                    && hash_equals((string) $currentSessionId, (string) $session->id),
            ]);

        $tokens = $user->tokens()
            ->orderByDesc('last_used_at')
            ->limit(20)
            ->get(['id', 'name', 'last_used_at', 'created_at', 'expires_at'])
            ->map(fn (PersonalAccessToken $token): array => [
                'key' => hash('sha256', 'token:'.$token->id),
                'kind' => 'mobile',
                'device' => $token->name ?: 'Mobile device',
                'ip_address' => null,
                'last_active' => ($token->last_used_at ?? $token->created_at)?->toIso8601String(),
                'current' => $currentToken !== null && (int) $currentToken->id === (int) $token->id,
            ]);

        $activity = ActivityLog::query()
            ->where('actor_id', $user->id)
            ->whereIn('action', [
                'login', 'token_issued', 'logout', 'logout_all',
                'password_changed', 'sessions_revoked', 'failed_login',
            ])
            ->latest('created_at')
            ->limit(6)
            ->get(['id', 'action', 'ip_address', 'created_at'])
            ->map(fn (ActivityLog $log): array => [
                'id' => $log->id,
                'action' => $log->action,
                'label' => $this->activityLabel($log->action),
                'ip_address' => $log->ip_address,
                'created_at' => $log->created_at?->toIso8601String(),
            ]);

        return [
            'last_login_at' => $user->last_login_at?->toIso8601String(),
            'status' => $user->deleted_at === null ? 'active' : 'deactivated',
            'sessions' => $sessions->concat($tokens)
                ->sortByDesc('last_active')
                ->values()
                ->all(),
            'recent_activity' => $activity->all(),
        ];
    }

    /** A readable device name from a user agent without adding a parser dependency. */
    private function deviceLabel(?string $userAgent): string
    {
        $agent = Str::lower((string) $userAgent);

        return match (true) {
            str_contains($agent, 'iphone') => 'iPhone browser',
            str_contains($agent, 'ipad') => 'iPad browser',
            str_contains($agent, 'android') => 'Android browser',
            str_contains($agent, 'edg/') => 'Microsoft Edge',
            str_contains($agent, 'chrome/') => 'Chrome browser',
            str_contains($agent, 'firefox/') => 'Firefox browser',
            str_contains($agent, 'safari/') => 'Safari browser',
            $userAgent !== null && $userAgent !== '' => Str::limit($userAgent, 60),
            default => 'Unknown browser',
        };
    }

    private function activityLabel(string $action): string
    {
        return match ($action) {
            'login' => 'Signed in',
            'token_issued' => 'Mobile sign-in',
            'logout' => 'Signed out',
            'logout_all' => 'Signed out everywhere',
            'password_changed' => 'Password changed',
            'sessions_revoked' => 'Other sessions revoked',
            'failed_login' => 'Failed sign-in attempt',
            default => Str::headline(str_replace('_', ' ', $action)),
        };
    }

    /**
     * Replace the profile photo (item 8): EXIF stripped, stored under a
     * server-generated name on the PRIVATE disk; the previous file (if any)
     * is deleted so avatars don't accumulate — one account, one current
     * photo. Served via short-lived signed URLs through the user resource.
     */
    public function updateAvatar(User $user, UploadedFile $file): array
    {
        $sanitized = ImageSanitizer::sanitizeToUpload($file);

        $path = ImageSanitizer::storeImage($sanitized, "avatars/{$user->id}");

        if ($user->avatar_path) {
            Storage::disk('secure')->delete($user->avatar_path);
        }

        $user->fill(['avatar_path' => $path])->save();

        return $this->profile($user->refresh());
    }

    public function deleteAvatar(User $user): array
    {
        if ($user->avatar_path) {
            Storage::disk('secure')->delete($user->avatar_path);
            $user->fill(['avatar_path' => null])->save();
        }

        return $this->profile($user->refresh());
    }

}
