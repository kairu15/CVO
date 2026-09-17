<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'username', 'email', 'password', 'role'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, HasApiTokens, Notifiable;

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
            'password' => 'hashed',
        ];
    }

    public function projects(): HasMany
    {
        return $this->hasMany(Project::class);
    }

    /**
     * Dispersed animals registered under this account (always as the farmer).
     */
    public function beneficiaries(): HasMany
    {
        return $this->hasMany(Beneficiary::class, 'farmer_id');
    }

    /**
     * Beneficiaries this account is assigned to monitor (technician role).
     */
    public function assignedBeneficiaries(): HasMany
    {
        return $this->hasMany(Beneficiary::class, 'technician_id');
    }
}
