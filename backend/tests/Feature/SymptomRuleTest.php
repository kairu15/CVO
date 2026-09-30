<?php

namespace Tests\Feature;

use App\Models\SymptomRule;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Rule-Based Health Concern Hints — the admin-editable lookup table.
 *
 * The entry forms read the active rules and match in the browser; this covers
 * the API half: admins own the rules, everyone signed in can read the active
 * set, and the server normalizes what an admin types.
 */
class SymptomRuleTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    public function test_admins_see_every_rule_including_retired_ones(): void
    {
        SymptomRule::factory()->create(['label' => 'Live']);
        SymptomRule::factory()->inactive()->create(['label' => 'Retired']);

        $this->actingAs($this->admin())
            ->getJson('/api/v1/admin/symptom-rules')
            ->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_an_admin_can_create_a_rule_and_keywords_are_normalized(): void
    {
        $response = $this->actingAs($this->admin())
            ->postJson('/api/v1/admin/symptom-rules', [
                'label' => 'Digestive upset',
                'keywords' => ['  diarrhea  ', 'diarrhea', '', 'loose stool'],
                'hint' => 'Consider checking for dehydration.',
                'animal_type' => '',
                'sort_order' => 10,
            ])
            ->assertCreated();

        $response->assertJsonPath('data.label', 'Digestive upset');
        $response->assertJsonPath('data.keywords', ['diarrhea', 'loose stool']);
        $response->assertJsonPath('data.animal_type', null);
    }

    public function test_a_non_admin_cannot_change_rules(): void
    {
        $doctor = User::factory()->create(['role' => 'doctor']);

        $this->actingAs($doctor)
            ->postJson('/api/v1/admin/symptom-rules', [
                'label' => 'Sneaky',
                'keywords' => ['x'],
                'hint' => 'nope',
            ])
            ->assertForbidden();

        $this->assertDatabaseMissing('symptom_rules', ['label' => 'Sneaky']);
    }

    public function test_a_rule_requires_a_label_keywords_and_a_hint(): void
    {
        $this->actingAs($this->admin())
            ->postJson('/api/v1/admin/symptom-rules', ['label' => '', 'keywords' => [], 'hint' => ''])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['label', 'keywords', 'hint']);
    }

    public function test_an_admin_can_deactivate_a_rule(): void
    {
        $rule = SymptomRule::factory()->create(['is_active' => true]);

        $this->actingAs($this->admin())
            ->patchJson("/api/v1/admin/symptom-rules/{$rule->id}", ['is_active' => false])
            ->assertOk()
            ->assertJsonPath('data.is_active', false);

        $this->assertFalse($rule->refresh()->is_active);
    }

    public function test_an_admin_can_delete_a_rule(): void
    {
        $rule = SymptomRule::factory()->create();

        $this->actingAs($this->admin())
            ->deleteJson("/api/v1/admin/symptom-rules/{$rule->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('symptom_rules', ['id' => $rule->id]);
    }

    public function test_staff_can_read_only_the_active_rules_in_display_order(): void
    {
        SymptomRule::factory()->create(['label' => 'Second', 'sort_order' => 20]);
        SymptomRule::factory()->create(['label' => 'First', 'sort_order' => 10]);
        SymptomRule::factory()->inactive()->create(['label' => 'Retired']);

        $response = $this->actingAs(User::factory()->create(['role' => 'doctor']))
            ->getJson('/api/v1/symptom-rules')
            ->assertOk()
            ->assertJsonCount(2, 'data');

        $this->assertSame('First', $response->json('data.0.label'));
        $this->assertSame('Second', $response->json('data.1.label'));
    }

    public function test_the_active_rules_require_authentication(): void
    {
        $this->getJson('/api/v1/symptom-rules')->assertUnauthorized();
    }
}
