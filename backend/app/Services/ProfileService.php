<?php

namespace App\Services;

use App\Models\User;
use App\Support\ImageSanitizer;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

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
                'role' => $user->role,
                'avatar_url' => $user->avatar_url,
                'created_at' => $user->created_at?->toIso8601String(),
            ],
        ];

        if ($user->role === 'technician') {
            $data['technician'] = [
                'assigned_farmers' => $user->assignedBeneficiaries()->count(),
            ];
        } elseif ($user->role === 'doctor') {
            // No credential/license field exists in the data model — show the
            // clinical footprint the system does track instead.
            $data['doctor'] = [
                'health_records_count' => $user->authoredHealthRecords()->count(),
                'case_notes_count' => $user->authoredCaseNotes()->count(),
            ];
        }

        return $data;
    }

    /**
     * Update the signed-in account's profile (name/email).
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
            $account = collect($validated)->only(['name', 'email'])->all();

            if ($account !== []) {
                $user->fill($account)->save();
            }

            return $this->profile($user->refresh());
        });
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
