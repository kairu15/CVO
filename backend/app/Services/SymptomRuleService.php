<?php

namespace App\Services;

use App\Models\SymptomRule;
use Illuminate\Database\Eloquent\Collection;

/**
 * Rule-Based Health Concern Hints — the admin-editable lookup the entry forms
 * match against.
 *
 * Kept deliberately thin: the rules are reference data an administrator owns,
 * so this service normalizes what the admin types (keywords trimmed, blank
 * entries dropped, duplicates removed) and otherwise just persists it. There
 * is no matching logic here — matching runs CLIENT-side against the list this
 * API serves, so typing a note never waits on a request.
 *
 * Nothing in this module is a model, a diagnosis or a learned value. It is a
 * keyword lookup, and the UI says so.
 */
class SymptomRuleService
{
    /**
     * The rules the entry forms should offer: active only, in display order.
     *
     * @return Collection<int, SymptomRule>
     */
    public function active(): Collection
    {
        return SymptomRule::query()->active()->get();
    }

    /**
     * Every rule, including retired ones — the admin editor needs to show and
     * re-activate them.
     *
     * @return Collection<int, SymptomRule>
     */
    public function all(): Collection
    {
        return SymptomRule::query()
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function create(array $data): SymptomRule
    {
        return SymptomRule::create($this->normalize($data));
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function update(SymptomRule $rule, array $data): SymptomRule
    {
        $rule->update($this->normalize($data));

        return $rule->refresh();
    }

    public function delete(SymptomRule $rule): void
    {
        $rule->delete();
    }

    /**
     * Clean up the admin's input before it is stored.
     *
     * Keywords arrive as a list of strings (one synonym per entry). Trimming
     * and de-duplicating here means the matcher never has to worry about a
     * blank or repeated term, and the stored rule reads cleanly in the editor.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function normalize(array $data): array
    {
        if (array_key_exists('keywords', $data) && is_array($data['keywords'])) {
            $data['keywords'] = array_values(array_unique(array_filter(
                array_map(fn ($keyword) => is_string($keyword) ? trim($keyword) : $keyword, $data['keywords']),
                fn ($keyword) => $keyword !== '' && $keyword !== null,
            )));
        }

        if (array_key_exists('animal_type', $data) && $data['animal_type'] === '') {
            $data['animal_type'] = null;
        }

        return $data;
    }
}
