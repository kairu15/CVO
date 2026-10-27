<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Database\Factories\AnimalFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * One tagged animal with a single identity, which may move between owners.
 *
 * Distinct from `Beneficiary` on purpose: a beneficiary is a HOUSEHOLD, an
 * animal is the animal that household holds. The pass-on programme's older
 * model treated each new household as a new "animal"; this one keeps the
 * animal constant and records each handover in `animal_ownership_events`.
 *
 * `current_owner_id` is a denormalised mirror of the latest active event's
 * recipient. It is written only inside AnimalDispersalService, in the same
 * transaction as the event, and `php artisan ownership:verify` proves it has
 * not drifted.
 */
class Animal extends Model
{
    /** @use HasFactory<AnimalFactory> */
    use Auditable, HasFactory, SoftDeletes;

    /** Held by (or at) a beneficiary — eligible for a further handover. */
    public const STATUS_ACTIVE = 'active';

    /** Recorded dead — no further handovers. */
    public const STATUS_DECEASED = 'deceased';

    /** Handed back to CVO — `current_owner_id` is null and no new event may be added. */
    public const STATUS_RETURNED = 'returned';

    /** @var list<string> */
    public const STATUSES = [self::STATUS_ACTIVE, self::STATUS_DECEASED, self::STATUS_RETURNED];

    /** Audit action prefix: `animal_created`, not `animal_…` plural. */
    protected function auditKey(): string
    {
        return 'animal';
    }

    protected $fillable = [
        'ear_tag_number',
        'animal_type',
        'animal_type_id',
        'classification_id',
        'sex',
        'parent_animal_id',
        'current_owner_id',
        'status',
        // Set only by the `ownership:backfill` command: the household row this
        // animal was derived from in the older beneficiary pass-on model.
        'legacy_beneficiary_id',
    ];

    protected function casts(): array
    {
        return [
            'animal_type_id' => 'integer',
            'classification_id' => 'integer',
            'parent_animal_id' => 'integer',
            'current_owner_id' => 'integer',
            'legacy_beneficiary_id' => 'integer',
            'status' => 'string',
        ];
    }

    /** The master-list species this animal belongs to (null when unmapped). */
    public function animalType(): BelongsTo
    {
        return $this->belongsTo(AnimalType::class);
    }

    /** The sex/age class within the type (Boar, Sow, Gilt…). */
    public function animalClassification(): BelongsTo
    {
        return $this->belongsTo(AnimalClassification::class, 'classification_id');
    }

    /** The household that produced this animal, for a pass-on event. */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_animal_id');
    }

    /** Offspring passed on from this animal. */
    public function offspring(): HasMany
    {
        return $this->hasMany(self::class, 'parent_animal_id');
    }

    /**
     * The current holder. `withTrashed` because a soft-deleted household must
     * still render on a historical chain — the animal was genuinely there.
     */
    public function currentOwner(): BelongsTo
    {
        return $this->belongsTo(Beneficiary::class, 'current_owner_id')->withTrashed();
    }

    /** Every event in the animal's ownership chain (voided ones included). */
    public function ownershipEvents(): HasMany
    {
        return $this->hasMany(AnimalOwnershipEvent::class);
    }

    /** Only the events that still count toward the chain, oldest first. */
    public function activeOwnershipEvents(): HasMany
    {
        return $this->ownershipEvents()
            ->where('status', AnimalOwnershipEvent::STATUS_ACTIVE)
            ->orderBy('event_date')
            ->orderBy('id');
    }

    /** Whether a new handover may be recorded against this animal. */
    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE;
    }

    /** Display name of the animal's type, resolved or legacy. */
    public function typeName(): ?string
    {
        return $this->animalType?->name ?? $this->animal_type;
    }

    /** Animals whose chain touches a technician's assigned households. */
    public function scopeVisibleTo(Builder $query, int $technicianId): Builder
    {
        $assigned = Beneficiary::query()->where('technician_id', $technicianId)->select('id');

        return $query->where(function (Builder $q) use ($assigned): void {
            $q->whereIn('current_owner_id', $assigned)
                ->orWhereHas('ownershipEvents', function (Builder $e) use ($assigned): void {
                    $e->whereIn('from_beneficiary_id', $assigned)
                        ->orWhereIn('to_beneficiary_id', $assigned);
                });
        });
    }
}
