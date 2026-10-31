<?php

namespace Tests\Feature;

use App\Models\Animal;
use App\Models\AnimalType;
use App\Models\Barangay;
use App\Models\Beneficiary;
use App\Models\User;
use App\Support\Barangays;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Barangay dispersal and re-dispersal analytics: a fixture of known events
 * asserted against EXACT counts, covering the definitions the tab is built
 * on — zeros for silent barangays, voided events excluded, same-barangay
 * handovers counted but never flowed, distinct-animal rates, barangay
 * snapshots surviving beneficiary edits, Asia/Manila day boundaries, ties,
 * the small-denominator rate floor, and technician row scoping.
 */
class BarangayDispersalAnalyticsTest extends TestCase
{
    use RefreshDatabase;

    /* ------------------------------------------------------------------ *
     |  Helpers                                                            |
     * ------------------------------------------------------------------ */

    protected function setUp(): void
    {
        parent::setUp();

        // The 28 official barangays the analytics starts from.
        $this->seed(\Database\Seeders\BarangaySeeder::class);
    }

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    private function barangay(int $index): Barangay
    {
        return Barangay::query()->where('name', Barangays::all()[$index])->firstOrFail();
    }

    private function beneficiaryIn(Barangay $barangay, ?User $technician = null): Beneficiary
    {
        return Beneficiary::factory()->create([
            'address' => $barangay->name,
            'barangay_id' => $barangay->id,
            'technician_id' => $technician?->id,
        ]);
    }

    private function disperse(User $actor, Beneficiary $owner, ?Carbon $date = null, ?string $tag = null): Animal
    {
        $response = $this->actingAs($actor)->postJson('/api/v1/dispersals', [
            'to_beneficiary_id' => $owner->id,
            'animal_type_id' => $this->animalTypeId(),
            'ear_tag_number' => $tag,
            'event_date' => ($date ?? now())->toDateString(),
        ]);

        $response->assertCreated();

        return Animal::findOrFail($response->json('data.animal_id'));
    }

    private function redisperse(User $actor, int $animalId, Beneficiary $to, ?Carbon $date = null)
    {
        $baseEventId = (int) DB::table('animal_ownership_events')
            ->where('animal_id', $animalId)
            ->where('status', 'active')
            ->orderByDesc('event_date')
            ->orderByDesc('id')
            ->value('id');

        return $this->actingAs($actor)->postJson("/api/v1/animals/{$animalId}/redispersals", [
            'to_beneficiary_id' => $to->id,
            'base_event_id' => $baseEventId,
            'event_date' => ($date ?? now())->toDateString(),
        ]);
    }

    private function animalTypeId(): int
    {
        return AnimalType::query()->where('name', 'Swine (Pig)')->firstOrFail()->id;
    }

    private function analytics(User $viewer, array $query = []): array
    {
        return $this->actingAs($viewer)
            ->getJson('/api/v1/analytics/barangay-dispersal'.(count($query) > 0 ? '?'.http_build_query($query) : ''))
            ->assertOk()
            ->json('data');
    }

    private function detail(User $viewer, int $barangayId, array $query = []): array
    {
        return $this->actingAs($viewer)
            ->getJson("/api/v1/analytics/barangay-dispersal/{$barangayId}".(count($query) > 0 ? '?'.http_build_query($query) : ''))
            ->assertOk()
            ->json('data');
    }

    private function rowFor(array $data, int $barangayId): array
    {
        return collect($data['barangays'])->firstOrFail(fn (array $row) => $row['barangay_id'] === $barangayId);
    }

    private function named(array $entries): string
    {
        return collect($entries)->pluck('name')->sort()->implode('|');
    }

    /* ------------------------------------------------------------------ *
     |  Access                                                             |
     * ------------------------------------------------------------------ */

    public function test_guests_and_roles_without_the_capability_are_refused(): void
    {
        $this->getJson('/api/v1/analytics/barangay-dispersal')->assertUnauthorized();

        $farmer = User::factory()->create(['role' => 'farmer']);
        $this->actingAs($farmer)
            ->getJson('/api/v1/analytics/barangay-dispersal')
            ->assertForbidden();

        // Doctor and admin see everything.
        $this->actingAs(User::factory()->create(['role' => 'doctor']))
            ->getJson('/api/v1/analytics/barangay-dispersal')
            ->assertOk();

        $this->actingAs($this->admin())
            ->getJson('/api/v1/analytics/barangay-dispersal')
            ->assertOk();
    }

