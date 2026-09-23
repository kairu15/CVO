<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class VaccinationScheduleTest extends TestCase
{
    use RefreshDatabase;

    private int $interval;

    private int $window;

    protected function setUp(): void
    {
        parent::setUp();

        $this->interval = (int) config('cvo.vaccination_interval_days');
        $this->window = (int) config('cvo.vaccination_due_soon_days');
    }

    private function doctor(): User
    {
        return User::factory()->create(['role' => 'doctor']);
    }

    /** A beneficiary whose most recent vaccination was $daysAgo days ago. */
    private function vaccinatedDaysAgo(int $daysAgo): Beneficiary
    {
        $beneficiary = Beneficiary::factory()->create();

        MonitoringRecord::factory()
            ->for($beneficiary, 'beneficiary')
            ->create(['vaccination_date' => now()->subDays($daysAgo)->toDateString()]);

        return $beneficiary;
    }

    public function test_the_schedule_derives_next_due_from_the_last_vaccination(): void
    {
        $beneficiary = $this->vaccinatedDaysAgo(10);

        $response = $this->actingAs($this->doctor())->getJson('/api/v1/vaccination-schedule');

        $response->assertOk()
            ->assertJsonPath('data.0.id', $beneficiary->id)
            ->assertJsonPath('data.0.last_vaccination_date', now()->subDays(10)->toDateString())
            ->assertJsonPath('data.0.next_due_date', now()->subDays(10)->addDays($this->interval)->toDateString())
            ->assertJsonPath('data.0.status', 'scheduled')
            ->assertJsonPath('data.0.days_until_due', $this->interval - 10);
    }

    public function test_an_animal_never_vaccinated_is_reported_as_never(): void
    {
        Beneficiary::factory()->create();

        $this->actingAs($this->doctor())
            ->getJson('/api/v1/vaccination-schedule')
            ->assertOk()
            ->assertJsonPath('data.0.status', 'never')
            ->assertJsonPath('data.0.last_vaccination_date', null)
            ->assertJsonPath('data.0.next_due_date', null)
            ->assertJsonPath('data.0.days_until_due', null);
    }

    public function test_monitoring_records_without_a_vaccination_do_not_count(): void
    {
        // A visit that recorded deworming but no vaccination must not be read
        // as "vaccinated" — that would invent a due date out of nothing.
        $beneficiary = Beneficiary::factory()->create();
        MonitoringRecord::factory()->for($beneficiary, 'beneficiary')->create([
            'vaccination_date' => null,
            'deworming_date' => now()->subDays(5)->toDateString(),
        ]);

        $this->actingAs($this->doctor())
            ->getJson('/api/v1/vaccination-schedule')
            ->assertOk()
            ->assertJsonPath('data.0.status', 'never');
    }

    public function test_the_latest_vaccination_wins_when_several_are_recorded(): void
    {
        $beneficiary = Beneficiary::factory()->create();

        foreach ([400, 20, 200] as $daysAgo) {
            MonitoringRecord::factory()->for($beneficiary, 'beneficiary')->create([
                'vaccination_date' => now()->subDays($daysAgo)->toDateString(),
            ]);
        }

        $this->actingAs($this->doctor())
            ->getJson('/api/v1/vaccination-schedule')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.last_vaccination_date', now()->subDays(20)->toDateString());
    }

    public function test_an_overdue_animal_is_reported_as_overdue(): void
    {
        $this->vaccinatedDaysAgo($this->interval + 1);

        $this->actingAs($this->doctor())
            ->getJson('/api/v1/vaccination-schedule')
            ->assertOk()
            ->assertJsonPath('data.0.status', 'overdue')
            ->assertJsonPath('data.0.days_until_due', -1);
    }

    public function test_an_animal_due_inside_the_window_is_due_soon(): void
    {
        $this->vaccinatedDaysAgo($this->interval - $this->window);

        $this->actingAs($this->doctor())
            ->getJson('/api/v1/vaccination-schedule')
            ->assertOk()
            ->assertJsonPath('data.0.status', 'due-soon')
            ->assertJsonPath('data.0.days_until_due', $this->window);
    }

    /**
     * The status filter is expressed in SQL while the row's status is computed
     * in PHP from the same thresholds. If the two ever disagree, a row would
     * appear in the "overdue" list labelled "due soon" — so the boundary days
     * are checked on both sides.
     */
    public function test_the_status_filter_agrees_with_the_computed_row_status(): void
    {
        // Exactly on each boundary.
        $exactlyOverdue = $this->vaccinatedDaysAgo($this->interval + 1);
        $onTheLine = $this->vaccinatedDaysAgo($this->interval);           // due today
        $windowEdge = $this->vaccinatedDaysAgo($this->interval - $this->window);
        $comfortable = $this->vaccinatedDaysAgo($this->interval - $this->window - 1);
        $never = Beneficiary::factory()->create();

        $expected = [
            'overdue' => [$exactlyOverdue->id],
            'due-soon' => [$onTheLine->id, $windowEdge->id],
            'scheduled' => [$comfortable->id],
            'never' => [$never->id],
        ];

        $doctor = $this->doctor();

        foreach ($expected as $status => $ids) {
            $response = $this->actingAs($doctor)
                ->getJson("/api/v1/vaccination-schedule?status={$status}");

            $response->assertOk();

            $returned = collect($response->json('data'))->pluck('id')->sort()->values()->all();
            sort($ids);

            $this->assertSame($ids, $returned, "status filter '{$status}' returned the wrong rows");

            // Every row the filter returned must carry the status it was filtered by.
            foreach ($response->json('data') as $row) {
                $this->assertSame($status, $row['status'], "row {$row['id']} is labelled wrongly");
            }
        }
    }

    public function test_the_most_urgent_animals_come_first(): void
    {
        $comfortable = $this->vaccinatedDaysAgo(10);
        $never = Beneficiary::factory()->create();
        $overdue = $this->vaccinatedDaysAgo($this->interval + 30);

        $ids = collect(
            $this->actingAs($this->doctor())
                ->getJson('/api/v1/vaccination-schedule')
                ->json('data'),
        )->pluck('id')->all();

        // Never-vaccinated leads, then the longest overdue, then the rest.
        $this->assertSame([$never->id, $overdue->id, $comfortable->id], $ids);
    }

    public function test_an_unknown_status_is_rejected(): void
    {
        $this->actingAs($this->doctor())
            ->getJson('/api/v1/vaccination-schedule?status=whenever')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);
    }

    public function test_a_farmer_sees_only_their_own_animals(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $own = Beneficiary::factory()->forFarmer($farmer)->create();

        MonitoringRecord::factory()->for($own, 'beneficiary')->create([
            'vaccination_date' => now()->subDays(5)->toDateString(),
        ]);

        $this->vaccinatedDaysAgo(5);

        $this->actingAs($farmer)
            ->getJson('/api/v1/vaccination-schedule')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $own->id);
    }

    public function test_a_technician_sees_only_assigned_animals(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $assigned = Beneficiary::factory()->assignedTo($technician)->create();

        MonitoringRecord::factory()->for($assigned, 'beneficiary')->create([
            'vaccination_date' => now()->subDays(5)->toDateString(),
        ]);

        $this->vaccinatedDaysAgo(5);

        $this->actingAs($technician)
            ->getJson('/api/v1/vaccination-schedule')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $assigned->id);
    }

    public function test_guests_are_rejected(): void
    {
        $this->getJson('/api/v1/vaccination-schedule')->assertUnauthorized();
    }
}
