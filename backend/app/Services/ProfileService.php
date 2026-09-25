<?php

namespace App\Services;

use App\Models\User;
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

        if ($user->role === 'farmer') {
            // The household location twins live on the beneficiary records;
            // show them so the farmer can see (and correct) where monitoring
            // pinpoints them. Dispersal status is implied by the records.
            $data['farmer'] = [
                'beneficiaries' => $user->beneficiaries()
                    ->with(['barangay:id,name', 'purok:id,name'])
                    ->withCount('dispersalEvents')
                    ->get()
                    ->map(fn ($b) => [
                        'id' => $b->id,
                        'name_of_farmer' => $b->name_of_farmer,
                        'animal_type' => $b->animal_type,
                        'sex' => $b->sex,
                        'address' => $b->address,
                        'barangay' => $b->barangay?->only(['id', 'name']),
                        'purok' => $b->purok?->only(['id', 'name']),
                        'latitude' => $b->latitude,
                        'longitude' => $b->longitude,
                        'location_source' => $b->location_source,
                        'dispersal_events_count' => $b->dispersal_events_count,
                    ])->all(),
            ];
        } elseif ($user->role === 'technician') {
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
     * Update the account (name/email) and, for farmers, the household
     * location across their beneficiary records in one transaction.
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

            $location = collect($validated)
                ->only(['address', 'barangay_id', 'purok_id', 'latitude', 'longitude', 'location_source'])
                ->all();

            if ($location !== [] && $user->isFarmer()) {
                // One household, one location: the edit applies to every
                // beneficiary row the account owns, keeping barangay/purok
                // and the free-text address string in sync.
                $user->beneficiaries()->update($this->normalizeLocation($validated, $location));
            }

            return $this->profile($user->refresh());
        });
    }

    /**
     * Replace the profile photo. Stored on the public disk like field-visit
     * photos; the previous file (if any) is deleted so avatars don't
     * accumulate — one account, one current photo.
     */
    public function updateAvatar(User $user, UploadedFile $file): array
    {
        $path = $file->store("avatars/{$user->id}", 'public');

        if ($user->avatar_path) {
            Storage::disk('public')->delete($user->avatar_path);
        }

        $user->fill(['avatar_path' => $path])->save();

        return $this->profile($user->refresh());
    }

    public function deleteAvatar(User $user): array
    {
        if ($user->avatar_path) {
            Storage::disk('public')->delete($user->avatar_path);
            $user->fill(['avatar_path' => null])->save();
        }

        return $this->profile($user->refresh());
    }

    /**
     * Drop the barangay id (resolved in the request) alongside the payload
     * keys the beneficiary table actually has.
     *
     * @param  array<string, mixed>  $validated
     * @param  array<string, mixed>  $location
     * @return array<string, mixed>
     */
    private function normalizeLocation(array $validated, array $location): array
    {
        unset($location['barangay_id']);

        if (array_key_exists('address', $location)) {
            // Keep the barangay id column in step with the address string —
            // same pairing rule registration enforces.
            $location['barangay_id'] = $validated['barangay_id'];
        }

        return $location;
    }
}