    /**
     * The map's click-to-open card: the SAME filtered row as the table and the
     * polygon's colour, what the barangay received, and the handovers that
     * left it — with both sides of every movement named for an admin.
     */
    public function test_barangay_detail_lists_received_and_passed_on_handovers(): void
    {
        $admin = $this->admin();
        $a = $this->barangay(0);
        $b = $this->barangay(1);
        $ownerA = $this->beneficiaryIn($a);
        $ownerB = $this->beneficiaryIn($b);

        $animal = $this->disperse($admin, $ownerA, now()->subDays(3), 'TAG-CARD-1');
        $this->redisperse($admin, $animal->id, $ownerB, now()->subDays(1))->assertCreated();

        $detailB = $this->detail($admin, $b->id);
        $detailA = $this->detail($admin, $a->id);

        // B received the animal from A's household — the receiver AND the
        // sender are both named on B's card.
        $this->assertSame(1, $detailB['received']['total']);
        $received = $detailB['received']['items'][0];
        $this->assertSame($ownerB->name_of_farmer, $received['to']['name']);
        $this->assertSame($ownerA->name_of_farmer, $received['from']['name']);
        $this->assertSame('re_dispersal', $received['event_type']);
        $this->assertSame('TAG-CARD-1', $received['ear_tag_number']);
        $this->assertSame('Swine (Pig)', $received['animal_type']);
        $this->assertSame('livestock', $received['category']);
        $this->assertSame($b->name, $received['to']['barangay']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}$/', $received['event_date']);
        $this->assertFalse($received['to']['masked']);
        $this->assertSame(0, $detailB['passed_on']['total']);

        // A passed the animal on, and its first dispersal came from CVO.
        $this->assertSame(1, $detailA['passed_on']['total']);
        $passed = $detailA['passed_on']['items'][0];
        $this->assertSame($ownerA->name_of_farmer, $passed['from']['name']);
        $this->assertSame($ownerB->name_of_farmer, $passed['to']['name']);

        $this->assertSame(1, $detailA['received']['total']);
        $first = $detailA['received']['items'][0];
        $this->assertSame('dispersal', $first['event_type']);
        $this->assertSame('CVO', $first['from']['name']);
        $this->assertSame($ownerA->name_of_farmer, $first['to']['name']);

        // The card's headline numbers ARE the summary row behind the polygon
        // and the table — never a second, independently filtered derivation.
        $this->assertSame($this->rowFor($this->analytics($admin), $a->id), $detailA['totals']);
        $this->assertSame($a->id, $detailA['barangay']['id']);
        $this->assertSame($a->name, $detailA['barangay']['name']);
        $this->assertSame($detailA['totals']['population'], $detailA['barangay']['population']);

        // The received mix is grouped by the master list's category first.
        $this->assertSame('livestock', $detailB['categories'][0]['category']);
        $this->assertSame('Livestock', $detailB['categories'][0]['label']);
        $this->assertSame(1, $detailB['categories'][0]['total']);
        $this->assertSame('Swine (Pig)', $detailB['categories'][0]['types'][0]['name']);
        $this->assertSame(1, $detailB['categories'][0]['types'][0]['count']);

        // Private identifiers never travel with the card.
        $this->assertSame(['name', 'barangay', 'masked'], array_keys($received['to']));

        // Outside the covered barangays.
        $this->actingAs($admin)
            ->getJson('/api/v1/analytics/barangay-dispersal/999999')
            ->assertNotFound();
        $this->actingAs($admin)
            ->getJson('/api/v1/analytics/barangay-dispersal/not-a-number')
            ->assertNotFound();
    }

    /**
     * A technician's card shows their own household's name and masks every
     * other one — the same row scope the numbers already honour.
     */
    public function test_a_technician_sees_only_their_household_unmasked_on_the_card(): void
    {
        $admin = $this->admin();
        $technician = User::factory()->create(['role' => 'technician']);
        $a = $this->barangay(0);
        $b = $this->barangay(1);

        $mine = $this->beneficiaryIn($a, $technician);
        $theirs = $this->beneficiaryIn($b);

        $animal = $this->disperse($admin, $mine, now()->subDays(3), 'TAG-MASK-1');
        $this->redisperse($admin, $animal->id, $theirs, now()->subDays(1))->assertCreated();

        // The handover touches the technician's household as the SENDER, so
        // the scoped query still surfaces it on B's card.
        $detail = $this->detail($technician, $b->id);

        $this->assertTrue($detail['scoped']);
        $this->assertSame(1, $detail['received']['total']);

        $item = $detail['received']['items'][0];
        $this->assertSame($mine->name_of_farmer, $item['from']['name']);
        $this->assertFalse($item['from']['masked']);
        $this->assertTrue($item['to']['masked']);
        $this->assertSame("Beneficiary in {$b->name}", $item['to']['name']);
        $this->assertStringNotContainsString($theirs->name_of_farmer, json_encode($detail));
    }

