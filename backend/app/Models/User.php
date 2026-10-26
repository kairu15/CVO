<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'username', 'email', 'password', 'role', 'avatar_path', 'created_by'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, HasApiTokens, Notifiable, SoftDeletes, Auditable;

    /**
     * Accounts have bespoke action names for the moments the trail singles
     * out (an invite is not a plain create; a role change is an update; the
     * deactivate/reactivate pair maps to soft delete/restore), so the trait's
     * generic resolution is overridden here.
     */
    protected function auditActionFor(string $event, array $oldValues, array $newValues): ?string
    {
        if ($event === 'updated'
            && ($oldValues['role'] ?? null) !== ($newValues['role'] ?? null)) {
            return 'role_changed';
        }

        return match ($event) {
            'deleted' => 'user_deactivated',
            'restored' => 'user_reactivated',
            default => $this->resolveAuditAction($event, $oldValues, $newValues),
        };
    }

    /**
     * The account-activity modal reads previous/new role straight off the
     * row, exactly as it did when the service wrote them by hand.
     *
     * @param  array<string, mixed>  $oldValues
     * @param  array<string, mixed>  $newValues
     * @return array<string, mixed>
     */
    protected function auditContextFor(string $event, array $oldValues, array $newValues): array
    {
        if ($event === 'updated'
            && ($oldValues['role'] ?? null) !== ($newValues['role'] ?? null)) {
            return [
                'previous_role' => $oldValues['role'] ?? null,
                'new_role' => $newValues['role'] ?? null,
            ];
        }

        if ($event === 'created') {
            return ['role' => $this->role];
        }

        return [];
    }

    /**
     * Every role the CVO system recognises.
     *
     * There is no `farmer` role: beneficiaries are program records the admin
     * manages, not login accounts. Every account is a staff account, created
     * by an administrator — new rows always carry an explicit role, so there
     * is deliberately no default.
     *
     * @var list<string>
     */
    public const ROLES = ['admin', 'doctor', 'technician'];

    /**
     * Roles an administrator may assign from the User Management screen.
     *
     * @var list<string>
     */
    public const STAFF_ROLES = ['admin', 'doctor', 'technician'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    /**
     * The administrator who created this account (User Management's invite
     * trail). Null for seeded accounts and any row predating the trail;
     * withTrashed because the creator may already be deactivated — the fact
     * survives them.
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    public function projects(): HasMany
    {
        return $this->hasMany(Project::class);
    }

    /**
     * The permission keys granted to this account's role.
     *
     * @return list<string>
     */
    public function permissions(): array
    {
        return Permission::keysForRole($this->role);
    }

    /**
     * Whether this account's role holds a capability. The single gate the
     * Policies, middleware and FormRequests use — backed by the
     * role_permissions matrix an administrator edits, rather than role
     * string comparisons scattered through the code.
     *
     * Row-level SCOPE (all / assigned / own) is NOT decided here: a grant
     * says what a role may do in principle, the Policies still decide which
     * rows.
     */
    public function hasPermission(string $key): bool
    {
        return in_array($key, $this->permissions(), true);
    }

    /**
     * URL of the profile photo, or null when the account has none (the UI
     * falls back to initials).
     *
     * Item 8: avatars live on the private `secure` disk and are served
     * through short-lived signed URLs, not a guessable public path.
     * Root-relative (App\Support\SecureMedia) so the browser resolves them
     * against its own origin — the SPA may be reached through a tunnel or
     * staging domain where an APP_URL-absolute URL would never load.
     */
    protected function avatarUrl(): \Illuminate\Database\Eloquent\Casts\Attribute
    {
        return \Illuminate\Database\Eloquent\Casts\Attribute::get(
            fn () => $this->avatar_path !== null
                ? \App\Support\SecureMedia::temporaryUrl(
                    $this->avatar_path,
                    now()->addMinutes((int) config('security.signed_url_minutes', 30)),
                )
                : null,
        );
    }

    /**
     * Password reset links point at the SPA's reset page, which completes
     * the flow via POST /api/v1/reset-password (item 3). The emailed URL
     * carries the raw token once; the broker stores only its hash.
     */
    public function sendPasswordResetNotification($token): void
    {
        $this->notify(new \Illuminate\Auth\Notifications\ResetPassword($token));
    }

    /**
     * Beneficiaries this account is assigned to monitor (technician role).
     */
    public function assignedBeneficiaries(): HasMany
    {
        return $this->hasMany(Beneficiary::class, 'technician_id');
    }

    /**
     * Clinical health records this account authored (doctor role).
     */
    public function authoredHealthRecords(): HasMany
    {
        return $this->hasMany(HealthRecord::class, 'doctor_id');
    }

    /**
     * Case notes this account wrote (doctor role).
     */
    public function authoredCaseNotes(): HasMany
    {
        return $this->hasMany(CaseNote::class, 'doctor_id');
    }
}
