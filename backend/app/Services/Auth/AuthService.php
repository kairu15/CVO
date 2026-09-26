<?php

namespace App\Services\Auth;

use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

class AuthService
{
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
                $beneficiary = $user->beneficiaries()->create([
                    'name_of_farmer' => ($dispersal['name_of_farmer'] ?? '') !== '' ? $dispersal['name_of_farmer'] : $name,
                    'address' => $dispersal['address'] ?? '',
                    'barangay_id' => $dispersal['barangay_id'] ?? null,
                    'purok_id' => $dispersal['purok_id'] ?? null,
                    'animal_type' => $dispersal['animal_type'] ?? '',
                    'sex' => $dispersal['sex'] ?? 'F',
                    'latitude' => $dispersal['latitude'] ?? null,
                    'longitude' => $dispersal['longitude'] ?? null,
                    // How the location was captured — gps fix, moved map pin
                    // (or a confirmed suggestion), or a manual dropdown
                    // choice. Staff use it to judge coordinate quality.
                    'location_source' => $dispersal['location_source'] ?? 'manual',
                ]);

                // The registration IS the first monitoring entry: the admin
                // sees the new farmer on the Monitoring table immediately,
                // flagged `new`, without waiting for a technician visit.
                // Same transaction — a farmer account can never exist without
                // its record, and a retried/partial registration can never
                // create two. The countdown targets the upcoming midnight
                // (app timezone): accepted or not, the flag clears next day.
                $beneficiary->monitoringRecords()->create([
                    'technician_id' => null,
                    'registration_status' => MonitoringRecord::REGISTRATION_NEW,
                    'registered_at' => now(),
                    'status_expires_at' => now()->addDay()->startOfDay(),
                ]);
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