    /**
     * The card honours the page's filters — date window, animal type and
     * event-type selection — and a voided handover disappears from both sides.
     */
    public function test_barangay_detail_follows_the_filters_and_excludes_voided_events(): void
    {
        $admin = $this->admin();
        $a = $this->barangay(0);
        $b = $this->barangay(1);
        $ownerA = $this->beneficiaryIn($a);
        $ownerB = $this->beneficiaryIn($b);

        $animal = $this->disperse($admin, $ownerA, now()->subDays(10), 'TAG-FD-1');
        $this->redisperse($admin, $animal->id, $ownerB, now()->subDays(5));
        $this->disperse($admin, $ownerA, now()->subDays(2), 'TAG-FD-2');

        // Date window: only the newest dispersal is inside it.
        $windowed = $this->detail($admin, $a->id, [
            'from' => now()->subDays(3)->toDateString(),
            'to' => now()->toDateString(),
        ]);
        $this->assertSame(1, $windowed['received']['total']);
        $this->assertSame('TAG-FD-2', $windowed['received']['items'][0]['ear_tag_number']);
        $this->assertSame(0, $windowed['passed_on']['total']);

        // Animal type: a type no animal here has hides both lists.
        $otherType = \App\Models\AnimalType::query()->where('name', '!=', 'Swine (Pig)')->firstOrFail();
        $wrongType = $this->detail($admin, $a->id, ['animal_type_id' => $otherType->id]);
        $this->assertSame(0, $wrongType['received']['total']);
        $this->assertSame([], $wrongType['categories']);

        // Event-type filter: dispersals only keeps the arrivals, not the
        // handovers that left.
        $dispersalsOnly = $this->detail($admin, $a->id, ['event_types' => ['dispersal']]);
        $this->assertSame(2, $dispersalsOnly['received']['total']);
        $this->assertSame(0, $dispersalsOnly['passed_on']['total']);

        // Voiding the handover removes it from BOTH barangays' cards.
        $eventId = (int) DB::table('animal_ownership_events')
            ->where('animal_id', $animal->id)
            ->where('event_type', 're_dispersal')
            ->value('id');
        $this->actingAs($admin)->postJson("/api/v1/ownership-events/{$eventId}/void", [
            'void_reason' => 'Wrong household.',
        ])->assertOk();

        $this->assertSame(0, $this->detail($admin, $a->id)['passed_on']['total']);
        $this->assertSame(0, $this->detail($admin, $b->id)['received']['total']);
    }

    /* ------------------------------------------------------------------ *
     |  Rows, zeros, voids, snapshots                                      |
     * ------------------------------------------------------------------ */

    public function test_a_barangay_with_no_activity_appears_with_zeros_and_ranks_lowest(): void
    {
        $admin = $this->admin();
        $busy = $this->barangay(0);
        $silent = $this->barangay(5);

        $this->disperse($admin, $this->beneficiaryIn($busy), now()->subDay(), 'TAG-1');
        $this->disperse($admin, $this->beneficiaryIn($busy), now()->subDay(), 'TAG-2');

        $data = $this->analytics($admin);

        // Every seeded barangay is present — a barangay with nothing must not
        // vanish from the "lowest" list.
        $this->assertSame(count(config('barangays.entries')), count($data['barangays']));

        $silentRow = $this->rowFor($data, $silent->id);
        $this->assertSame(0, $silentRow['dispersed']);
        $this->assertSame(0, $silentRow['redispersed_out']);
        $this->assertSame(0, $silentRow['redispersed_in']);
        $this->assertSame(0, $silentRow['net_flow']);
        $this->assertNull($silentRow['redispersal_rate']);
        $this->assertFalse($silentRow['rate_eligible']);

        $lowest = collect($data['summary']['dispersed']['lowest']);
        $this->assertSame(0, $lowest->first()['value']);
        $this->assertContains($silent->name, $lowest->pluck('name')->all());
        $this->assertNotContains($silent->name, collect($data['summary']['dispersed']['highest'])->pluck('name')->all());
        $this->assertSame($busy->name, $data['summary']['dispersed']['highest'][0]['name']);
        $this->assertSame(2, $data['summary']['dispersed']['total']);
    }

