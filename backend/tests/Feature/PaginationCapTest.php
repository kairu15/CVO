<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Pagination;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The system-wide pagination policy: every list endpoint defaults to 50 rows
 * per page, and never returns more than 50 whatever the caller asks for.
 *
 * Over-limit requests are CLAMPED rather than rejected, so a caller that used
 * to ask for 100–500 rows keeps working and simply pages through 50 at a time.
 */
class PaginationCapTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_support_helper_clamps_to_the_shared_bounds(): void
    {
        $this->assertSame(50, Pagination::DEFAULT_PER_PAGE);
        $this->assertSame(50, Pagination::MAX_PER_PAGE);

        // Absent, or not a number at all, is the default page.
        $this->assertSame(50, Pagination::perPage(null));
        $this->assertSame(50, Pagination::perPage('not-a-number'));

        // In-range values pass through; over-limit values are capped.
        $this->assertSame(10, Pagination::perPage(10));
        $this->assertSame(10, Pagination::perPage('10'));
        $this->assertSame(50, Pagination::perPage(50));
        $this->assertSame(50, Pagination::perPage(5000));

        // A positive-but-tiny value floors at one.
        $this->assertSame(1, Pagination::perPage(1));
        $this->assertSame(1, Pagination::perPage(0));
    }

    public function test_every_list_endpoint_defaults_to_a_fifty_row_page(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $endpoints = [
            '/api/v1/beneficiaries',
            '/api/v1/monitoring-records',
            '/api/v1/health-records',
            '/api/v1/case-notes',
            '/api/v1/field-visits',
            '/api/v1/dispersal-events',
            '/api/v1/projects',
            '/api/v1/vaccination-schedule',
            '/api/v1/animal-health',
            '/api/v1/notifications',
            '/api/v1/admin/users',
            '/api/v1/admin/beneficiaries',
            '/api/v1/admin/activity-logs',
        ];

        foreach ($endpoints as $endpoint) {
            $this->actingAs($admin)
                ->getJson($endpoint)
                ->assertOk()
                ->assertJsonPath('meta.per_page', 50, "{$endpoint} should default to 50 per page");
        }
    }

    public function test_an_over_limit_page_size_is_clamped_not_rejected(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $endpoints = [
            '/api/v1/beneficiaries',
            '/api/v1/monitoring-records',
            '/api/v1/health-records',
            '/api/v1/case-notes',
            '/api/v1/field-visits',
            '/api/v1/dispersal-events',
            '/api/v1/projects',
            '/api/v1/vaccination-schedule',
            '/api/v1/animal-health',
            '/api/v1/admin/users',
            '/api/v1/admin/beneficiaries',
            '/api/v1/admin/activity-logs',
        ];

        foreach ($endpoints as $endpoint) {
            $this->actingAs($admin)
                ->getJson($endpoint.'?per_page=500')
                ->assertOk()
                ->assertJsonPath('meta.per_page', 50, "{$endpoint} should clamp per_page to 50");
        }

        $this->actingAs($admin)
            ->getJson('/api/v1/notifications?per_page=500')
            ->assertOk()
            ->assertJsonPath('meta.per_page', 50);
    }
}
