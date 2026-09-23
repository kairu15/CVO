<?php

namespace App\Models;

use Database\Factories\DispersalEventFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DispersalEvent extends Model
{
    /** @use HasFactory<DispersalEventFactory> */
    use HasFactory;

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
    ];

    protected function casts(): array
    {
        return [
            'date_dispersed' => 'date',
        ];
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
