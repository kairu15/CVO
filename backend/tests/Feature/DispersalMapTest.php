<?php

namespace Tests\Feature;

use App\Models\Animal;
use App\Models\AnimalOwnershipEvent;
use App\Models\AnimalType;
use App\Models\Barangay;
use App\Models\Beneficiary;
use App\Models\User;
use App\Support\Barangays;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The dispersal map's dated snapshot: a fixture of known events asserted
 * against EXACT answers — dates newest first with voided ones gone, the two
 * date modes (on / as-of) agreeing with the ownership chain, Asia/Manila day
 * boundaries, future dates refused, zero-activity barangays present with 0,
 * polygon counts equal to pin counts, the technician's scoped + masked view,
 * and the coordinate hygiene rules (no invented positions).
 */
class DispersalMapTest extends TestCase
{
    use RefreshDatabase;

    /* ------------------------------------------------------------------ *
     |  Helpers                                                            |
     * ------------------------------------------------------------------ */

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\BarangaySeeder::class);
    }

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    private function technician(): User
    {
        return User::factory()->create(['role' => 'technician']);
    }

    private function barangay(int $index): Barangay
    {
        return Barangay::query()->where('name', Barangays::all()[$index])->firstOrFail();
    }

    private function beneficiaryIn(Barangay $barangay, array $extra = []): Beneficiary
    {
        return Beneficiary::factory()->create([
            'address' => $barangay->name,
            'barangay_id' => $barangay->id,
            ...$extra,
        ]);
    }

    private function animalTypeId(): int
    {
        return AnimalType::query()->where('name', 'Swine (Pig)')->firstOrFail()->id;
    }

    private function disperse(User $actor, Beneficiary $owner, ?string $date = null, ?string $tag = null): Animal
    {
        $response = $this->actingAs($actor)->postJson('/api/v1/dispersals', [
            'to_beneficiary_id' => $owner->id,
            'animal_type_id' => $this->animalTypeId(),
            'ear_tag_number' => $tag,
            'event_date' => $date ?? now()->toDateString(),
        ]);

        $response->assertCreated();

        return Animal::findOrFail($response->json('data.animal_id'));
    }

    private function latestEventId(int $animalId): int
    {
        return (int) DB::table('animal_ownership_events')
            ->where('animal_id', $animalId)
            ->where('status', 'active')
            ->orderByDesc('event_date')
            ->orderByDesc('id')
            ->value('id');
    }

    private function redisperse(User $actor, int $animalId, Beneficiary $to, ?string $date = null): void
    {
        $this->actingAs($actor)->postJson("/api/v1/animals/{$animalId}/redispersals", [
            'to_beneficiary_id' => $to->id,
            'base_event_id' => $this->latestEventId($animalId),
            'event_date' => $date ?? now()->toDateString(),
        ])->assertCreated();
    }

    private function returnToCvo(User $actor, int $animalId, ?string $date = null): void
    {
        $this->actingAs($actor)->postJson("/api/v1/animals/{$animalId}/returns", [
            'base_event_id' => $this->latestEventId($animalId),
            'event_date' => $date ?? now()->toDateString(),
        ])->assertCreated();
    }

    private function dates(User $viewer, array $query = []): array
    {
        return $this->actingAs($viewer)
            ->getJson('/api/v1/map/dates'.(count($query) > 0 ? '?'.http_build_query($query) : ''))
            ->assertOk()
            ->json('data');
    }

    private function pins(User $viewer, ?string $date, string $mode = 'on')
    {
        return $this->actingAs($viewer)->getJson(
            '/api/v1/map/pins?'.http_build_query(array_filter([
                'date' => $date,
                'mode' => $mode,
            ], fn ($value) => $value !== null)),
        );
    }

    private function snapshot(User $viewer, ?string $date, string $mode = 'on'): array
    {
        return $this->pins($viewer, $date, $mode)->assertOk()->json('data');
    }

    private function rowFor(array $data, int $barangayId): array
    {
        $row = collect($data['barangays'])->firstOrFail(fn (array $row) => $row['barangay_id'] === $barangayId);
        assert(is_array($row));

        return $row;
    }

    private function dateList(array $data): array
    {
        return collect($data['dates'])->pluck('date')->all();
    }

    private function pinAnimalIds(array $data): array
    {
        return collect($data['pins'])->pluck('animal_id')->sort()->values()->all();
    }

    /* ------------------------------------------------------------------ *
     |  Dates                                                              |
     * ------------------------------------------------------------------ */

    public function test_dates_are_newest_first_with_event_and_barangay_counts(): void
    {
        $admin = $this->admin();
        $b1 = $this->barangay(0);
        $b2 = $this->barangay(1);
        $ownerA = $this->beneficiaryIn($b1);
        $ownerB = $this->beneficiaryIn($b2);

        $this->disperse($admin, $ownerA, '2026-10-20', 'T1');
        $this->disperse($admin, $ownerA, '2026-10-20', 'T2');
        $this->disperse($admin, $ownerB, '2026-10-25', 'T3');

        $data = $this->dates($admin);

        // Newest first, each with the day's event count and the distinct
        // barangays its events touched.
        $this->assertSame(['2026-10-25', '2026-10-20'], $this->dateList($data));
        $this->assertSame('2026-10-25', $data['dates'][0]['date']);
        $this->assertSame(1, $data['dates'][0]['event_count']);
        $this->assertSame(1, $data['dates'][0]['barangay_count']);
        $this->assertSame('2026-10-20', $data['dates'][1]['date']);
        $this->assertSame(2, $data['dates'][1]['event_count']);
        $this->assertSame(1, $data['dates'][1]['barangay_count']);
    }

    public function test_dates_exclude_voided_events_and_drop_emptied_days(): void
    {
        $admin = $this->admin();
        $ownerA = $this->beneficiaryIn($this->barangay(0));
        $ownerB = $this->beneficiaryIn($this->barangay(1));

        $this->disperse($admin, $ownerA, '2026-10-20', 'T1');
        $voided = $this->disperse($admin, $ownerB, '2026-10-22', 'T2');

        $this->actingAs($admin)->postJson("/api/v1/ownership-events/{$this->latestEventId($voided->id)}/void", [
            'void_reason' => 'recorded in error',
        ])->assertOk();

        $data = $this->dates($admin);

        // The voided event's day is gone entirely (it was the day's only
        // event); the kept one remains.
        $this->assertSame(['2026-10-20'], $this->dateList($data));
        $this->assertSame(1, $data['dates'][0]['event_count']);
    }

    public function test_dates_support_the_from_to_window(): void
    {
        $admin = $this->admin();
        $owner = $this->beneficiaryIn($this->barangay(0));

        // Inside the dispersal API's 30-day recordable window; the day
        // strings come from now() so the fixture never drifts stale.
        $oldest = now()->subDays(20)->toDateString();
        $middle = now()->subDays(10)->toDateString();
        $newest = now()->subDays(2)->toDateString();

        $this->disperse($admin, $owner, $oldest, 'T1');
        $this->disperse($admin, $owner, $middle, 'T2');
        $this->disperse($admin, $owner, $newest, 'T3');

        $data = $this->dates($admin, [
            'from' => now()->subDays(15)->toDateString(),
            'to' => now()->subDays(5)->toDateString(),
        ]);

        $this->assertSame([$middle], $this->dateList($data));
        $this->assertSame(1, $data['total']);
    }

    /* ------------------------------------------------------------------ *
     |  Date modes                                                         |
     * ------------------------------------------------------------------ */

    public function test_as_of_keeps_a_re_dispersed_animal_at_its_earlier_owner(): void
    {
        $admin = $this->admin();
        $firstHouse = $this->barangay(0);
        $secondHouse = $this->barangay(1);
        $first = $this->beneficiaryIn($firstHouse, ['latitude' => 9.5, 'longitude' => 122.8]);
        $second = $this->beneficiaryIn($secondHouse, ['latitude' => 9.55, 'longitude' => 122.85]);

        $animal = $this->disperse($admin, $first, '2026-10-20', 'T1');
        $this->redisperse($admin, $animal->id, $second, '2026-10-25');

        $day1 = $this->snapshot($admin, '2026-10-20', 'as_of');
        $day2 = $this->snapshot($admin, '2026-10-25', 'as_of');

        // Day 1: the animal is at its FIRST owner even though it moved later.
        $this->assertCount(1, $day1['pins']);
        $this->assertSame($animal->id, $day1['pins'][0]['animal_id']);
        $this->assertSame($first->name_of_farmer, $day1['pins'][0]['owner']['label']);
        $this->assertSame($firstHouse->name, $day1['pins'][0]['barangay']);

        // Day 2: the same animal now shows at its new owner.
        $this->assertCount(1, $day2['pins']);
        $this->assertSame($second->name_of_farmer, $day2['pins'][0]['owner']['label']);
        $this->assertSame('2026-10-25', $day2['pins'][0]['last_event_date']);
    }

    public function test_on_mode_shows_only_that_day_arrivals(): void
    {
        $admin = $this->admin();
        $first = $this->beneficiaryIn($this->barangay(0), ['latitude' => 9.5, 'longitude' => 122.8]);
        $second = $this->beneficiaryIn($this->barangay(1), ['latitude' => 9.55, 'longitude' => 122.85]);

        $animal = $this->disperse($admin, $first, '2026-10-20', 'T1');
        $other = $this->disperse($admin, $second, '2026-10-25', 'T2');
        $this->redisperse($admin, $animal->id, $second, '2026-10-25');

        $day1 = $this->snapshot($admin, '2026-10-20', 'on');
        $day2 = $this->snapshot($admin, '2026-10-25', 'on');

        $this->assertSame([$animal->id], $this->pinAnimalIds($day1));
        $this->assertSame($first->name_of_farmer, $day1['pins'][0]['owner']['label']);

        // The 25th carries the OTHER animal's dispersal and this one's
        // re-dispersal — both pins, both at their recipients that day.
        $this->assertSame(
            collect([$animal->id, $other->id])->sort()->values()->all(),
            $this->pinAnimalIds($day2),
        );
    }

    public function test_as_of_empty_day_still_answers_with_the_last_state(): void
    {
        $admin = $this->admin();
        $owner = $this->beneficiaryIn($this->barangay(2), ['latitude' => 9.5, 'longitude' => 122.8]);

        $animal = $this->disperse($admin, $owner, '2026-10-20', 'T1');

        $data = $this->snapshot($admin, '2026-10-30', 'as_of');
        $on = $this->snapshot($admin, '2026-10-30', 'on');

        $this->assertCount(1, $data['pins']);
        $this->assertSame($animal->id, $data['pins'][0]['animal_id']);
        // The empty day still paints the city: every barangay at 0 except
        // the holder's.
        $this->assertCount(28, $data['barangays']);
        $this->assertSame(1, collect($data['barangays'])->sum('pins'));

        // "On this date" the same day is genuinely empty.
        $this->assertSame([], $on['pins']);
    }

    public function test_a_returned_animal_is_not_pinned(): void
    {
        $admin = $this->admin();
        $owner = $this->beneficiaryIn($this->barangay(3), ['latitude' => 9.5, 'longitude' => 122.8]);

        $animal = $this->disperse($admin, $owner, '2026-10-20', 'T1');
        $this->returnToCvo($admin, $animal->id, '2026-10-25');

        $before = $this->snapshot($admin, '2026-10-20', 'as_of');
        $after = $this->snapshot($admin, '2026-10-25', 'as_of');
        $onReturnDay = $this->snapshot($admin, '2026-10-25', 'on');

        $this->assertCount(1, $before['pins']);
        // Handed back: the animal is at CVO, not at any household.
        $this->assertSame([], $after['pins']);
        $this->assertSame([], $onReturnDay['pins']);
    }

    public function test_a_same_day_re_dispersal_wins_over_the_morning_dispersal(): void
    {
        $admin = $this->admin();
        $first = $this->beneficiaryIn($this->barangay(0), ['latitude' => 9.5, 'longitude' => 122.8]);
        $second = $this->beneficiaryIn($this->barangay(1), ['latitude' => 9.55, 'longitude' => 122.85]);

        $animal = $this->disperse($admin, $first, '2026-10-20', 'T1');
        $this->redisperse($admin, $animal->id, $second, '2026-10-20');

        // Both events share the day; the LATER one (by id) is the animal's
        // position at the end of it.
        $data = $this->snapshot($admin, '2026-10-20', 'on');
        $this->assertCount(1, $data['pins']);
        $this->assertSame($second->name_of_farmer, $data['pins'][0]['owner']['label']);
    }

    /* ------------------------------------------------------------------ *
     |  Timezone                                                           |
     * ------------------------------------------------------------------ */

    public function test_an_event_late_at_night_stays_on_its_own_manila_day(): void
    {
        $admin = $this->admin();
        $b1 = $this->barangay(0);
        $b2 = $this->barangay(1);

        // Written directly (the API takes date-only input): 23:59 and 00:01
        // Asia/Manila must land on DIFFERENT days, not straddle UTC.
        AnimalOwnershipEvent::create([
            'animal_id' => Animal::factory()->create(['animal_type_id' => $this->animalTypeId()])->id,
            'event_type' => AnimalOwnershipEvent::TYPE_DISPERSAL,
            'to_beneficiary_id' => $this->beneficiaryIn($b1)->id,
            'to_barangay_id' => $b1->id,
            'event_date' => '2026-10-29 23:59:00',
        ]);
        AnimalOwnershipEvent::create([
            'animal_id' => Animal::factory()->create(['animal_type_id' => $this->animalTypeId()])->id,
            'event_type' => AnimalOwnershipEvent::TYPE_DISPERSAL,
            'to_beneficiary_id' => $this->beneficiaryIn($b2)->id,
            'to_barangay_id' => $b2->id,
            'event_date' => '2026-10-30 00:01:00',
        ]);

        $data = $this->dates($admin);

        $this->assertSame(['2026-10-30', '2026-10-29'], $this->dateList($data));
    }

    /* ------------------------------------------------------------------ *
     |  Validation                                                         |
     * ------------------------------------------------------------------ */

    public function test_a_future_date_is_refused(): void
    {
        $admin = $this->admin();

        $this->pins($admin, '2099-01-01')->assertStatus(422);
    }

    public function test_a_malformed_date_is_refused(): void
    {
        $admin = $this->admin();

        $this->pins($admin, '01/30/2026')->assertStatus(422);
    }

    public function test_an_empty_date_answers_an_empty_snapshot_not_an_error(): void
    {
        $admin = $this->admin();
        $owner = $this->beneficiaryIn($this->barangay(0), ['latitude' => 9.5, 'longitude' => 122.8]);
        $this->disperse($admin, $owner, '2026-10-20', 'T1');

        $data = $this->snapshot($admin, null, 'on');

        $this->assertSame([], $data['pins']);
        $this->assertCount(28, $data['barangays']);
        $this->assertSame(0, collect($data['barangays'])->sum('pins'));
    }

    /* ------------------------------------------------------------------ *
     |  Barangay counts                                                    |
     * ------------------------------------------------------------------ */

    public function test_zero_activity_barangays_appear_and_polygon_counts_equal_pin_counts(): void
    {
        $admin = $this->admin();
        $quiet = $this->barangay(5);
        $busy = $this->barangay(7);
        $owner = $this->beneficiaryIn($busy, ['latitude' => 9.5, 'longitude' => 122.8]);

        $this->disperse($admin, $owner, '2026-10-20', 'T1');
        $this->disperse($admin, $owner, '2026-10-20', 'T2');

        $data = $this->snapshot($admin, '2026-10-20', 'on');

        $this->assertCount(2, $data['pins']);
        $this->assertCount(28, $data['barangays']);

        $busyRow = $this->rowFor($data, $busy->id);
        $this->assertSame(2, $busyRow['pins']);
        $this->assertSame($busy->name, $busyRow['name']);

        // The barangay where nothing happened is present, with 0 — the map
        // paints it with the lightest fill, never grey "no data".
        $this->assertSame(0, $this->rowFor($data, $quiet->id)['pins']);

        // The polygons and the pins always agree: every pin with a barangay
        // is counted in exactly that barangay's row.
        $assigned = collect($data['pins'])
            ->filter(fn (array $pin) => $pin['barangay_id'] !== null)
            ->groupBy('barangay_id')
            ->map(fn ($group) => $group->count());
        foreach ($data['barangays'] as $row) {
            $this->assertSame(
                $assigned->get($row['barangay_id'], 0),
                $row['pins'],
                "barangay {$row['name']} disagrees with its pins",
            );
        }
    }

    /* ------------------------------------------------------------------ *
     |  Locations                                                          |
     * ------------------------------------------------------------------ */

    public function test_a_household_without_coordinates_falls_back_to_its_barangay_centre(): void
    {
        $admin = $this->admin();
        $barangay = $this->barangay(9);
        // The factory stamps every household with coordinates; this one
        // genuinely has none (a legacy import row).
        $owner = $this->beneficiaryIn($barangay, ['latitude' => null, 'longitude' => null]);

        $this->disperse($admin, $owner, '2026-10-20', 'T1');

        $data = $this->snapshot($admin, '2026-10-20', 'on');

        $this->assertCount(1, $data['pins']);
        $this->assertTrue($data['pins'][0]['approximate']);
        $this->assertSame('barangay_centroid', $data['pins'][0]['location_source']);
        $this->assertSame((float) $barangay->latitude, $data['pins'][0]['latitude']);
        $this->assertSame((float) $barangay->longitude, $data['pins'][0]['longitude']);
        $this->assertSame(0, $data['skipped_no_location']);
    }

    public function test_invalid_owner_coordinates_are_dropped_and_the_centre_used(): void
    {
        $admin = $this->admin();
        $barangay = $this->barangay(9);
        // A botched import wrote latitude 999 — dropped, logged, and the pin
        // falls back to the barangay centre rather than pointing at nowhere.
        $owner = $this->beneficiaryIn($barangay, ['latitude' => 999, 'longitude' => 122.8]);

        $this->disperse($admin, $owner, '2026-10-20', 'T1');

        $data = $this->snapshot($admin, '2026-10-20', 'on');

        $this->assertSame((float) $barangay->latitude, $data['pins'][0]['latitude']);
        $this->assertTrue($data['pins'][0]['approximate']);
        $this->assertSame(0, $data['skipped_no_location']);
    }

    public function test_a_pin_with_no_location_anywhere_is_reported_not_invented(): void
    {
        $admin = $this->admin();
        // The shipped barangay centres are NOT NULL, so the "nothing to fall
        // back to" path is a household with no barangay on record at all —
        // no owner pin, no barangay centre.
        $owner = Beneficiary::factory()->create([
            'barangay_id' => null,
            'address' => 'Unlisted',
            'latitude' => null,
            'longitude' => null,
        ]);

        $this->disperse($admin, $owner, '2026-10-20', 'T1');

        $data = $this->snapshot($admin, '2026-10-20', 'on');

        $this->assertCount(1, $data['pins']);
        $this->assertNull($data['pins'][0]['latitude']);
        $this->assertNull($data['pins'][0]['longitude']);
        $this->assertNull($data['pins'][0]['barangay_id']);
        $this->assertSame(1, $data['skipped_no_location']);
    }

    /* ------------------------------------------------------------------ *
     |  Scoping & masking                                                  |
     * ------------------------------------------------------------------ */

    public function test_a_technician_sees_only_events_touching_their_households(): void
    {
        $admin = $this->admin();
        $tech = $this->technician();
        $mine = $this->beneficiaryIn($this->barangay(0), ['technician_id' => $tech->id, 'latitude' => 9.5, 'longitude' => 122.8]);
        $other = $this->beneficiaryIn($this->barangay(1), ['latitude' => 9.55, 'longitude' => 122.85]);

        $mineAnimal = $this->disperse($admin, $mine, '2026-10-20', 'T1');
        $this->disperse($admin, $other, '2026-10-20', 'T2');

        $data = $this->snapshot($tech, '2026-10-20', 'on');

        $this->assertSame([$mineAnimal->id], $this->pinAnimalIds($data));
        $this->assertTrue($data['scoped']);
    }

    public function test_a_technician_sees_a_moved_animals_event_but_the_new_owner_masked(): void
    {
        $admin = $this->admin();
        $tech = $this->technician();
        $newHouse = $this->barangay(1);
        $mine = $this->beneficiaryIn($this->barangay(0), ['technician_id' => $tech->id, 'latitude' => 9.5, 'longitude' => 122.8]);
        $unassigned = $this->beneficiaryIn($newHouse, ['latitude' => 9.55, 'longitude' => 122.85]);

        $animal = $this->disperse($admin, $mine, '2026-10-20', 'T1');
        $this->redisperse($admin, $animal->id, $unassigned, '2026-10-25');

        $data = $this->snapshot($tech, '2026-10-25', 'as_of');

        // The handover touched THEIR household (it was the source), so the
        // event is in scope — but the new owner's name and pin are not.
        $this->assertCount(1, $data['pins']);
        $this->assertTrue($data['pins'][0]['owner']['masked']);
        $this->assertSame("Beneficiary in {$newHouse->name}", $data['pins'][0]['owner']['label']);
        $this->assertNull($data['pins'][0]['owner']['id']);
        $this->assertStringNotContainsString($unassigned->name_of_farmer, $data['pins'][0]['owner']['label']);
        $this->assertTrue($data['pins'][0]['approximate']);
        $this->assertSame('barangay_centroid', $data['pins'][0]['location_source']);
    }

    public function test_admin_and_doctor_see_everything_unmasked(): void
    {
        $admin = $this->admin();
        $doctor = User::factory()->create(['role' => 'doctor']);
        $owner = $this->beneficiaryIn($this->barangay(0), ['latitude' => 9.5, 'longitude' => 122.8]);

        $this->disperse($admin, $owner, '2026-10-20', 'T1');

        foreach ([$admin, $doctor] as $viewer) {
            $data = $this->snapshot($viewer, '2026-10-20', 'on');
            $this->assertCount(1, $data['pins']);
            $this->assertFalse($data['pins'][0]['owner']['masked']);
            $this->assertSame($owner->name_of_farmer, $data['pins'][0]['owner']['label']);
            $this->assertSame(9.5, $data['pins'][0]['latitude']);
        }
    }

    /* ------------------------------------------------------------------ *
     |  Payload shape                                                      |
     * ------------------------------------------------------------------ */

    public function test_pins_carry_the_fields_the_side_list_and_popups_need(): void
    {
        $admin = $this->admin();
        $owner = $this->beneficiaryIn($this->barangay(0), ['latitude' => 9.5, 'longitude' => 122.8]);

        $animal = $this->disperse($admin, $owner, '2026-10-20', 'TAG-42');

        $data = $this->snapshot($admin, '2026-10-20', 'on');

        $pin = $data['pins'][0];
        $this->assertSame($animal->id, $pin['animal_id']);
        $this->assertSame('TAG-42', $pin['ear_tag_number']);
        $this->assertSame($owner->id, $pin['owner']['id']);
        $this->assertSame($owner->name_of_farmer, $pin['owner']['label']);
        $this->assertFalse($pin['owner']['masked']);
        $this->assertSame(9.5, $pin['latitude']);
        $this->assertSame(122.8, $pin['longitude']);
        $this->assertFalse($pin['approximate']);
        $this->assertSame('dispersal', $pin['event_type']);
        $this->assertSame('2026-10-20', $pin['last_event_date']);
        $this->assertIsInt($pin['last_event_id']);
        $this->assertIsString($pin['animal_type']);
    }
}
