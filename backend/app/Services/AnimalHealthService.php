<?php

namespace App\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

/**
 * Animal Health Monitoring — a per-animal rollup over data that already exists.
 *
 * There is deliberately no `animal_health` table. By the time this module was
 * built the system already stored everything a monitoring view needs: visits
 * on `monitoring_records`, clinical events on `health_records`, observations on
 * `case_notes`, and vaccination status derived from the visit log. A fourth
 * storage of the same facts would not add information, it would add a second
 * version of it to disagree with.
 *
 * So this service only aggregates. Every column it returns is computed in one
 * query using correlated subqueries, which keeps a page of 15 animals at one
 * round trip instead of N+1.
 */
class AnimalHealthService
{
    public function __construct(private readonly BeneficiaryService $beneficiaries) {}

    /**
     * Role-scoped health rollup, most urgent first.
     *
     * @param bool $attentionOnly only animals with an overdue/absent vaccination
     *   or at least one open case
     */
    public function listFor(User $user, bool $attentionOnly = false, int $perPage = 15): LengthAwarePaginator
    {
        // Reused rather than rewritten: the last-vaccination expression has to
        // match the Vaccination Schedule exactly or the two screens would
        // disagree about the same animal.
        $lastVaccination = VaccinationScheduleService::lastVaccinationSql();

        $openOutcomes = array_values(config('cvo.health_open_outcomes'));
        $openPlaceholders = implode(',', array_fill(0, count($openOutcomes), '?'));

        // An open case is a clinical record with no outcome yet, or an outcome
        // that still means "being worked on".
        $openCases = "(select count(*) from health_records hr where hr.beneficiary_id = beneficiaries.id"
            ." and (hr.outcome is null or hr.outcome in ({$openPlaceholders})))";

        $query = $this->beneficiaries->scopeQueryFor($user)
            ->with(['technician', 'farmer'])
            ->select('beneficiaries.*')
            ->selectRaw("{$lastVaccination} as last_vaccination_date")
            // date() around every max() of a cast date column: the cast writes
            // `Y-m-d H:i:s`, which SQLite keeps verbatim, so a raw aggregate
            // would leak a time component into the API. See
            // VaccinationScheduleService::lastVaccinationSql().
            ->selectRaw(
                '(select date(max(mr.date_monitored)) from monitoring_records mr'
                .' where mr.beneficiary_id = beneficiaries.id) as last_visit_date',
            )
            ->selectRaw("{$openCases} as open_cases", $openOutcomes)
            ->selectRaw(
                '(select count(*) from case_notes cn where cn.beneficiary_id = beneficiaries.id) as notes_count',
            )
            ->selectRaw(
                '(select date(max(cn.date_noted)) from case_notes cn where cn.beneficiary_id = beneficiaries.id) as last_note_date',
            )
            ->selectRaw(
                '(select hr.diagnosis from health_records hr where hr.beneficiary_id = beneficiaries.id'
                .' order by hr.date_recorded desc, hr.id desc limit 1) as latest_diagnosis',
            )
            ->selectRaw(
                '(select hr.outcome from health_records hr where hr.beneficiary_id = beneficiaries.id'
                .' order by hr.date_recorded desc, hr.id desc limit 1) as latest_outcome',
            )
            ->orderByRaw("{$lastVaccination} is null desc")
            ->orderByRaw("{$lastVaccination} asc")
            ->orderBy('name_of_farmer');

        if ($attentionOnly) {
            $overdueOn = CarbonImmutable::now()->startOfDay()
                ->subDays((int) config('cvo.vaccination_interval_days'))
                ->toDateString();

            // Same two triggers the resource reports as reasons, expressed in
            // SQL so filtering happens before pagination rather than after it.
            $query->whereRaw(
                "({$lastVaccination} is null or {$lastVaccination} < ? or {$openCases} > 0)",
                [$overdueOn, ...$openOutcomes],
            );
        }

        return $query->paginate($perPage);
    }

    /**
     * Why an animal is flagged for attention, in the order a vet would triage.
     *
     * Shared by the resource so the reason shown for a row is the same test the
     * `attention` filter used to select it.
     *
     * @return list<string>
     */
    public static function attentionReasons(array $schedule, int $openCases): array
    {
        $reasons = [];

        if ($schedule['status'] === VaccinationScheduleService::STATUS_OVERDUE) {
            $reasons[] = 'Vaccination overdue';
        }

        if ($schedule['status'] === VaccinationScheduleService::STATUS_NEVER) {
            $reasons[] = 'Never vaccinated';
        }

        if ($openCases > 0) {
            $reasons[] = $openCases === 1 ? '1 open case' : "{$openCases} open cases";
        }

        return $reasons;
    }
}
