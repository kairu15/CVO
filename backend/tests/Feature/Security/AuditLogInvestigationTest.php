<?php

namespace Tests\Feature\Security;

use App\Models\ActivityLog;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * The audit screen's investigation contract: inclusive dates, derived
 * status/module filters, overview figures, lazy detail, streamed export and
 * the append-only model guard.
 */
class AuditLogInvestigationTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->create(['role' => 'admin']);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_date_to_includes_the_selected_day(): void
    {
        Carbon::setTestNow('2026-11-19 15:30:00');

        ActivityLog::create([
            'actor_id' => $this->admin->id,
            'actor_role' => 'admin',
            'action' => 'login',
        ]);

        $response = $this->actingAs($this->admin)
            ->getJson("/api/v1/admin/activity-logs?actor_id={$this->admin->id}&date_from=2026-11-19&date_to=2026-11-19")
            ->assertOk();

        $this->assertCount(1, $response->json('data'));
    }

    public function test_status_and_module_filters_are_derived_consistently(): void
    {
        ActivityLog::create([
            'actor_id' => $this->admin->id,
            'actor_role' => 'admin',
            'action' => 'failed_login',
        ]);
        ActivityLog::create([
            'actor_id' => $this->admin->id,
            'actor_role' => 'admin',
            'action' => 'permissions_updated',
        ]);

        $failed = $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/activity-logs?status=failed')
            ->assertOk();
        $this->assertSame(['failed_login'], collect($failed->json('data'))->pluck('action')->all());
        $this->assertSame('failed', $failed->json('data.0.status'));

        $security = $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/activity-logs?status=security')
            ->assertOk();
        $this->assertContains('permissions_updated', collect($security->json('data'))->pluck('action'));

        $access = $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/activity-logs?module=access_control')
            ->assertOk();
        $this->assertSame(
            ['permissions_updated'],
            collect($access->json('data'))->pluck('action')->all(),
        );
        $this->assertSame('access_control', $access->json('data.0.module'));
    }

    public function test_summary_reports_totals_logins_failures_and_critical_actions(): void
    {
        foreach (['login', 'token_issued', 'failed_login', 'permissions_updated', 'exported'] as $action) {
            ActivityLog::create([
                'actor_id' => $this->admin->id,
                'actor_role' => 'admin',
                'action' => $action,
            ]);
        }

        $response = $this->actingAs($this->admin)
            ->getJson("/api/v1/admin/activity-logs/summary?actor_id={$this->admin->id}")
            ->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'total', 'today', 'logins', 'failed_logins', 'critical',
                    'latest_at', 'security' => [
                        'failed_logins_24h', 'locked_accounts_24h', 'repeat_sources_24h',
                    ],
                ],
            ]);

        $this->assertSame(5, $response->json('data.total'));
        $this->assertSame(2, $response->json('data.logins'));
        $this->assertSame(1, $response->json('data.failed_logins'));
        $this->assertSame(2, $response->json('data.critical'));
    }

    public function test_summary_and_filters_require_the_audit_capability(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($technician)
            ->getJson('/api/v1/admin/activity-logs/summary')
            ->assertForbidden();

        // The refusal itself is on the trail (one row, throttled).
        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $technician->id,
            'action' => 'access_denied',
        ]);
    }

    public function test_detail_returns_the_diff_while_the_summary_list_does_not(): void
    {
        $row = ActivityLog::create([
            'actor_id' => $this->admin->id,
            'actor_role' => 'admin',
            'action' => 'permissions_updated',
            'old_values' => ['granted' => false],
            'new_values' => ['granted' => true],
        ]);

        $detail = $this->actingAs($this->admin)
            ->getJson("/api/v1/admin/activity-logs/{$row->id}")
            ->assertOk();

        $this->assertSame(['granted' => false], $detail->json('data.old_values'));
        $this->assertSame(['granted' => true], $detail->json('data.new_values'));

        $summary = $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/activity-logs?summary=1')
            ->assertOk();

        $this->assertArrayNotHasKey('old_values', $summary->json('data.0'));
        $this->assertTrue($summary->json('data.0.has_diff'));
    }

    public function test_actor_identity_is_snapshotted_and_survives_deactivation(): void
    {
        $technician = User::factory()->create(['role' => 'technician', 'name' => 'Field Tech']);

        app(AuditLogger::class)->log($technician, 'login');

        $technician->delete();

        $row = ActivityLog::query()->where('action', 'login')->firstOrFail();
        $this->assertSame('Field Tech', $row->actor_name);
        $this->assertSame($technician->email, $row->actor_email);

        $detail = $this->actingAs($this->admin)
            ->getJson("/api/v1/admin/activity-logs/{$row->id}")
            ->assertOk();

        $this->assertSame('Field Tech', $detail->json('data.actor_name'));
        $this->assertTrue($detail->json('data.actor.deactivated'));
    }

    public function test_export_streams_filtered_csv_and_audits_the_export(): void
    {
        ActivityLog::create([
            'actor_id' => $this->admin->id,
            'actor_role' => 'admin',
            'action' => 'login',
        ]);

        $response = $this->actingAs($this->admin)
            ->get('/api/v1/admin/activity-logs/export')
            ->assertOk();

        $csv = $response->streamedContent();
        $this->assertStringContainsString('id,created_at,actor_name', $csv);
        $this->assertStringContainsString('login', $csv);
        // The export's own audit row is written after this snapshot; it must
        // not appear inside the file it describes.
        $this->assertStringNotContainsString(',exported,', $csv);

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $this->admin->id,
            'action' => 'exported',
        ]);
    }

    public function test_audit_rows_are_immutable_at_the_model_layer(): void
    {
        $row = ActivityLog::create([
            'actor_id' => $this->admin->id,
            'actor_role' => 'admin',
            'action' => 'login',
        ]);

        $this->expectException(\RuntimeException::class);
        $row->update(['action' => 'logout']);
    }

    public function test_audit_rows_cannot_be_deleted_at_the_model_layer(): void
    {
        $row = ActivityLog::create([
            'actor_id' => $this->admin->id,
            'actor_role' => 'admin',
            'action' => 'login',
        ]);

        $this->expectException(\RuntimeException::class);
        $row->delete();
    }
}