    public function test_voided_events_are_excluded_everywhere(): void
    {
        $admin = $this->admin();
        $a = $this->barangay(0);
        $b = $this->barangay(1);

        $ownerA = $this->beneficiaryIn($a);
        $ownerB = $this->beneficiaryIn($b);

        $animal = $this->disperse($admin, $ownerA, now()->subDays(3), 'TAG-V');

        $redispersed = $this->redisperse($admin, $animal->id, $ownerB, now()->subDays(2));
        $redispersed->assertCreated();
        $eventId = $redispersed->json('data.id');

        $this->actingAs($admin)->postJson("/api/v1/ownership-events/{$eventId}/void", [
            'void_reason' => 'Wrong household.',
        ])->assertOk();

        $data = $this->analytics($admin);

        $this->assertSame(1, $this->rowFor($data, $a->id)['dispersed']);
        $this->assertSame(0, $this->rowFor($data, $a->id)['redispersed_out']);
        $this->assertSame(0, $this->rowFor($data, $b->id)['redispersed_in']);

        // ...and out of the flows too.
        $flows = $this->actingAs($admin)
            ->getJson('/api/v1/analytics/barangay-flows')
            ->assertOk()
            ->json('data.flows');
        $this->assertSame([], $flows);
    }

    public function test_events_snapshot_their_barangays_at_write_time(): void
    {
        $admin = $this->admin();
        $a = $this->barangay(0);
        $b = $this->barangay(1);
        $c = $this->barangay(2);

        $ownerA = $this->beneficiaryIn($a);
        $ownerB = $this->beneficiaryIn($b);
        $ownerC = $this->beneficiaryIn($c);

        $animal = $this->disperse($admin, $ownerA, now()->subDays(4), 'TAG-S1');
        $this->redisperse($admin, $animal->id, $ownerB, now()->subDays(3));

        $offspringResponse = $this->actingAs($admin)->postJson("/api/v1/animals/{$animal->id}/pass-ons", [
            'to_beneficiary_id' => $ownerC->id,
            'ear_tag_number' => 'TAG-S2',
            'event_date' => now()->subDays(2)->toDateString(),
        ]);
        $offspringResponse->assertCreated();
        $offspring = Animal::findOrFail($offspringResponse->json('data.animal_id'));
        $this->assertSame('TAG-S2', $offspring->ear_tag_number);

        $this->actingAs($admin)->postJson("/api/v1/animals/{$animal->id}/returns", [
            'base_event_id' => (int) DB::table('animal_ownership_events')
                ->where('animal_id', $animal->id)->where('status', 'active')
                ->orderByDesc('event_date')->orderByDesc('id')->value('id'),
            'event_date' => now()->subDay()->toDateString(),
        ])->assertCreated();

        $this->assertDatabaseHas('animal_ownership_events', [
            'event_type' => 'dispersal', 'to_beneficiary_id' => $ownerA->id,
            'from_barangay_id' => null, 'to_barangay_id' => $a->id,
        ]);
        $this->assertDatabaseHas('animal_ownership_events', [
            'event_type' => 're_dispersal', 'from_beneficiary_id' => $ownerA->id, 'to_beneficiary_id' => $ownerB->id,
            'from_barangay_id' => $a->id, 'to_barangay_id' => $b->id,
        ]);
        $this->assertDatabaseHas('animal_ownership_events', [
            'event_type' => 'pass_on', 'from_beneficiary_id' => $ownerB->id, 'to_beneficiary_id' => $ownerC->id,
            'from_barangay_id' => $b->id, 'to_barangay_id' => $c->id,
        ]);
        $this->assertDatabaseHas('animal_ownership_events', [
            'event_type' => 'return', 'from_beneficiary_id' => $ownerB->id,
            'from_barangay_id' => $b->id, 'to_barangay_id' => null,
        ]);

    }

    public function test_moving_a_beneficiary_to_another_barangay_does_not_rewrite_past_events(): void
    {
        $admin = $this->admin();
        $original = $this->barangay(0);
        $elsewhere = $this->barangay(1);

        $owner = $this->beneficiaryIn($original);
        $this->disperse($admin, $owner, now()->subDay(), 'TAG-M');

        // The household later moves (is edited) to a different barangay.
        $owner->update(['barangay_id' => $elsewhere->id, 'address' => $elsewhere->name]);

        $data = $this->analytics($admin);

        // History stays where it happened.
        $this->assertSame(1, $this->rowFor($data, $original->id)['dispersed']);
        $this->assertSame(0, $this->rowFor($data, $elsewhere->id)['dispersed']);
    }

