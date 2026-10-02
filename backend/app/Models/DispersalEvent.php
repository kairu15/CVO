<?php

namespace App\Models;

use Database\Factories\DispersalEventFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class DispersalEvent extends Model
{
    /** @use HasFactory<DispersalEventFactory> */
    use HasFactory, SoftDeletes;

    public const TYPE_INITIAL = 'initial';

    public const TYPE_RE_DISPERSAL = 're-dispersal';

    /**
     * @var list<string>
     */
    public const TYPES = [self::TYPE_INITIAL, self::TYPE_RE_DISPERSAL];

    protected $fillable = [
        'beneficiary_id',
        'parent_beneficiary_id',
        'new_beneficiary_id',
        'dispersal_type',
        'date_dispersed',
        'remarks',
        'signature_path',
        'signature_captured_by',
        'signature_captured_at',
    ];

    protected function casts(): array
    {
        return [
            'date_dispersed' => 'date',
            'signature_captured_at' => 'datetime',
        ];
    }

    /**
     * A signature on a dispersal is an audit record, not editable data.
     *
     * Once an event has a signature, this guard reverts any later write to
     * `signature_path` (or its captured_by/at provenance). The only legitimate
     * correction is to record a NEW dispersal event, so the original agreement
     * stays intact in the history.
     */
    protected static function booted(): void
    {
        static::saving(function (DispersalEvent $event): void {
            if (! $event->exists || $event->getOriginal('signature_path') === null) {
                return; // first capture on a fresh event
            }

            foreach (['signature_path', 'signature_captured_by', 'signature_captured_at'] as $field) {
                if ($event->isDirty($field)) {
                    $event->{$field} = $event->getOriginal($field);
                }
            }
        });
    }

    /** Whether a signed agreement is on record for this dispersal. */
    public function hasSignature(): bool
    {
        return $this->signature_path !== null;
    }

    /**
     * The user who captured the signature, if still on record.
     */
    public function signatureCapturedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'signature_captured_by');
    }

    /**
     * The beneficiary whose animal was dispersed (source of the offspring on
     * a re-dispersal; the recipient household of an initial dispersal).
     */
    public function beneficiary(): BelongsTo
    {
        return $this->belongsTo(Beneficiary::class);
    }

    /**
     * The beneficiary whose animal produced this offspring — null for
     * initial dispersals.
     */
    public function parentBeneficiary(): BelongsTo
    {
        return $this->belongsTo(Beneficiary::class, 'parent_beneficiary_id');
    }

    /**
     * A newly registered beneficiary created to receive the offspring, if the
     * re-dispersal registered one.
     */
    public function newBeneficiary(): BelongsTo
    {
        return $this->belongsTo(Beneficiary::class, 'new_beneficiary_id');
    }
}
