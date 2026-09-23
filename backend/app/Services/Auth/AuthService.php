<?php

namespace App\Services\Auth;

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
     * the same transaction — those four identity fields (name of farmer,
     * address, animal type, sex) are what every future monitoring record
     * auto-fills from, so they are captured exactly once, here.
     *
     * @param  array{name_of_farmer?: string, address?: string, animal_type?: string, sex?: string, latitude?: float|null, longitude?: float|null}|null  $dispersal
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
                $user->beneficiaries()->create([
                    'name_of_farmer' => ($dispersal['name_of_farmer'] ?? '') !== '' ? $dispersal['name_of_farmer'] : $name,
                    'address' => $dispersal['address'] ?? '',
                    'animal_type' => $dispersal['animal_type'] ?? '',
                    'sex' => $dispersal['sex'] ?? 'F',
                    'latitude' => $dispersal['latitude'] ?? null,
                    'longitude' => $dispersal['longitude'] ?? null,
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