    public function test_events_at_23_59_and_00_01_asia_manila_land_on_the_right_dates(): void
    {
        $admin = $this->admin();
        $a = $this->barangay(0);

        $night = Carbon::now('Asia/Manila')->subDays(2)->setTime(23, 59);
        $morning = Carbon::now('Asia/Manila')->subDay()->setTime(0, 1);

        $ownerA = $this->beneficiaryIn($a);
        $ownerB = $this->beneficiaryIn($this->barangay(1));

        $animal = $this->disperse($admin, $ownerA, $night, 'TAG-N1');
        $this->redisperse($admin, $animal->id, $ownerB, $morning);

        // The date column stores a datetime on SQLite, so compare calendar
        // days through the model's date cast.
        $dispersalEvent = \App\Models\AnimalOwnershipEvent::query()
            ->where('animal_id', $animal->id)->where('event_type', 'dispersal')->firstOrFail();
        $reDispersalEvent = \App\Models\AnimalOwnershipEvent::query()
            ->where('animal_id', $animal->id)->where('event_type', 're_dispersal')->firstOrFail();
        $this->assertSame($night->toDateString(), $dispersalEvent->event_date->toDateString());
        $this->assertSame($morning->toDateString(), $reDispersalEvent->event_date->toDateString());

        // Each calendar day counts exactly its own event.
        $onTheNight = $this->analytics($admin, ['from' => $night->toDateString(), 'to' => $night->toDateString()]);
        $this->assertSame(1, $this->rowFor($onTheNight, $a->id)['dispersed']);
        $this->assertSame(0, $this->rowFor($onTheNight, $a->id)['redispersed_out']);

        $afterMidnight = $this->analytics($admin, ['from' => $morning->toDateString(), 'to' => $morning->toDateString()]);
        $this->assertSame(0, $this->rowFor($afterMidnight, $a->id)['dispersed']);
        $this->assertSame(1, $this->rowFor($afterMidnight, $a->id)['redispersed_out']);
        $this->assertSame(1, $this->rowFor($afterMidnight, $this->barangay(1)->id)['redispersed_in']);
    }

    /* ------------------------------------------------------------------ *
     |  Same-barangay, distinct rate, ties, minimum                        |
     * ------------------------------------------------------------------ */

    public function test_same_barangay_re_dispersals_count_in_totals_but_never_as_cross_flows(): void
    {
        $admin = $this->admin();
        $a = $this->barangay(0);

        // Two households in the SAME barangay: the handover never crosses it.
        $first = $this->beneficiaryIn($a);
        $second = $this->beneficiaryIn($a);

        $animal = $this->disperse($admin, $first, now()->subDays(3), 'TAG-W');

        $this->redisperse($admin, $animal->id, $second, now()->subDays(2))->assertCreated();

        $data = $this->analytics($admin);
        $row = $this->rowFor($data, $a->id);

        $this->assertSame(1, $row['dispersed']);
        $this->assertSame(1, $row['redispersed_out']);
        $this->assertSame(1, $row['redispersed_in']);
        $this->assertSame(1, $row['within_barangay']);
        $this->assertSame(0, $row['net_flow']);

        $flows = $this->actingAs($admin)->getJson('/api/v1/analytics/barangay-flows')->assertOk()->json('data.flows');
        $this->assertCount(1, $flows);
        $this->assertTrue($flows[0]['within_barangay']);
        $this->assertSame($a->id, $flows[0]['origin_barangay_id']);
        $this->assertSame($a->id, $flows[0]['destination_barangay_id']);
    }

    public function test_an_animal_re_dispersed_twice_counts_once_in_the_distinct_rate(): void
    {
        $admin = $this->admin();
        $a = $this->barangay(0);
        $b = $this->barangay(1);

        $ownerA = $this->beneficiaryIn($a);
        $ownerB = $this->beneficiaryIn($b);

        // Five animals dispersed into A — exactly the default minimum.
        $animal = null;
        for ($i = 1; $i <= 5; $i++) {
            $animal = $this->disperse($admin, $ownerA, now()->subDays(20), "TAG-R{$i}");
        }

        // The SAME animal leaves A twice (A→B, B→A, A→B): two out-events,
        // one distinct animal.
        $this->redisperse($admin, $animal->id, $ownerB, now()->subDays(15));
        $this->redisperse($admin, $animal->id, $ownerA, now()->subDays(10));
        $this->redisperse($admin, $animal->id, $ownerB, now()->subDays(5));

        $data = $this->analytics($admin);
        $row = $this->rowFor($data, $a->id);

        $this->assertSame(5, $row['dispersed']);
        $this->assertSame(2, $row['redispersed_out']);
        $this->assertSame(1, $row['redispersed_in']);
        $this->assertSame(1, $row['distinct_redispersed_out']);
        $this->assertSame(0.2, $row['redispersal_rate']);
        $this->assertTrue($row['rate_eligible']);
    }

