<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A health concern hint rule.
 *
 * Served whole (keywords included) because the entry forms match CLIENT-side:
 * the rule table is small reference data, so shipping it once and matching on
 * every keystroke beats a request per keystroke.
 */
class SymptomRuleResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'label' => $this->label,
            'keywords' => $this->keywords ?? [],
            'hint' => $this->hint,
            'animal_type' => $this->animal_type,
            'is_active' => $this->is_active,
            'sort_order' => $this->sort_order,
        ];
    }
}
