<?php

namespace Tests\Feature;

use App\Models\Project;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ProjectTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create();
    }

    public function test_guests_cannot_list_projects(): void
    {
        $this->getJson('/api/v1/projects')->assertUnauthorized();
    }

    public function test_users_can_list_their_projects(): void
    {
        Project::factory()->count(3)->for($this->user)->create();
        Project::factory()->count(2)->create(); // another user's projects

        $response = $this->actingAs($this->user)->getJson('/api/v1/projects');

        $response->assertOk()
            ->assertJsonCount(3, 'data');
    }

    public function test_users_can_create_a_project(): void
    {
        $response = $this->actingAs($this->user)->postJson('/api/v1/projects', [
            'name' => 'CVO Platform',
            'description' => 'The main application.',
            'status' => 'active',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.name', 'CVO Platform')
            ->assertJsonPath('data.status', 'active');

        $this->assertDatabaseHas('projects', [
            'user_id' => $this->user->id,
            'name' => 'CVO Platform',
        ]);
    }

    public function test_create_validates_required_fields(): void
    {
        $response = $this->actingAs($this->user)->postJson('/api/v1/projects', [
            'description' => 'Missing a name.',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['name']);
    }

    public function test_create_validates_status_enum(): void
    {
        $response = $this->actingAs($this->user)->postJson('/api/v1/projects', [
            'name' => 'Invalid status',
            'status' => 'bogus',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);
    }

    public function test_owner_can_update_their_project(): void
    {
        $project = Project::factory()->for($this->user)->create();

        $response = $this->actingAs($this->user)->putJson("/api/v1/projects/{$project->id}", [
            'status' => 'completed',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.status', 'completed');

        $this->assertDatabaseHas('projects', [
            'id' => $project->id,
            'status' => 'completed',
        ]);
    }

    public function test_other_users_cannot_update_someone_elses_project(): void
    {
        $project = Project::factory()->create(); // owned by someone else

        $this->actingAs($this->user)
            ->putJson("/api/v1/projects/{$project->id}", ['name' => 'Hacked'])
            ->assertForbidden();
    }

    public function test_other_users_cannot_view_someone_elses_project(): void
    {
        $project = Project::factory()->create();

        $this->actingAs($this->user)
            ->getJson("/api/v1/projects/{$project->id}")
            ->assertForbidden();
    }

    public function test_owner_can_delete_their_project(): void
    {
        $project = Project::factory()->for($this->user)->create();

        $this->actingAs($this->user)
            ->deleteJson("/api/v1/projects/{$project->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('projects', ['id' => $project->id]);
    }
}
