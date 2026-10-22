<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A classification within one animal type — "Boar", "Sow", "Gilt" under
 * Swine (Pig). Names repeat across types (Boar is also a Guinea pig class),
 * so a classification is always read through its type.
 */
class AnimalClassification extends Model
{
    protected $fillable = ['animal_type_id', 'name', 'sort_order'];

    protected function casts(): array
    {
        return [
            'animal_type_id' => 'integer',
            'sort_order' => 'integer',
        ];
    }

    public function animalType(): BelongsTo
    {
        return $this->belongsTo(AnimalType::class);
    }

    /** The office's order within a type. */
    public function scopeOrdered(Builder $query): Builder
    {
        return $query->orderBy('sort_order')->orderBy('id');
    }
}
