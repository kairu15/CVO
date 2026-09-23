<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\CaseNote;
use App\Models\HealthRecord;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AnimalHealthTest extends TestCase
{
    use RefreshDatabase;

    private User $doctor;

    private int $interval;

    protected function setUp(): void
    {
        parent::setUp();

        $this->doctor = User::factory()->create(['role' => 'doctor']);
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

        HealthRecord::factory()->by($this->doctor)->forBeneficiary($animal)->create([
            'date_recorded' => now()->subDays(6)->toDateString(),
            'diagnosis' => 'Mastitis',
            'outcome' => 'recovered',
        ]);

        CaseNote::factory()->count(2)->by($this->doctor)->forBeneficiary($animal)->create([
            'date_noted' => now()->subDays(4)->toDateString(),
        ]);

        $response = $this->actingAs($this->doctor)->getJson('/api/v1/animal-health');

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

        $response = $this->actingAs($this->doctor)->getJson('/api/v1/animal-health');

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

        HealthRecord::factory()->by($this->doctor)->forBeneficiary($animal)->create([
            'date_recorded' => now()->subMonths(3)->toDateString(),
            'diagnosis' => 'Old diagnosis',
            'outcome' => 'recovered',
        ]);
        HealthRecord::factory()->by($this->doctor)->forBeneficiary($animal)->create([
            'date_recorded' => now()->subDays(2)->toDateString(),
            'diagnosis' => 'Current diagnosis',
            'outcome' => 'ongoing',
        ]);

        $this->actingAs($this->doctor)
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
            HealthRecord::factory()->by($this->doctor)->forBeneficiary($animal)->create([
                'outcome' => $outcome,
            ]);
        }

        // No outcome yet also counts as open — the case has not been closed out.
        HealthRecord::factory()->by($this->doctor)->forBeneficiary($animal)->create([
            'outcome' => null,
        ]);

        foreach (['recovered', 'referred', 'deceased'] as $closed) {
            HealthRecord::factory()->by($this->doctor)->forBeneficiary($animal)->create([
                'outcome' => $closed,
            ]);
        }

        $this->actingAs($this->doctor)
            ->getJson('/api/v1/animal-health')
            ->assertOk()
            ->assertJsonPath('data.0.open_cases', 3);
    }

    public function test_an_open_case_flags_the_animal_for_attention(): void
    {
        $animal = $this->animal();

        HealthRecord::factory()->by($this->doctor)->forBeneficiary($animal)->create([
            'outcome' => 'ongoing',
        ]);

        // Recently vaccinated, so the only reason is the open case.
        MonitoringRecord::factory()->for($animal, 'beneficiary')->create([
            'vaccination_date' => now()->subDays(5)->toDateString(),
        ]);

        $response = $this->actingAs($this->doctor)->getJson('/api/v1/animal-health');

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

        $this->actingAs($this->doctor)
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
        HealthRecord::factory()->by($this->doctor)->forBeneficiary($animal)->create([
            'outcome' => 'recovered',
        ]);

        $this->actingAs($this->doctor)
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
        HealthRecord::factory()->by($this->doctor)->forBeneficiary($needsAttention)->create([
            'outcome' => 'ongoing',
        ]);

        $fine = $this->animal();
        MonitoringRecord::factory()->for($fine, 'beneficiary')->create([
            'vaccination_date' => now()->subDays(5)->toDateString(),
        ]);

        $response = $this->actingAs($this->doctor)
            ->getJson('/api/v1/animal-health?filter=attention');

        $response->assertOk()->assertJsonCount(1, 'data');
        $this->assertSame($needsAttention->id, $response->json('data.0.id'));
        $this->assertTrue($response->json('data.0.needs_attention'));

        // And every row the unfiltered list marks as needing attention is
        // exactly the set the filter returns.
        $all = $this->actingAs($this->doctor)->getJson('/api/v1/animal-health');
        $flagged = collect($all->json('data'))
            ->where('needs_attention', true)
            ->pluck('id')
            ->values()
            ->all();

        $this->assertSame([$needsAttention->id], $flagged);
    }

    public function test_an_unknown_filter_is_rejected(): void
    {
        $this->actingAs($this->doctor)
            ->getJson('/api/v1/animal-health?filter=maybe')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['filter']);
    }

    public function test_a_farmer_sees_only_their_own_animals(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $own = Beneficiary::factory()->forFarmer($farmer)->create();
        $this->animal();

        $this->actingAs($farmer)
            ->getJson('/api/v1/animal-health')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $own->id);
    }

    public function test_a_technician_sees_only_assigned_animals(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $assigned = Beneficiary::factory()->assignedTo($technician)->create();
        $this->animal();

        $this->actingAs($technician)
            ->getJson('/api/v1/animal-health')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $assigned->id);
    }

    public function test_guests_are_rejected(): void
    {
        $this->getJson('/api/v1/animal-health')->assertUnauthorized();
    }
}