    public function test_ties_produce_all_tied_barangays_in_the_summary(): void
    {
        $admin = $this->admin();
        $a = $this->barangay(0);
        $b = $this->barangay(1);

        $this->disperse($admin, $this->beneficiaryIn($a), now()->subDay(), 'TAG-T1');
        $this->disperse($admin, $this->beneficiaryIn($a), now()->subDay(), 'TAG-T2');
        $this->disperse($admin, $this->beneficiaryIn($b), now()->subDay(), 'TAG-T3');
        $this->disperse($admin, $this->beneficiaryIn($b), now()->subDay(), 'TAG-T4');

        $highest = collect($this->analytics($admin)['summary']['dispersed']['highest']);

        $this->assertSame(2, $highest->count());
        $this->assertSame([$a->name, $b->name], $highest->pluck('name')->sort()->values()->all());
        $this->assertSame(2, $highest->first()['value']);

        // Every other barangay is tied at zero at the bottom.
        $lowest = collect($this->analytics($admin)['summary']['dispersed']['lowest']);
        $this->assertSame(count(config('barangays.entries')) - 2, $lowest->count());
    }

    public function test_a_barangay_below_the_minimum_is_excluded_from_rate_ranking(): void
    {
        $admin = $this->admin();
        $a = $this->barangay(0);
        $b = $this->barangay(1);

        $ownerA = $this->beneficiaryIn($a);
        $ownerB = $this->beneficiaryIn($b);

        // Three dispersals into A (below the default minimum of 5), one of
        // them re-dispersed out: a raw rate would read a misleading 33%.
        for ($i = 1; $i <= 3; $i++) {
            $animal = $this->disperse($admin, $ownerA, now()->subDays(10), "TAG-M{$i}");
        }

        // Enough dispersals into B to rank its (zero) rate.
        for ($i = 1; $i <= 5; $i++) {
            $this->disperse($admin, $ownerB, now()->subDays(10), "TAG-N{$i}");
        }

        $this->redisperse($admin, $animal->id, $ownerB, now()->subDays(5));

        $data = $this->analytics($admin);
        $rowA = $this->rowFor($data, $a->id);

        $this->assertSame(3, $rowA['distinct_dispersed']);
        $this->assertFalse($rowA['rate_eligible']);
        $this->assertNull($rowA['redispersal_rate']);

        // A is not ranked; B is, at rate zero, as the lowest.
        $this->assertNotContains($a->name, collect($data['summary']['redispersal_rate']['highest'])->pluck('name')->all());
        $this->assertNotContains($a->name, collect($data['summary']['redispersal_rate']['lowest'])->pluck('name')->all());
        $this->assertContains($b->name, collect($data['summary']['redispersal_rate']['lowest'])->pluck('name')->all());
        $this->assertStringContainsString('n < 5', $data['summary']['redispersal_rate']['sentence']);
    }

    /* ------------------------------------------------------------------ *
     |  Scoping, filters, per-1,000, flows                                 |
     * ------------------------------------------------------------------ */

    public function test_a_technician_sees_only_their_scoped_numbers(): void
    {
        $admin = $this->admin();
        $technician = User::factory()->create(['role' => 'technician']);

        $mine = $this->barangay(0);
        $theirs = $this->barangay(1);

        // The technician is assigned only to the household in $mine.
        $assigned = $this->beneficiaryIn($mine, $technician);
        $unassigned = $this->beneficiaryIn($theirs);

        $this->disperse($admin, $assigned, now()->subDay(), 'TAG-SC1');
        $this->disperse($admin, $unassigned, now()->subDay(), 'TAG-SC2');

        $data = $this->analytics($technician);

        $this->assertTrue($data['scoped']);
        $this->assertSame(1, $this->rowFor($data, $mine->id)['dispersed']);
        $this->assertSame(0, $this->rowFor($data, $theirs->id)['dispersed']);
        $this->assertSame(1, $data['summary']['dispersed']['total']);

        // The admin's own view of the same period is city-wide.
        $adminData = $this->analytics($admin);
        $this->assertFalse($adminData['scoped']);
        $this->assertSame(1, $this->rowFor($adminData, $theirs->id)['dispersed']);
        $this->assertSame(2, $adminData['summary']['dispersed']['total']);
    }

