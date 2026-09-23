<?php

namespace App\Http\Controllers;

use App\Http\Requests\VaccinationScheduleRequest;
use App\Http\Resources\VaccinationScheduleResource;
use App\Services\VaccinationScheduleService;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Read-only vaccination schedule derived from recorded vaccinations.
 *
 * No store/update/destroy: this endpoint reports a computed due date, and the
 * underlying fact it derives from (a vaccination happening) is recorded as a
 * monitoring record.
 */
class VaccinationScheduleController extends Controller
{
    public function __construct(private readonly VaccinationScheduleService $schedule) {}

    public function index(VaccinationScheduleRequest $request): AnonymousResourceCollection
    {
        $validated = $request->validated();

        return VaccinationScheduleResource::collection(
            $this->schedule->listFor(
                $request->user(),
                $validated['status'] ?? null,
                (int) ($validated['per_page'] ?? 15),
            ),
        );
    }
}
