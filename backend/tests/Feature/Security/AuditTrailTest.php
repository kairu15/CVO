<?php

namespace Tests\Feature\Security;

use App\Models\ActivityLog;
use App\Models\Beneficiary;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use RuntimeException;
use Tests\TestCase;

/**
 * Section 1 — system-wide audit trail.
 *
 * The trail must be trustworthy rather than merely present: exactly one row
 * per change with the fields that changed, none for a change that rolled
 * back, no secrets ever, and the read endpoint closed to non-permitted roles.
 */
class AuditTrailTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->create(['role' => 'admin']);
    }

    public function test_one_change_writes_exactly_one_row_with_its_old_and_new_values(): void
    {
        $beneficiary = Beneficiary::factory()->create(['name_of_farmer' => 'Juan Dela Cruz']);

        $this->actingAs($this->admin)
            ->patchJson("/api/v1/beneficiaries/{$beneficiary->id}", [
                'name_of_farmer' => 'Juan C. Cruz',
            ])
            ->assertOk();

        $rows = ActivityLog::query()
            ->where('action', 'beneficiary_updated')
            ->where('target_type', 'Beneficiary')
            ->where('target_id', $beneficiary->id)
            ->get();

        // ONE row: the controller no longer writes its own log alongside the
        // model's Auditable row.
        $this->assertCount(1, $rows);

        $row = $rows->first();
        $this->assertSame($this->admin->id, $row->actor_id);
        $this->assertSame(['name_of_farmer' => 'Juan Dela Cruz'], $row->old_values);
        $this->assertSame(['name_of_farmer' => 'Juan C. Cruz'], $row->new_values);
    }

    public function test_a_rolled_back_change_leaves_no_audit_row(): void
    {
        $beneficiary = Beneficiary::factory()->create(['name_of_farmer' => 'Original Name']);

        $this->assertDatabaseMissing('activity_logs', [
            'action' => 'beneficiary_updated',
            'target_id' => $beneficiary->id,
        ]);

        try {
            DB::transaction(function () use ($beneficiary): void {
                $beneficiary->update(['name_of_farmer' => 'Rolled Back Name']);

                throw new RuntimeException('forced rollback');
            });
        } catch (RuntimeException) {
            // expected — the transaction rolled back.
        }

        $this->assertSame('Original Name', $beneficiary->fresh()?->name_of_farmer);

        // The row was written inside the same transaction, so it went too.
        $this->assertDatabaseMissing('activity_logs', [
            'action' => 'beneficiary_updated',
            'target_id' => $beneficiary->id,
        ]);
    }

    public function test_the_audit_endpoints_reject_non_permitted_roles(): void
    {
        foreach (['doctor', 'technician'] as $role) {
            $this->actingAs(User::factory()->create(['role' => $role]))
                ->getJson('/api/v1/admin/activity-logs')
                ->assertForbidden();

            $this->actingAs(User::factory()->create(['role' => $role]))
                ->getJson('/api/v1/admin/activity-logs/actions')
                ->assertForbidden();
        }

        $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/activity-logs')
            ->assertOk();

        $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/activity-logs/actions')
            ->assertOk()
            ->assertJsonStructure(['data' => ['actions', 'target_types', 'actors']]);
    }

    public function test_password_values_never_reach_a_log_row(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/v1/admin/users', [
                'name' => 'Doc Reyes',
                'email' => 'doc.reyes.audit@example.com',
                'role' => 'doctor',
                'password' => 'Str0ng!Pass',
                'password_confirmation' => 'Str0ng!Pass',
            ])
            ->assertCreated();

        $user = User::query()->where('email', 'doc.reyes.audit@example.com')->firstOrFail();

        foreach (ActivityLog::query()->get() as $row) {
            $payload = json_encode([
                'context' => $row->context,
                'old' => $row->old_values,
                'new' => $row->new_values,
            ]);

            $this->assertStringNotContainsString($user->password, (string) $payload);
            $this->assertStringNotContainsString('Str0ng!Pass', (string) $payload);
        }

        // The key survives (a password change still reads as one) with a
        // marker instead of the value.
        $created = ActivityLog::query()
            ->where('action', 'user_created')
            ->where('target_id', $user->id)
            ->first();

        $this->assertNotNull($created);
        $this->assertSame('[hidden]', $created->new_values['password'] ?? null);
    }

    public function test_rsbsa_numbers_are_masked_before_they_are_stored(): void
    {
        $beneficiary = Beneficiary::factory()->create([
            'rsbsa_number' => '12345678901234',
        ]);

        $row = ActivityLog::query()
            ->where('action', 'beneficiary_created')
            ->where('target_id', $beneficiary->id)
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('••••-••••-1234', $row->new_values['rsbsa_number'] ?? null);
        $this->assertStringNotContainsString(
            '12345678901234',
            (string) json_encode($row->new_values),
        );
    }

    public function test_exports_are_logged(): void
    {
        $this->actingAs($this->admin)
            ->get('/api/v1/admin/monitoring-records/export?month=2025-11')
            ->assertOk();

        $this->actingAs($this->admin)
            ->get('/api/v1/admin/report/export?barangay=Ali-is')
            ->assertOk();

        $exports = ActivityLog::query()->where('action', 'exported')->get();

        $this->assertSame(
            ['city_report', 'monitoring_workbook'],
            $exports->pluck('context.resource')->sort()->values()->all(),
        );

        $monitoring = $exports->firstWhere('context.resource', 'monitoring_workbook');
        $this->assertNotNull($monitoring);
        $this->assertSame($this->admin->id, $monitoring->actor_id);
        $this->assertSame('2025-11', $monitoring->context['filters']['month'] ?? null);
    }

    public function test_an_import_is_logged_with_its_row_counts(): void
    {
        $path = $this->workbook([
            ['Juan Dela Cruz', 'Ali-is', 'Cattle', 'M', 45979, null, null, null, null, null, 3, null, 'healthy'],
            ['Maria Santos', 'Poblacion', 'Carabao', 'F', 45980, null, null, null, null, null, 4, 'Maria S.', null],
        ]);

        $this->actingAs($this->admin)
            ->postJson('/api/v1/admin/monitoring-records/import', [
                'file' => new UploadedFile($path, 'report.xlsx', null, null, true),
            ])
            ->assertOk();

        $row = ActivityLog::query()->where('action', 'imported')->first();

        $this->assertNotNull($row);
        $this->assertSame($this->admin->id, $row->actor_id);
        $this->assertSame('monitoring_workbook', $row->context['resource'] ?? null);
        $this->assertSame(2, $row->context['rows_read'] ?? null);
        $this->assertSame(2, $row->context['records_created'] ?? null);
        $this->assertSame(2, $row->context['beneficiaries_created'] ?? null);
    }

    public function test_an_offline_replay_records_the_device_time_and_the_sync_time(): void
    {
        $beneficiary = Beneficiary::factory()->create(['name_of_farmer' => 'Field Visit Farm']);

        $this->actingAs($this->admin)
            ->withHeader('X-Offline-Queued-At', '2026-10-20T08:30:00.000Z')
            ->patchJson("/api/v1/beneficiaries/{$beneficiary->id}", [
                'name_of_farmer' => 'Field Visit Farm Inc.',
            ])
            ->assertOk();

        $row = ActivityLog::query()
            ->where('action', 'beneficiary_updated')
            ->where('target_id', $beneficiary->id)
            ->first();

        $this->assertNotNull($row);

        // When the technician actually recorded it (device)…
        $this->assertStringStartsWith('2026-10-20T08:30:00', $row->context['device_created_at'] ?? '');
        // …and when the server learned about it (sync). The row's own
        // created_at is the sync time, so the two never collapse into one.
        $this->assertNotEmpty($row->context['synced_at'] ?? null);

        // The same edit live (the header explicitly cleared) carries no
        // device timestamp — nothing is invented for an online request.
        $this->actingAs($this->admin)
            ->withHeader('X-Offline-Queued-At', '')
            ->patchJson("/api/v1/beneficiaries/{$beneficiary->id}", [
                'name_of_farmer' => 'Field Visit Farm Inc. II',
            ])
            ->assertOk();

        $plain = ActivityLog::query()
            ->where('action', 'beneficiary_updated')
            ->where('target_id', $beneficiary->id)
            ->where('id', '!=', $row->id)
            ->first();

        $this->assertNotNull($plain);
        $this->assertArrayNotHasKey('device_created_at', $plain->context ?? []);
    }

    public function test_the_trail_filters_by_entity_type_and_serves_the_diff(): void
    {
        $beneficiary = Beneficiary::factory()->create();

        $this->actingAs($this->admin)
            ->patchJson("/api/v1/beneficiaries/{$beneficiary->id}", ['address' => 'Poblacion'])
            ->assertOk();

        $response = $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/activity-logs?target_type=Beneficiary&action=beneficiary_updated')
            ->assertOk();

        $rows = $response->json('data');
        $this->assertNotEmpty($rows);

        foreach ($rows as $row) {
            $this->assertSame('Beneficiary', $row['target_type']);
            $this->assertSame('beneficiary_updated', $row['action']);
        }

        $diff = collect($rows)->firstWhere('target_id', $beneficiary->id);
        $this->assertNotNull($diff);
        $this->assertArrayHasKey('old_values', $diff);
        $this->assertArrayHasKey('new_values', $diff);
        $this->assertSame('Poblacion', $diff['new_values']['address'] ?? null);
    }

    /** A minimal workbook in the CVO monthly-report layout. */
    private function workbook(array $rows): string
    {
        $spreadsheet = new Spreadsheet;
        $sheet = $spreadsheet->getActiveSheet();
        $sheet->setCellValue('A1', 'LIVESTOCK MONTHLY MONITORING REPORT');
        $sheet->fromArray([
            'Name of Farmer', 'Address', 'Type of Animal dispersed', 'Sex',
            'Date monitored', ' Date of Vits Supp.', 'Deworming ', 'Vaccination',
            'Date Breed', 'Date Calved', 'Body Condition Score', 'Farmers Signature', 'Remarks',
        ], null, 'A2');

        $rowIndex = 3;
        foreach ($rows as $data) {
            $sheet->fromArray($data, null, 'A'.$rowIndex);
            $rowIndex++;
        }

        $path = storage_path('framework/testing/audit-excel-'.Str::uuid().'.xlsx');
        (new Xlsx($spreadsheet))->save($path);
        $spreadsheet->disconnectWorksheets();

        return $path;
    }
}
