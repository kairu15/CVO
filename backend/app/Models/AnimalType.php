<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One animal type in the CVO master list (e.g. "Swine (Pig)").
 *
 * Types are grouped by a coarse `main_category` (livestock, poultry, other
 * farm animals) for PRESENTATION only — the registration form uses it for the
 * grouped dropdown, nothing filters on it. Every filter, report and export
 * keys off the specific type, which is what the office actually records.
 */
class AnimalType extends Model
{
    use Auditable;

    /** @var list<string> */
    public const MAIN_CATEGORIES = ['livestock', 'poultry', 'other'];

    /** Human labels for the category keys, in display order. */
    public const CATEGORY_LABELS = [
        'livestock' => 'Livestock',
        'poultry' => 'Poultry',
        'other' => 'Other Farm Animals',
    ];

    protected $fillable = ['main_category', 'name', 'sort_order'];

    protected function casts(): array
    {
        return [
            'main_category' => 'string',
            'sort_order' => 'integer',
        ];
    }

    /** The classifications recorded under this type, in the office's order. */
    public function classifications(): HasMany
    {
        return $this->hasMany(AnimalClassification::class)->orderBy('sort_order')->orderBy('id');
    }

    /**
     * The catalogue order: category, then the type order the office set.
     *
     * A CASE expression rather than alphabetical by category, so "Other Farm
     * Animals" stays last even though its key sorts first alphabetically.
     */
    public function scopeOrdered(Builder $query): Builder
    {
        return $query
            ->orderByRaw(
                'case main_category when ? then 0 when ? then 1 when ? then 2 else 3 end',
                array_keys(self::CATEGORY_LABELS),
            )
            ->orderBy('sort_order')
            ->orderBy('id');
    }

    /** The display label for this type's main category. */
    public function categoryLabel(): string
    {
        return self::CATEGORY_LABELS[$this->main_category] ?? $this->main_category;
    }
}
