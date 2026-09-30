<?php

namespace App\Models;

use Database\Factories\SymptomRuleFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * One admin-editable rule behind the Rule-Based Health Concern Hints.
 *
 * A rule is a keyword list and a plain-language hint. When a doctor types a
 * case note or health record, the entry form matches the note against this
 * table (client-side, using the list served by the API) and shows the matching
 * hints inline. This is decision support, not a diagnosis, and nothing here
 * is a model or a learned value — it is a lookup the CVO's veterinarian owns.
 *
 * @property int $id
 * @property string $label
 * @property list<string> $keywords
 * @property string $hint
 * @property string|null $animal_type
 * @property bool $is_active
 * @property int $sort_order
 */
class SymptomRule extends Model
{
    /** @use HasFactory<SymptomRuleFactory> */
    use HasFactory;

    protected $fillable = [
        'label',
        'keywords',
        'hint',
        'animal_type',
        'is_active',
        'sort_order',
    ];

    protected function casts(): array
    {
        return [
            'keywords' => 'array',
            'is_active' => 'boolean',
            'sort_order' => 'integer',
        ];
    }

    /**
     * Rules offered on the entry forms, in display order.
     */
    public function scopeActive($query)
    {
        return $query->where('is_active', true)->orderBy('sort_order')->orderBy('id');
    }
}
