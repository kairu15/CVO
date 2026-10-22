<?php

namespace App\Services;

use App\Models\AnimalClassification;
use App\Models\AnimalType;
use App\Models\Beneficiary;
use Illuminate\Support\Collection;

/**
 * The animal master list, and the one place that decides what a loose legacy
 * value ("Swine", "CATTLE", "Boar") means.
 *
 * Two levels are kept apart on purpose: a TYPE is the species (Swine (Pig)),
 * a CLASSIFICATION is the sex/age class within it (Boar, Sow, Gilt). The old
 * sheets stored either in the same column, so the resolver tries both and says
 * how confident it is:
 *
 *   mapped     exactly one type (or one type + one classification) matches
 *   ambiguous  several types/classifications match — never guessed
 *   unmatched  nothing matches (a typo, a category, "Unspecified"/blank)
 *
 * Only `mapped` values are ever written automatically. The rest are listed by
 * `php artisan animal-types:mapping-report` for a human to correct.
 */
class AnimalTypeCatalog
{
    /** The whole catalogue with classifications, cached for this request. */
    private ?Collection $types = null;

    /**
     * The master list grouped for the cascading dropdown:
     *
     *     [['key' => 'livestock', 'label' => 'Livestock', 'animal_types' => [...]], ...]
     *
     * Empty categories are omitted; an admin who removes every type in one
     * should not get an empty header in the form.
     *
     * @return list<array<string, mixed>>
     */
    public function grouped(): array
    {
        $groups = [];

        foreach (AnimalType::CATEGORY_LABELS as $key => $label) {
            $types = $this->types()
                ->where('main_category', $key)
                ->map(fn (AnimalType $type): array => $this->serializeType($type))
                ->values()
                ->all();

            if ($types !== []) {
                $groups[] = ['key' => $key, 'label' => $label, 'animal_types' => $types];
            }
        }

        return $groups;
    }

    /** The catalogue payload for one type (used by the admin CRUD responses). */
    public function serializeType(AnimalType $type): array
    {
        $classifications = $type->classifications
            ->map(fn (AnimalClassification $classification): array => [
                'id' => $classification->id,
                'animal_type_id' => $classification->animal_type_id,
                'name' => $classification->name,
                'sort_order' => $classification->sort_order,
            ])
            ->values()
            ->all();

        return [
            'id' => $type->id,
            'main_category' => $type->main_category,
            'category_label' => $type->categoryLabel(),
            'name' => $type->name,
            'sort_order' => $type->sort_order,
            // The same list under both names: the SPA reads `classifications`,
            // while the table the office knows is `animal_classifications`.
            'classifications' => $classifications,
            'animal_classifications' => $classifications,
        ];
    }

    /**
     * The type a name refers to, or null when the name matches none or more
     * than one. Used wherever a legacy string arrives (an old API client, an
     * imported workbook) and only the type is needed.
     */
    public function resolveType(?string $value): ?AnimalType
    {
        $result = $this->resolve($value);

        return $result['status'] === 'mapped' ? $result['type'] : null;
    }