    public function test_filters_narrow_the_answer(): void
    {
        $admin = $this->admin();
        $a = $this->barangay(0);
        $b = $this->barangay(1);

        $ownerA = $this->beneficiaryIn($a);
        $ownerB = $this->beneficiaryIn($b);

        $animal = $this->disperse($admin, $ownerA, now()->subDays(5), 'TAG-F1');
        $this->redisperse($admin, $animal->id, $ownerB, now()->subDays(2));

        // Only the dispersal: the re-dispersal metrics go to zero and the
        // flows disappear with them.
        $dispersalsOnly = $this->analytics($admin, ['event_types' => ['dispersal']]);
        $this->assertSame(1, $this->rowFor($dispersalsOnly, $a->id)['dispersed']);
        $this->assertSame(0, $this->rowFor($dispersalsOnly, $a->id)['redispersed_out']);
        $this->assertSame(0, $this->rowFor($dispersalsOnly, $b->id)['redispersed_in']);

        $flows = $this->actingAs($admin)
            ->getJson('/api/v1/analytics/barangay-flows?'.http_build_query(['event_types' => ['dispersal']]))
            ->assertOk()
            ->json('data.flows');
        $this->assertSame([], $flows);

        // The animal-type filter reaches the events through the animals.
        $swine = $this->analytics($admin, ['animal_type_id' => $this->animalTypeId()]);
        $this->assertSame(1, $this->rowFor($swine, $a->id)['dispersed']);

        $otherType = \App\Models\AnimalType::query()->where('name', '!=', 'Swine (Pig)')->firstOrFail();
        $filtered = $this->analytics($admin, ['animal_type_id' => $otherType->id]);
        $this->assertSame(0, $this->rowFor($filtered, $a->id)['dispersed']);
    }

    public function test_population_powers_the_per_1000_variants(): void
    {
        $admin = $this->admin();
        $a = $this->barangay(0);

        $this->actingAs($admin)->patchJson("/api/v1/admin/barangays/{$a->id}", [
            'population' => 1000,
        ])->assertOk();

        $this->disperse($admin, $this->beneficiaryIn($a), now()->subDay(), 'TAG-P1');
        $this->disperse($admin, $this->beneficiaryIn($a), now()->subDay(), 'TAG-P2');

        $data = $this->analytics($admin);
        $row = $this->rowFor($data, $a->id);

        $this->assertSame(2, $row['dispersed']);
        $this->assertEqualsWithDelta(2.0, $row['dispersed_per_1000'], 0.0001);
        $this->assertNull($this->rowFor($data, $this->barangay(1)->id)['dispersed_per_1000']);
    }

    public function test_the_minimum_rate_setting_is_a_policy_number_the_office_owns(): void
    {
        $admin = $this->admin();
        $a = $this->barangay(0);

        $ownerA = $this->beneficiaryIn($a);
        $ownerB = $this->beneficiaryIn($this->barangay(1));

        for ($i = 1; $i <= 3; $i++) {
            $animal = $this->disperse($admin, $ownerA, now()->subDays(10), "TAG-X{$i}");
        }
        $this->redisperse($admin, $animal->id, $ownerB, now()->subDays(5));

        // At the default minimum of 5, A's 1-of-3 stays unranked...
        $data = $this->analytics($admin);
        $this->assertNull($this->rowFor($data, $a->id)['redispersal_rate']);

        // ...and the admin lowering the floor to 3 ranks it (1/3).
        $this->actingAs($admin)->patchJson('/api/v1/admin/settings', [
            'analytics_min_rate_animals' => 3,
        ])->assertOk();

        $relaxed = $this->analytics($admin);
        $this->assertSame(3, $relaxed['min_rate_animals']);
        $this->assertEqualsWithDelta(0.3333, $this->rowFor($relaxed, $a->id)['redispersal_rate'], 0.0001);
    }

