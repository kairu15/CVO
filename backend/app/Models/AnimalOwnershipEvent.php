<?php

namespace App\Models;

use Database\Factories\AnimalOwnershipEventFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One append-only link in an animal's ownership chain, and the single source
 * of truth the flight path is drawn from.
 *
 * The row is immutable once written: `booted()` reverts any later write to the
 * descriptive columns, so the only mutation the application can make is to
 * VOID it (status + voided_by/at/reason). A mistaken record is corrected by
 * voiding it and letting the chain be recomputed from the rows that remain.
 *
 * @property int $id
 * @property int $animal_id
 * @property string $event_type
 * @property int|null $from_beneficiary_id
 * @property int|null $to_beneficiary_id
 * @property Carbon $event_date
 * @property bool $date_is_estimated
 * @property string|null $location_source
 * @property string $status
 */
class AnimalOwnershipEvent extends Model
{
    /** @use HasFactory<AnimalOwnershipEventFactory> */
    use HasFactory;

    /** The first event of a chain: CVO → beneficiary. */
    public const TYPE_DISPERSAL = 'dispersal';

    /** The same animal moving to another beneficiary. */
    public const TYPE_RE_DISPERSAL = 're_dispersal';

    /** An offspring animal moving to a beneficiary. */
    public const TYPE_PASS_ON = 'pass_on';

    /** A beneficiary handing the animal back to CVO (`to` is null). */
    public const TYPE_RETURN = 'return';

    /** @var list<string> */
    public const TYPES = [self::TYPE_DISPERSAL, self::TYPE_RE_DISPERSAL, self::TYPE_PASS_ON, self::TYPE_RETURN];

    public const STATUS_ACTIVE = 'active';

    public const STATUS_VOIDED = 'voided';

    /** Where a handover location came from, from most to least trustworthy. */
    public const SOURCES = ['device_gps', 'manual_pin', 'owner_geotag', 'barangay_centroid'];

    /**
     * Columns that describe WHAT happened. Frozen after insert — only the
     * void columns may change.
     *
     * @var list<string>
     */
    private const IMMUTABLE_FIELDS = [
        'animal_id',
        'event_type',
        'from_beneficiary_id',
        'to_beneficiary_id',
        'event_date',
        'date_is_estimated',
        'latitude',
        'longitude',
        'location_source',
        'accuracy_m',
        'remarks',
        'recorded_by',
    ];

    protected $fillable = [
        'animal_id',
        'event_type',
        'from_beneficiary_id',
        'to_beneficiary_id',
        'event_date',
        'date_is_estimated',
        'latitude',
        'longitude',
        'location_source',
        'accuracy_m',
        'remarks',
        'recorded_by',
        'status',
        'voided_by',
        'voided_at',
        'void_reason',
    ];

    protected function casts(): array
    {
        return [
            'event_date' => 'date',
            'date_is_estimated' => 'boolean',
            'latitude' => 'float',
            'longitude' => 'float',
            'accuracy_m' => 'float',
            'voided_at' => 'datetime',
        ];
    }

    /**
     * Append-only guard. A model write can only ever void the row; the
     * descriptive columns are silently reverted to their stored values, the
     * same way DispersalEvent protects a captured signature.
     */
    protected static function booted(): void
    {
        static::saving(function (self $event): void {
            if (! $event->exists) {
                return;
            }

            foreach (self::IMMUTABLE_FIELDS as $field) {
                if ($event->isDirty($field)) {
                    $event->{$field} = $event->getOriginal($field);
                }
            }
        });

        // There is no delete path: history is voided, never erased.
        static::deleting(fn (): bool => false);
    }

    public function animal(): BelongsTo
    {
        return $this->belongsTo(Animal::class);
    }

    /** The household handing the animal over; null when the source is CVO. */
    public function fromBeneficiary(): BelongsTo
    {
        return $this->belongsTo(Beneficiary::class, 'from_beneficiary_id')->withTrashed();
    }

    /** The household receiving the animal; null on a return to CVO. */
    public function toBeneficiary(): BelongsTo
    {
        return $this->belongsTo(Beneficiary::class, 'to_beneficiary_id')->withTrashed();
    }

    public function recordedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }

    public function voidedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'voided_by');
    }

    public function isVoided(): bool
    {
        return $this->status === self::STATUS_VOIDED;
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('status', self::STATUS_ACTIVE);
    }

    /** Oldest first, stable on equal dates. */
    public function scopeChronological(Builder $query): Builder
    {
        return $query->orderBy('event_date')->orderBy('id');
    }

    /** Human label for the event type, for audit context and messages. */
    public function typeLabel(): string
    {
        return match ($this->event_type) {
            self::TYPE_DISPERSAL => 'dispersal',
            self::TYPE_RE_DISPERSAL => 're-dispersal',
            self::TYPE_PASS_ON => 'pass on',
            self::TYPE_RETURN => 'return',
            default => $this->event_type,
        };
    }
}
