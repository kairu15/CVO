<?php

namespace Tests\Feature;

use App\Models\AnimalClassification;
use App\Models\AnimalType;
use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The CVO animal master list: the shipped seed, the admin CRUD, the cascading
 * pair every animal write validates, the monitoring filter, and the legacy
 * mapping report.
 */
class AnimalTypeMasterListTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->create(['role' => 'admin']);
    }

    public function test_guests_cannot_read_the_master_list(): void
    {
        $this->getJson('/api/v1/animal-types')->assertUnauthorized();
    }

    public function test_the_master_list_is_grouped_by_main_category_with_the_full_seed(): void
    {
        $response = $this->actingAs($this->admin)
            ->getJson('/api/v1/animal-types')
            ->assertOk();

        $groups = $response->json('data');

        $this->assertSame(['livestock', 'poultry', 'other'], array_column($groups, 'key'));
        $this->assertSame('Other Farm Animals', $groups[2]['label']);

        // The complete supplied list: 15 + 14 + 6 types.
        $this->assertSame(35, AnimalType::query()->count());
        $this->assertSame(15, count($groups[0]['animal_types']));
        $this->assertSame(14, count($groups[1]['animal_types']));
        $this->assertSame(6, count($groups[2]['animal_types']));

        // Swine keeps its own classifications, in the supplied order.
        $swine = collect($groups[0]['animal_types'])->firstWhere('name', 'Swine (Pig)');
        $this->assertNotNull($swine);
        $this->assertSame(
            ['Boar', 'Sow', 'Gilt', 'Barrow', 'Piglet', 'Feeder pig'],
            array_column($swine['classifications'], 'name'),
        );
        // The alias the table is named after is present too.
        $this->assertSame(
            array_column($swine['classifications'], 'name'),
            array_column($swine['animal_classifications'], 'name'),
        );
    }

    public function test_only_an_admin_can_manage_the_list(): void
    {
        $doctor = User::factory()->create(['role' => 'doctor']);

        $this->actingAs($doctor)
            ->postJson('/api/v1/admin/animal-types', [
                'main_category' => 'other',
                'name' => 'Wildebeest',
            ])
            ->assertForbidden();
    }

    public function test_an_admin_can_add_rename_reorder_and_remove_an_unused_type(): void
    {
        $created = $this->actingAs($this->admin)
            ->postJson('/api/v1/admin/animal-types', [
                'main_category' => 'other',
                'name' => 'Wildebeest',
            ])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Wildebeest')
            ->assertJsonPath('data.main_category', 'other');

        $id = $created->json('data.id');

        $this->actingAs($this->admin)
            ->patchJson("/api/v1/admin/animal-types/{$id}", ['name' => 'Wild Beast'])
            ->assertOk()
            ->assertJsonPath('data.name', 'Wild Beast');

        // A classification belongs to exactly one type.
        $classification = $this->actingAs($this->admin)
            ->postJson("/api/v1/admin/animal-types/{$id}/classifications", ['name' => 'Bull'])
            ->assertCreated()
            ->assertJsonPath('data.animal_type_id', $id);

        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/animal-classifications/'.$classification->json('data.id'), [
                'name' => 'Adult male',
            ])
            ->assertOk()
            ->assertJsonPath('data.name', 'Adult male');

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/admin/animal-classifications/".$classification->json('data.id'))
            ->assertNoContent();

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/admin/animal-types/{$id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('animal_types', ['id' => $id]);
    }

    public function test_a_type_still_recorded_on_an_animal_cannot_be_removed(): void
    {
        $cattle = AnimalType::query()->where('name', 'Cattle')->firstOrFail();

        Beneficiary::factory()->create([
            'animal_type' => 'Cattle',
            'animal_type_id' => $cattle->id,
        ]);

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/admin/animal-types/{$cattle->id}")
            ->assertUnprocessable();

        $this->assertDatabaseHas('animal_types', ['id' => $cattle->id]);
    }

    public function test_a_classification_must_belong_to_the_chosen_type(): void
    {
        $goat = AnimalType::query()->where('name', 'Goat')->firstOrFail();
        $kid = AnimalClassification::query()
            ->where('animal_type_id', $goat->id)
            ->where('name', 'Kid')
            ->firstOrFail();
        $boar = AnimalClassification::query()
            ->whereHas('animalType', fn ($q) => $q->where('name', 'Swine (Pig)'))
            ->where('name', 'Boar')
            ->firstOrFail();

        $payload = [
            'name_of_farmer' => 'Juan Dela Cruz',
            'address' => 'Dawis',
            'animal_type' => 'Goat',
            'sex' => 'F',
        ];

        $this->actingAs($this->admin)
            ->postJson('/api/v1/beneficiaries', [...$payload, 'classification_id' => $boar->id])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['classification_id']);

        $this->actingAs($this->admin)
            ->postJson('/api/v1/beneficiaries', [...$payload, 'classification_id' => $kid->id])
            ->assertCreated()
            ->assertJsonPath('data.animal_type_id', $goat->id)
            ->assertJsonPath('data.classification_id', $kid->id)
            ->assertJsonPath('data.animal_classification', 'Kid');

        $this->assertDatabaseHas('beneficiaries', [
            'name_of_farmer' => 'Juan Dela Cruz',
            'animal_type_id' => $goat->id,
            'classification_id' => $kid->id,
        ]);
    }

    public function test_changing_the_type_without_a_new_classification_clears_the_old_pair(): void
    {
        $swine = AnimalType::query()->where('name', 'Swine (Pig)')->firstOrFail();
        $boar = AnimalClassification::query()
            ->where('animal_type_id', $swine->id)
            ->where('name', 'Boar')
            ->firstOrFail();

        $beneficiary = Beneficiary::factory()->create([
            'animal_type' => 'Swine (Pig)',
            'animal_type_id' => $swine->id,
            'classification_id' => $boar->id,
        ]);

        $this->actingAs($this->admin)
            ->patchJson("/api/v1/beneficiaries/{$beneficiary->id}", ['animal_type' => 'Goat'])
            ->assertOk()
            ->assertJsonPath('data.classification_id', null)
            ->assertJsonPath('data.animal_type_id', AnimalType::where('name', 'Goat')->value('id'));
    }

    public function test_monitoring_records_can_be_filtered_by_animal_type_and_classification(): void
    {
        $swine = AnimalType::query()->where('name', 'Swine (Pig)')->firstOrFail();
        $boar = AnimalClassification::query()
            ->where('animal_type_id', $swine->id)
            ->where('name', 'Boar')
            ->firstOrFail();
        $sow = AnimalClassification::query()
            ->where('animal_type_id', $swine->id)
            ->where('name', 'Sow')
            ->firstOrFail();
        $goat = AnimalType::query()->where('name', 'Goat')->firstOrFail();

        $boarAnimal = Beneficiary::factory()->create([
            'name_of_farmer' => 'Boar Keeper',
            'animal_type' => 'Swine (Pig)',
            'animal_type_id' => $swine->id,
            'classification_id' => $boar->id,
        ]);
        $sowAnimal = Beneficiary::factory()->create([
            'name_of_farmer' => 'Sow Keeper',
            'animal_type' => 'Swine (Pig)',
            'animal_type_id' => $swine->id,
            'classification_id' => $sow->id,
        ]);
        $goatAnimal = Beneficiary::factory()->create([
            'name_of_farmer' => 'Goat Keeper',
            'animal_type' => 'Goat',
            'animal_type_id' => $goat->id,
        ]);

        MonitoringRecord::factory()->for($boarAnimal, 'beneficiary')->create();
        MonitoringRecord::factory()->for($sowAnimal, 'beneficiary')->create();
        MonitoringRecord::factory()->for($goatAnimal, 'beneficiary')->create();

        $names = fn (array $query) => collect(
            $this->actingAs($this->admin)
                ->getJson('/api/v1/monitoring-records?per_page=100&'.http_build_query($query))
                ->assertOk()
                ->json('data'),
        )->pluck('name_of_farmer')->sort()->values()->all();

        $this->assertSame(
            ['Boar Keeper', 'Sow Keeper'],
            $names(['animal_type_id' => $swine->id]),
        );
        $this->assertSame(
            ['Boar Keeper'],
            $names(['animal_type_id' => $swine->id, 'classification_id' => $boar->id]),
        );

        // The response carries the pair for the table.
        $record = $this->actingAs($this->admin)
            ->getJson('/api/v1/monitoring-records?per_page=100&classification_id='.$boar->id)
            ->assertOk()
            ->json('data.0');

        $this->assertSame('Boar', $record['animal_classification']);
        $this->assertSame($swine->id, $record['animal_type_id']);
    }

    public function test_the_mapping_report_lists_legacy_values_and_applies_only_confident_matches(): void
    {
        $cattle = Beneficiary::factory()->create(['animal_type' => 'Cattle']);
        // "Boar" is a classification under two types — ambiguous on purpose.
        $ambiguous = Beneficiary::factory()->create(['animal_type' => 'Boar']);
        $unknown = Beneficiary::factory()->create(['animal_type' => 'Wildebeest']);

        $this->artisan('animal-types:mapping-report')
            ->expectsOutputToContain('Ambiguous')
            ->expectsOutputToContain('Wildebeest')
            ->assertSuccessful();

        // Reported, not guessed.
        $this->assertNull($cattle->fresh()->animal_type_id);

        $this->artisan('animal-types:mapping-report', ['--apply' => true])
            ->assertSuccessful();

        $this->assertSame(
            AnimalType::query()->where('name', 'Cattle')->value('id'),
            $cattle->fresh()->animal_type_id,
        );
        $this->assertNull($ambiguous->fresh()->animal_type_id);
        $this->assertNull($unknown->fresh()->animal_type_id);
    }
}
