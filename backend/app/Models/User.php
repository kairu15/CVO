<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
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
    use HasFactory, HasApiTokens, Notifiable, SoftDeletes;

    /**
     * Every role the CVO system recognises.
     *
     * @var list<string>
     */
    public const ROLES = ['admin', 'doctor', 'technician', 'farmer'];

    /**
     * Roles an administrator must assign — these can never be self-registered.
     *
     * @var list<string>
     */
    public const STAFF_ROLES = ['admin', 'doctor', 'technician'];

    /**
     * The role granted to public self-registration.
     */
    public const DEFAULT_ROLE = 'farmer';

    /**
     * Attributes applied when a new model instance has none set.
     *
     * Keeps the application independent of the column default, which may
     * still read "member" on databases migrated from the starter template.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'role' => self::DEFAULT_ROLE,
    ];

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
     * trail). Null for self-registered farmers; withTrashed because the
     * creator may already be deactivated — the fact survives them.
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    public function projects(): HasMany
    {
        return $this->hasMany(Project::class);
    }

    public function isFarmer(): bool
    {
        return $this->role === self::DEFAULT_ROLE;
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
     * Dispersed animals registered under this account (always as the farmer).
     */
    public function beneficiaries(): HasMany
    {
        return $this->hasMany(Beneficiary::class, 'farmer_id');
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
