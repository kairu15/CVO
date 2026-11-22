<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\CaseNote;
use App\Models\FieldVisit;
use App\Models\HealthRecord;
use App\Models\MonitoringRecord;
use App\Models\User;
use App\Models\Vaccination;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AnimalHealthTest extends TestCase
{
    use RefreshDatabase;

    private User $technician;

    private int $interval;

    protected function setUp(): void
    {
        parent::setUp();

        $this->technician = User::factory()->create(['role' => 'technician']);
        $this->interval = (int) config('cvo.vaccination_interval_days');
    }

    private function animal(): Beneficiary
    {
        return Beneficiary::factory()->create();
    }

    public function test_the_rollup_reports_visits_clinical_events_and_notes_for_one_animal(): void
    {
        $animal = $this->animal();

        MonitoringRecord::factory()->for($animal, 'beneficiary')->create([
            'date_monitored' => now()->subDays(12)->toDateString(),
            'vaccination_date' => now()->subDays(10)->toDateString(),
        ]);

        HealthRecord::factory()->by($this->technician)->forBeneficiary($animal)->create([
            'date_recorded' => now()->subDays(6)->toDateString(),
            'diagnosis' => 'Mastitis',
            'outcome' => 'recovered',
        ]);

        CaseNote::factory()->count(2)->by($this->technician)->forBeneficiary($animal)->create([
            'date_noted' => now()->subDays(4)->toDateString(),
        ]);

        $response = $this->actingAs($this->technician)->getJson('/api/v1/animal-health');

        $response->assertOk()
            ->assertJsonPath('data.0.id', $animal->id)
            ->assertJsonPath('data.0.last_visit_date', now()->subDays(12)->toDateString())
            ->assertJsonPath('data.0.last_vaccination_date', now()->subDays(10)->toDateString())
            ->assertJsonPath('data.0.latest_diagnosis', 'Mastitis')
            ->assertJsonPath('data.0.latest_outcome', 'recovered')
            ->assertJsonPath('data.0.open_cases', 0)
            ->assertJsonPath('data.0.notes_count', 2)
            ->assertJsonPath('data.0.last_note_date', now()->subDays(4)->toDateString());
    }

    public function test_an_animal_with_nothing_recorded_reports_empty_aggregates(): void
    {
        $animal = $this->animal();

        $response = $this->actingAs($this->technician)->getJson('/api/v1/animal-health');

        $response->assertOk()
            ->assertJsonPath('data.0.id', $animal->id)
            ->assertJsonPath('data.0.last_visit_date', null)
            ->assertJsonPath('data.0.latest_diagnosis', null)
            ->assertJsonPath('data.0.open_cases', 0)
            ->assertJsonPath('data.0.notes_count', 0)
            ->assertJsonPath('data.0.status', 'never');
    }

    public function test_the_most_recent_clinical_event_wins(): void
    {
        $animal = $this->animal();

        HealthRecord::factory()->by($this->technician)->forBeneficiary($animal)->create([
            'date_recorded' => now()->subMonths(3)->toDateString(),
            'diagnosis' => 'Old diagnosis',
            'outcome' => 'recovered',
        ]);
        HealthRecord::factory()->by($this->technician)->forBeneficiary($animal)->create([
            'date_recorded' => now()->subDays(2)->toDateString(),
            'diagnosis' => 'Current diagnosis',
            'outcome' => 'ongoing',
        ]);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health')
            ->assertOk()
            ->assertJsonPath('data.0.latest_diagnosis', 'Current diagnosis')
            ->assertJsonPath('data.0.latest_outcome', 'ongoing');
    }

    /**
     * "Open" is the boundary that stops the rollup mislabelling an animal as
     * still under treatment: referred and deceased both end this clinic's
     * involvement, so neither counts.
     */
    public function test_only_unresolved_outcomes_count_as_open_cases(): void
    {
        $animal = $this->animal();

        foreach (['ongoing', 'improving'] as $outcome) {
            HealthRecord::factory()->by($this->technician)->forBeneficiary($animal)->create([
                'outcome' => $outcome,
            ]);
        }

        // No outcome yet also counts as open — the case has not been closed out.
        HealthRecord::factory()->by($this->technician)->forBeneficiary($animal)->create([
            'outcome' => null,
        ]);

        foreach (['recovered', 'referred', 'deceased'] as $closed) {
            HealthRecord::factory()->by($this->technician)->forBeneficiary($animal)->create([
                'outcome' => $closed,
            ]);
        }

        $this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health')
            ->assertOk()
            ->assertJsonPath('data.0.open_cases', 3);
    }

    public function test_an_open_case_flags_the_animal_for_attention(): void
    {
        $animal = $this->animal();

        HealthRecord::factory()->by($this->technician)->forBeneficiary($animal)->create([
            'outcome' => 'ongoing',
        ]);

        // Recently vaccinated, so the only reason is the open case.
        MonitoringRecord::factory()->for($animal, 'beneficiary')->create([
            'vaccination_date' => now()->subDays(5)->toDateString(),
        ]);

        $response = $this->actingAs($this->technician)->getJson('/api/v1/animal-health');

        $response->assertOk()
            ->assertJsonPath('data.0.needs_attention', true)
            ->assertJsonPath('data.0.attention_reasons', ['1 open case']);
    }

    public function test_an_overdue_vaccination_is_reported_as_a_reason(): void
    {
        $animal = $this->animal();

        MonitoringRecord::factory()->for($animal, 'beneficiary')->create([
            'vaccination_date' => now()->subDays($this->interval + 5)->toDateString(),
        ]);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health')
            ->assertOk()
            ->assertJsonPath('data.0.needs_attention', true)
            ->assertJsonPath('data.0.attention_reasons', ['Vaccination overdue'])
            ->assertJsonPath('data.0.status', 'overdue');
    }

    public function test_a_recently_vaccinated_closed_out_animal_needs_no_attention(): void
    {
        $animal = $this->animal();

        MonitoringRecord::factory()->for($animal, 'beneficiary')->create([
            'vaccination_date' => now()->subDays(5)->toDateString(),
        ]);
        HealthRecord::factory()->by($this->technician)->forBeneficiary($animal)->create([
            'outcome' => 'recovered',
        ]);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health')
            ->assertOk()
            ->assertJsonPath('data.0.needs_attention', false)
            ->assertJsonPath('data.0.attention_reasons', []);
    }

    /**
     * The filter selects in SQL while the flag is derived in PHP. They must
     * agree, or a row would show up under "needs attention" labelled as fine.
     */
    public function test_the_attention_filter_matches_the_derived_flag(): void
    {
        $needsAttention = $this->animal();          // never vaccinated
        HealthRecord::factory()->by($this->technician)->forBeneficiary($needsAttention)->create([
            'outcome' => 'ongoing',
        ]);

        $fine = $this->animal();
        MonitoringRecord::factory()->for($fine, 'beneficiary')->create([
            'vaccination_date' => now()->subDays(5)->toDateString(),
        ]);

        $response = $this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health?filter=attention');

        $response->assertOk()->assertJsonCount(1, 'data');
        $this->assertSame($needsAttention->id, $response->json('data.0.id'));
        $this->assertTrue($response->json('data.0.needs_attention'));

        // And every row the unfiltered list marks as needing attention is
        // exactly the set the filter returns.
        $all = $this->actingAs($this->technician)->getJson('/api/v1/animal-health');
        $flagged = collect($all->json('data'))
            ->where('needs_attention', true)
            ->pluck('id')
            ->values()
            ->all();

        $this->assertSame([$needsAttention->id], $flagged);
    }

    public function test_an_unknown_filter_is_rejected(): void
    {
        $this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health?filter=maybe')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['filter']);
    }

    public function test_a_technician_sees_the_city_wide_rollup(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $assigned = Beneficiary::factory()->assignedTo($technician)->create();
        // A household assigned to nobody is no longer filtered out: the
        // technician absorbed the old doctor role's city-wide oversight.
        $unassigned = $this->animal();

        $response = $this->actingAs($technician)
            ->getJson('/api/v1/animal-health')
            ->assertOk()
            ->assertJsonCount(2, 'data');

        $returned = collect($response->json('data'))->pluck('id')->sort()->values()->all();
        $this->assertSame([$assigned->id, $unassigned->id], $returned);
    }

    public function test_guests_are_rejected(): void
    {
        $this->getJson('/api/v1/animal-health')->assertUnauthorized();
    }

    public function test_the_overview_reports_healthy_observation_attention_and_unrecorded_statuses(): void
    {
        $healthy = $this->animal();
        MonitoringRecord::factory()->for($healthy, 'beneficiary')->create([
            'vaccination_date' => now()->subDays(5)->toDateString(),
        ]);
        HealthRecord::factory()->by($this->technician)->forBeneficiary($healthy)->create([
            'date_recorded' => now()->subDays(3)->toDateString(),
            'outcome' => 'recovered',
        ]);

        $observation = $this->animal();
        MonitoringRecord::factory()->for($observation, 'beneficiary')->create([
            'vaccination_date' => now()->subDays(5)->toDateString(),
        ]);
        CaseNote::factory()->by($this->technician)->forBeneficiary($observation)->create([
            'date_noted' => now()->toDateString(),
            'status' => CaseNote::STATUS_OBSERVATION,
            'follow_up_on' => now()->addWeek()->toDateString(),
        ]);

        $attention = $this->animal();
        MonitoringRecord::factory()->for($attention, 'beneficiary')->create([
            'vaccination_date' => now()->subDays(5)->toDateString(),
        ]);
        HealthRecord::factory()->by($this->technician)->forBeneficiary($attention)->create([
            'date_recorded' => now()->subDay()->toDateString(),
            'outcome' => 'ongoing',
        ]);

        $unrecorded = $this->animal();
        MonitoringRecord::factory()->for($unrecorded, 'beneficiary')->create([
            'vaccination_date' => now()->subDays(5)->toDateString(),
        ]);

        $response = $this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health/summary')
            ->assertOk()
            ->assertJsonPath('data.total_animals', 4)
            ->assertJsonPath('data.healthy_animals', 1)
            ->assertJsonPath('data.observation_animals', 1)
            ->assertJsonPath('data.attention_animals', 1)
            ->assertJsonPath('data.unrecorded_animals', 1)
            ->assertJsonPath('data.open_concerns', 1);

        // The row statuses are derived from the same rule as the cards.
        $statuses = collect($this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health')
            ->json('data'))
            ->pluck('health_status', 'id')
            ->all();

        $this->assertSame('healthy', $statuses[$healthy->id]);
        $this->assertSame('observation', $statuses[$observation->id]);
        $this->assertSame('attention', $statuses[$attention->id]);
        $this->assertSame('unrecorded', $statuses[$unrecorded->id]);
    }

    public function test_search_status_barangay_sort_and_pagination_run_before_the_response(): void
    {
        $alpha = Beneficiary::factory()->create([
            'name_of_farmer' => 'Alpha Farmer',
            'address' => 'Dawis',
            'animal_type' => 'Carabao',
        ]);
        MonitoringRecord::factory()->for($alpha, 'beneficiary')->create([
            'vaccination_date' => now()->subDays(5)->toDateString(),
        ]);
        HealthRecord::factory()->by($this->technician)->forBeneficiary($alpha)->create([
            'date_recorded' => now()->subDays(3)->toDateString(),
            'diagnosis' => 'Hoof rot',
            'outcome' => 'recovered',
        ]);

        $beta = Beneficiary::factory()->create([
            'name_of_farmer' => 'Beta Farmer',
            'address' => 'Banaybanay',
            'animal_type' => 'Goat',
        ]);
        MonitoringRecord::factory()->for($beta, 'beneficiary')->create([
            'vaccination_date' => now()->subDays(5)->toDateString(),
        ]);

        Beneficiary::factory()->create([
            'name_of_farmer' => 'Gamma Farmer',
            'address' => 'Dawis',
            'animal_type' => 'Swine',
        ]);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health?search=Alpha')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $alpha->id);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health?barangay=Dawis')
            ->assertOk()
            ->assertJsonCount(2, 'data');

        $this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health?status=healthy')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $alpha->id);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health?sort=name&direction=asc&per_page=1&page=2')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $beta->id)
            ->assertJsonPath('meta.current_page', 2);
    }

    public function test_the_map_endpoint_returns_barangay_counts_and_geotagged_locations(): void
    {
        $animal = Beneficiary::factory()->create([
            'name_of_farmer' => 'Map Farmer',
            'address' => 'Dawis',
            'latitude' => 9.55,
            'longitude' => 122.93,
        ]);
        MonitoringRecord::factory()->for($animal, 'beneficiary')->create([
            'vaccination_date' => now()->subDays(5)->toDateString(),
        ]);
        HealthRecord::factory()->by($this->technician)->forBeneficiary($animal)->create([
            'outcome' => 'recovered',
        ]);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health/map')
            ->assertOk()
            ->assertJsonPath('data.barangays.0.name', 'Dawis')
            ->assertJsonPath('data.barangays.0.animals', 1)
            ->assertJsonPath('data.barangays.0.healthy', 1)
            ->assertJsonPath('data.locations.0.beneficiary_id', $animal->id)
            ->assertJsonPath('data.locations.0.latitude', 9.55);
    }

    public function test_trends_distinguish_examinations_from_distinct_animals_and_honor_the_date_filter(): void
    {
        $first = $this->animal();
        $second = $this->animal();
        $month = now()->startOfMonth()->subMonth();

        HealthRecord::factory()->by($this->technician)->forBeneficiary($first)->create([
            'date_recorded' => $month->toDateString(),
        ]);
        HealthRecord::factory()->by($this->technician)->forBeneficiary($first)->create([
            'date_recorded' => $month->copy()->addDay()->toDateString(),
        ]);
        HealthRecord::factory()->by($this->technician)->forBeneficiary($second)->create([
            'date_recorded' => $month->copy()->addDays(2)->toDateString(),
        ]);
        HealthRecord::factory()->by($this->technician)->forBeneficiary($second)->create([
            'date_recorded' => now()->subMonths(8)->toDateString(),
        ]);

        $response = $this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health/trends?from='.$month->toDateString().'&to='.now()->toDateString())
            ->assertOk();

        $point = collect($response->json('data.points'))->firstWhere('period', $month->format('Y-m'));
        $this->assertSame(3, $point['examinations']);
        $this->assertSame(2, $point['animals']);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health/trends?from='.now()->toDateString().'&to='.$month->toDateString())
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['to']);
    }

    public function test_the_detail_drawer_returns_every_owning_module_without_copying_diagnoses_into_observations(): void
    {
        $animal = $this->animal();
        $health = HealthRecord::factory()->by($this->technician)->forBeneficiary($animal)->create([
            'date_recorded' => now()->subDays(2)->toDateString(),
            'diagnosis' => 'Mastitis',
            'symptoms' => 'Swollen quarter and reduced milk.',
            'outcome' => 'ongoing',
            'follow_up_on' => now()->subDay()->toDateString(),
        ]);
        $note = CaseNote::factory()->by($this->technician)->forBeneficiary($animal)->create([
            'date_noted' => now()->subDay()->toDateString(),
            'status' => CaseNote::STATUS_OBSERVATION,
            'body' => 'The animal is eating less than usual.',
        ]);
        $vaccination = Vaccination::factory()->by($this->technician)->forBeneficiary($animal)->create([
            'administered_on' => now()->subDays(5)->toDateString(),
        ]);
        $visit = FieldVisit::factory()->by($this->technician)->forBeneficiary($animal)->create([
            'visited_on' => now()->subDays(4)->toDateString(),
            'notes' => 'Observed the herd and left advice.',
        ]);
        MonitoringRecord::factory()->for($animal, 'beneficiary')->create([
            'date_monitored' => now()->subDays(3)->toDateString(),
        ]);

        $this->actingAs($this->technician)
            ->getJson("/api/v1/animal-health/{$animal->id}")
            ->assertOk()
            ->assertJsonPath('data.id', $animal->id)
            ->assertJsonPath('data.health_status', 'attention')
            ->assertJsonPath('data.latest_examination.diagnosis', 'Mastitis')
            ->assertJsonPath('data.health_records.0.id', $health->id)
            ->assertJsonPath('data.case_notes.0.id', $note->id)
            ->assertJsonPath('data.case_notes.0.body', 'The animal is eating less than usual.')
            ->assertJsonPath('data.vaccination_history.0.id', $vaccination->id)
            ->assertJsonPath('data.field_visits.0.id', $visit->id)
            ->assertJsonPath('data.related_concerns.0.type', 'health_record')
            ->assertJsonPath('data.related_concerns.0.is_diagnosis', true)
            ->assertJsonPath('data.related_concerns.1.type', 'case_observation')
            ->assertJsonPath('data.related_concerns.1.is_diagnosis', false);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/animal-health/999999')
            ->assertNotFound();
    }
}