    /**
     * Resolve a loose value into a type and (when it clearly names one) a
     * classification.
     *
     * @return array{value: string, status: string, type: AnimalType|null, classification: AnimalClassification|null, candidates: list<string>}
     */
    public function resolve(?string $value): array
    {
        $raw = trim((string) preg_replace('/\s+/', ' ', (string) $value));
        $key = mb_strtolower($raw);

        if ($key === '' || $key === mb_strtolower(\App\Support\AnimalTypes::UNSPECIFIED)) {
            return $this->result($raw, 'empty');
        }

        // 1. A type name, exactly or as the short form before a parenthetical.
        $types = $this->types()->filter(function (AnimalType $type) use ($key): bool {
            $name = mb_strtolower($type->name);

            return $name === $key
                || (mb_strlen($key) >= 3 && str_starts_with($name, $key.' ('));
        });

        if ($types->count() > 1) {
            return $this->result($raw, 'ambiguous', null, null, $types->pluck('name')->all());
        }

        if ($types->count() === 1) {
            return $this->result($raw, 'mapped', $types->first());
        }

        // 2. A classification carries its type with it ("Rooster" → Chicken).
        $classifications = $this->types()
            ->flatMap(fn (AnimalType $type) => $type->classifications->map(
                fn (AnimalClassification $classification) => ['type' => $type, 'classification' => $classification],
            ))
            ->filter(fn (array $row): bool => mb_strtolower($row['classification']->name) === $key);

        if ($classifications->count() > 1) {
            return $this->result(
                $raw,
                'ambiguous',
                null,
                null,
                $classifications
                    ->map(fn (array $row): string => $row['classification']->name.' under '.$row['type']->name)
                    ->all(),
            );
        }

        if ($classifications->count() === 1) {
            $match = $classifications->first();

            return $this->result($raw, 'mapped', $match['type'], $match['classification']);
        }

        return $this->result($raw, 'unmatched');
    }

    /**
     * Normalise a submitted type/classification pair into beneficiary columns.
     *
     * Rules:
     *  - a type id wins over a type name;
     *  - a type name fills the id (and, when no name was submitted, the name
     *    column) so the legacy string and the FK never disagree;
     *  - changing the type without naming a classification clears the old one
     *    (a Boar under Swine is not a Boar under Goat);
     *  - a type that cannot be resolved leaves the FK null instead of guessing.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function applyPair(array $data, ?Beneficiary $existing = null): array
    {
        $typeProvided = array_key_exists('animal_type_id', $data)
            || array_key_exists('animal_type', $data);

        if (! $typeProvided) {
            return $data;
        }

        $type = isset($data['animal_type_id'])
            ? $this->types()->firstWhere('id', (int) $data['animal_type_id'])
            : $this->resolveType(isset($data['animal_type']) ? (string) $data['animal_type'] : null);

        if ($type === null) {
            $data['animal_type_id'] = null;

            // The pair must stay consistent: a classification without a
            // resolved type would point at a species the row no longer holds.
            if (array_key_exists('animal_type', $data) || array_key_exists('animal_type_id', $data)) {
                $data['classification_id'] = null;
            }

            return $data;
        }

        $data['animal_type_id'] = $type->id;

        // An id-only payload (the new form) still stores a display value; a
        // submitted name is kept exactly as it arrived so a legacy client's
        // "Carabao" does not silently become "Carabao (Water Buffalo)".
        if (! array_key_exists('animal_type', $data)
            || trim((string) $data['animal_type']) === '') {
            $data['animal_type'] = $type->name;
        }

        // Changing the type without re-picking a classification drops the old
        // pairing. An explicit classification_id (even null) is respected.
        if ($existing !== null
            && ! array_key_exists('classification_id', $data)
            && (int) $existing->animal_type_id !== (int) $type->id) {
            $data['classification_id'] = null;
        }

        return $data;
    }

    /**
     * Whether a classification belongs to a type — the single rule both
     * beneficiary requests and the admin CRUD enforce.
     */
    public function classificationBelongsTo(int $classificationId, ?int $typeId): bool
    {
        if ($typeId === null) {
            return false;
        }

        return AnimalClassification::query()
            ->whereKey($classificationId)
            ->where('animal_type_id', $typeId)
            ->exists();
    }

    /** @return Collection<int, AnimalType> */
    private function types(): Collection
    {
        return $this->types ??= AnimalType::query()
            ->with('classifications')
            ->ordered()
            ->get();
    }

    /**
     * @param  list<string>  $candidates
     * @return array{value: string, status: string, type: AnimalType|null, classification: AnimalClassification|null, candidates: list<string>}
     */
    private function result(
        string $value,
        string $status,
        ?AnimalType $type = null,
        ?AnimalClassification $classification = null,
        array $candidates = [],
    ): array {
        return [
            'value' => $value,
            'status' => $status,
            'type' => $type,
            'classification' => $classification,
            'candidates' => $candidates,
        ];
    }
}