    public function test_flows_offer_the_cvo_source_as_a_toggle(): void
    {
        $admin = $this->admin();
        $a = $this->barangay(0);
        $b = $this->barangay(1);

        $ownerA = $this->beneficiaryIn($a);
        $ownerB = $this->beneficiaryIn($b);

        $animal = $this->disperse($admin, $ownerA, now()->subDays(5), 'TAG-C1');
        $this->disperse($admin, $ownerB, now()->subDays(5), 'TAG-C2');
        $this->redisperse($admin, $animal->id, $ownerB, now()->subDays(2));

        $withoutCvo = $this->actingAs($admin)->getJson('/api/v1/analytics/barangay-flows')->assertOk()->json('data.flows');
        $this->assertCount(1, $withoutCvo);
        $this->assertSame($a->id, $withoutCvo[0]['origin_barangay_id']);
        $this->assertSame($b->id, $withoutCvo[0]['destination_barangay_id']);

        $withCvo = $this->actingAs($admin)
            ->getJson('/api/v1/analytics/barangay-flows?include_cvo=1')
            ->assertOk()
            ->json('data.flows');

        // The barangay→barangay handover, plus one CVO→barangay row per
        // initial dispersal (two of them).
        $this->assertCount(3, $withCvo);
        $this->assertSame(2, collect($withCvo)->filter(fn (array $flow) => $flow['origin_barangay_id'] === null)->count());
        $this->assertSame(
            1,
            collect($withCvo)->filter(fn (array $flow) => $flow['within_barangay'] === false && $flow['origin_barangay_id'] !== null)->count(),
        );
    }

    public function test_the_excel_export_streams_a_workbook(): void
    {
        $admin = $this->admin();
        $a = $this->barangay(0);

        $this->disperse($admin, $this->beneficiaryIn($a), now()->subDay(), 'TAG-E1');

        $response = $this->actingAs($admin)->get('/api/v1/analytics/barangay-dispersal/export');
        $response->assertOk();
        $this->assertSame(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            $response->headers->get('Content-Type'),
        );
    }

    /* ------------------------------------------------------------------ *
     |  Backfill                                                           |
     * ------------------------------------------------------------------ */

    public function test_the_backfill_command_snapshots_existing_events_idempotently(): void
    {
        $admin = $this->admin();
        $a = $this->barangay(0);
        $b = $this->barangay(1);
        $moved = $this->barangay(2);

        $ownerA = $this->beneficiaryIn($a);
        $ownerB = $this->beneficiaryIn($b);

        $animal = $this->disperse($admin, $ownerA, now()->subDays(3), 'TAG-B1');
        $this->redisperse($admin, $animal->id, $ownerB, now()->subDays(2));

        // Simulate rows written before the snapshot columns existed.
        DB::table('animal_ownership_events')->update(['from_barangay_id' => null, 'to_barangay_id' => null]);

        // The dry run writes nothing.
        $this->artisan('ownership:backfill-barangays', ['--dry-run' => true])->assertSuccessful();
        $this->assertDatabaseHas('animal_ownership_events', [
            'event_type' => 'dispersal', 'to_barangay_id' => null,
        ]);

        // The household receiving the re-dispersal has since been edited onto
        // another barangay: the backfill records what the household says NOW
        // — the best information that exists for history.
        $ownerB->update(['barangay_id' => $moved->id]);

        $this->artisan('ownership:backfill-barangays')->assertSuccessful();

        $this->assertDatabaseHas('animal_ownership_events', [
            'event_type' => 'dispersal', 'to_beneficiary_id' => $ownerA->id,
            'from_barangay_id' => null, 'to_barangay_id' => $a->id,
        ]);
        $this->assertDatabaseHas('animal_ownership_events', [
            'event_type' => 're_dispersal',
            'from_barangay_id' => $a->id, 'to_barangay_id' => $moved->id,
        ]);

        // Idempotent: a re-run has nothing left to fill.
        $this->artisan('ownership:backfill-barangays')->assertSuccessful();
        $this->assertDatabaseHas('animal_ownership_events', [
            'event_type' => 'dispersal', 'to_barangay_id' => $a->id,
        ]);

        // An event whose household has no barangay is reported, not guessed.
        $orphan = $this->beneficiaryIn($a);
        $orphan->update(['barangay_id' => null]);
        $animal2 = $this->disperse($admin, $orphan, now()->subDay(), 'TAG-B2');
        DB::table('animal_ownership_events')->where('animal_id', $animal2->id)->update(['to_barangay_id' => null]);

        $this->artisan('ownership:backfill-barangays')->assertSuccessful();
        $this->assertDatabaseHas('animal_ownership_events', [
            'animal_id' => $animal2->id, 'to_barangay_id' => null,
        ]);
    }
}
