<?php

namespace App\Services\Auth;

use App\Models\MonitoringRecord;
use App\Models\User;
use App\Models\UserNotification;
use App\Services\NotificationService;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

class AuthService
{
    public function __construct(private readonly NotificationService $notifications)
    {
    }

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

        if (! $user || ! Hash::check($password, $user->password)) {
            throw ValidationException::withMessages([
                'identifier' => __('These credentials do not match our records.'),
            ]);
        }

        return $user;
    }

    /**
     * Issue a personal access token for the user (mobile clients).
     */
    public function issueToken(User $user, string $deviceName): string
    {
        return $user->createToken($deviceName)->plainTextToken;
    }

    /**
     * Revoke the current access token (if any) or log out the session.
     */
    public function logout(User $user, bool $hasSession): void
    {
        if ($user->currentAccessToken() instanceof PersonalAccessToken) {
            $user->currentAccessToken()->delete();

            return;
        }

        if ($hasSession) {
            Auth::guard('web')->logout();
        }
    }
}
