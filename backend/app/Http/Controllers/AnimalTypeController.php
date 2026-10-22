<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreAnimalClassificationRequest;
use App\Http\Requests\StoreAnimalTypeRequest;
use App\Http\Requests\UpdateAnimalClassificationRequest;
use App\Http\Requests\UpdateAnimalTypeRequest;
use App\Models\AnimalClassification;
use App\Models\AnimalType;
use App\Models\Beneficiary;
use App\Services\AnimalTypeCatalog;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The CVO animal master list — two levels, one vocabulary.
 *
 * Read (`GET /animal-types`) is authenticated but not administrator-only: the
 * registration form, the monitoring filter and the settings screen all read
 * the same list, and every role that may record or view an animal needs it.
 *
 * Writes live under the admin prefix and `manage_reference_data` (the same
 * capability that guards barangays/puroks). They are real CRUD rather than a
 * fixed seed because the office must be able to add a species the shipped list
 * did not anticipate — that is the whole reason this is a table.
 *
 * Deletion is refused while rows still reference the entry: the FKs null out
 * on delete, and silently erasing the type from historical animals is exactly
 * the data loss the migration report was written to avoid.
 */
class AnimalTypeController extends Controller
{
    public function __construct(
        private readonly AnimalTypeCatalog $catalog,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * The whole master list grouped by main category:
     *
     *     [{key, label, animal_types: [{id, name, main_category, classifications: [...]}]}]
     */
    public function index(): JsonResponse
    {
        return response()->json(['data' => $this->catalog->grouped()]);
    }

    public function store(StoreAnimalTypeRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $type = AnimalType::create([
            'main_category' => $validated['main_category'],
            'name' => $validated['name'],
            'sort_order' => $validated['sort_order']
                ?? ((int) AnimalType::query()->where('main_category', $validated['main_category'])->max('sort_order')) + 1,
        ]);

        $this->audit->log($request->user(), 'animal_type_created', $type, [
            'name' => $type->name,
            'main_category' => $type->main_category,
        ]);

        return $this->typeResponse($type->fresh(['classifications']), Response::HTTP_CREATED);
    }

    public function update(UpdateAnimalTypeRequest $request, AnimalType $animalType): JsonResponse
    {
        $animalType->update($request->validated());

        $this->audit->log($request->user(), 'animal_type_updated', $animalType, [
            'name' => $animalType->name,
        ]);

        return $this->typeResponse($animalType->fresh(['classifications']));
    }

    public function destroy(Request $request, AnimalType $animalType): JsonResponse
    {
        if ($this->inUse($animalType)) {
            return response()->json([
                'message' => "{$animalType->name} is still recorded on animals and cannot be removed. Reclassify those records first.",
            ], Response::HTTP_UNPROCESSABLE_ENTITY);
        }

        $name = $animalType->name;
        $animalType->delete();

        $this->audit->log($request->user(), 'animal_type_deleted', null, ['name' => $name]);

        return response()->json([], Response::HTTP_NO_CONTENT);
    }

    public function storeClassification(StoreAnimalClassificationRequest $request, AnimalType $animalType): JsonResponse
    {
        $validated = $request->validated();

        $classification = $animalType->classifications()->create([
            'name' => $validated['name'],
            'sort_order' => $validated['sort_order']
                ?? ((int) $animalType->classifications()->max('sort_order')) + 1,
        ]);

        $this->audit->log($request->user(), 'animal_classification_created', $classification, [
            'animal_type' => $animalType->name,
            'name' => $classification->name,
        ]);

        return $this->classificationResponse($classification, Response::HTTP_CREATED);
    }

    public function updateClassification(
        UpdateAnimalClassificationRequest $request,
        AnimalClassification $animalClassification,
    ): JsonResponse {
        $animalClassification->update($request->validated());

        $this->audit->log($request->user(), 'animal_classification_updated', $animalClassification, [
            'name' => $animalClassification->name,
        ]);

        return $this->classificationResponse($animalClassification->fresh());
    }

    public function destroyClassification(Request $request, AnimalClassification $animalClassification): JsonResponse
    {
        $inUse = Beneficiary::query()
            ->where('classification_id', $animalClassification->id)
            ->exists();

        if ($inUse) {
            return response()->json([
                'message' => "{$animalClassification->name} is still recorded on animals and cannot be removed.",
            ], Response::HTTP_UNPROCESSABLE_ENTITY);
        }

        $name = $animalClassification->name;
        $animalClassification->delete();

        $this->audit->log($request->user(), 'animal_classification_deleted', null, ['name' => $name]);

        return response()->json([], Response::HTTP_NO_CONTENT);
    }

    /** Whether any animal record still points at this type (or its children). */
    private function inUse(AnimalType $type): bool
    {
        return Beneficiary::query()
            ->where('animal_type_id', $type->id)
            ->exists()
            || Beneficiary::query()
                ->whereIn('classification_id', $type->classifications()->select('id'))
                ->exists();
    }

    private function typeResponse(AnimalType $type, int $status = Response::HTTP_OK): JsonResponse
    {
        $type->load('classifications');

        return response()->json(['data' => $this->catalog->serializeType($type)], $status);
    }

    private function classificationResponse(AnimalClassification $classification, int $status = Response::HTTP_OK): JsonResponse
    {
        return response()->json([
            'data' => [
                'id' => $classification->id,
                'animal_type_id' => $classification->animal_type_id,
                'name' => $classification->name,
                'sort_order' => $classification->sort_order,
            ],
        ], $status);
    }
}
