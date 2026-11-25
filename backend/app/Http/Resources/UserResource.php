<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    /**
     * Transform the resource into a JSON array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        // Presence is management-only information: it is withheld from roles
        // that cannot see the user list, so a technician's own /user payload
        // (and every public endpoint) is unchanged. The rule itself lives in
        // App\Support\Presence; this resource only reports it.
        $canSeePresence = $request->user()?->hasPermission('manage_users') ?? false;

        return [
            'id' => $this->id,
            'name' => $this->name,
            'username' => $this->username,
            'avatar_url' => $this->avatar_url,
            'email' => $this->email,
            'phone' => $this->phone,
            'address' => $this->address,
            'role' => $this->role,
            // The capability keys this account's role holds (the
            // role_permissions matrix). Lets the SPA hide what the server
            // would refuse anyway — never a substitute for the server check.
            'permissions' => $this->permissions(),
            // Deactivation IS the soft delete (see UserAccountService), so the
            // status the admin table shows is derived from `deleted_at`
            // rather than a second, drift-prone boolean column.
            'status' => $this->deleted_at === null ? 'active' : 'deactivated',
            'deactivated_at' => $this->deleted_at?->toIso8601String(),
            // Email verification is a separate axis from enabled/disabled:
            // `verified` | `pending` (link still valid) | `expired`. It is
            // what the Users table reads for Pending Verification / Active /
            // Verification Expired. Reported only to user managers and only
            // when the token was eager-loaded, so nested technician payloads
            // (a beneficiary's assignee, a record's author) do not turn into
            // an N+1 query or leak account state.
            'email_verified_at' => $this->when(
                $canSeePresence,
                fn () => $this->email_verified_at?->toIso8601String(),
            ),
            'verification_status' => $this->when(
                $canSeePresence && $this->relationLoaded('emailVerificationToken'),
                fn () => $this->verificationStatus(),
            ),
            'verification_expires_at' => $this->when(
                $canSeePresence
                    && $this->email_verified_at === null
                    && $this->relationLoaded('emailVerificationToken'),
                fn () => $this->emailVerificationToken?->expires_at?->toIso8601String(),
            ),
            // Account metadata for the management screen: the stamp every
            // successful sign-in rewrites, and the administrator who created
            // the account (null for seeded accounts, which have no creator).
            'last_login_at' => $this->last_login_at?->toIso8601String(),
            // Activity-based presence, NOT the account state above: an
            // enabled account nobody is using is `offline`, not "inactive".
            // Account status stays in `status` so a deactivated account is
            // still reported as deactivated, never as merely offline.
            'presence' => $this->when(
                $canSeePresence,
                fn () => $this->isOnline() ? 'online' : 'offline',
            ),
            'last_seen_at' => $this->when(
                $canSeePresence,
                fn () => $this->last_seen_at?->toIso8601String(),
            ),
            'created_by' => $this->created_by,
            'created_by_name' => $this->whenLoaded('creator', fn () => $this->creator?->name),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
