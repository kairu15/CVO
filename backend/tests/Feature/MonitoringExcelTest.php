<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Tests\TestCase;

class MonitoringExcelTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->create(['role' => 'admin']);
    }

    /** A minimal workbook in the CVO monthly-report layout. */
    private function workbook(array $rows, string $headerBcs = 'Body Condition Score'): string
    {
        $spreadsheet = new Spreadsheet;
        $sheet = $spreadsheet->getActiveSheet();
        $sheet->setCellValue('A1', 'LIVESTOCK MONTHLY MONITORING REPORT');
        $sheet->fromArray([
            'Name of Farmer', 'Address', 'Type of Animal dispersed', 'Sex',
            'Date monitored', ' Date of Vits Supp.', 'Deworming ', 'Vaccination',
            'Date Breed', 'Date Calved', $headerBcs, 'Farmers Signature', 'Remarks',
        ], null, 'A2');

        $rowIndex = 3;
        foreach ($rows as $data) {
            $sheet->fromArray($data, null, 'A'.$rowIndex);
            $rowIndex++;
        }

        $path = storage_path('framework/testing/excel-'.Str::uuid().'.xlsx');
        (new Xlsx($spreadsheet))->save($path);
        $spreadsheet->disconnectWorksheets();

        return $path;
    }

    public function test_admin_can_import_a_monitoring_report_workbook(): void
    {
        // 45979 = 2025-11-18 and 45980 = 2025-11-19 as Excel serial dates.
        $path = $this->workbook([
            ['Juan Dela Cruz', 'Ali-is', 'Cattle', 'M', 45979, 45979, null, null, null, null, 3, null, 'healthy'],
            ['Maria Santos', 'Poblacion', 'Carabao', 'F', 45980, null, null, null, null, null, 4, 'Maria S.', null],
        ]);

        $response = $this->actingAs($this->admin)
            ->postJson('/api/v1/admin/monitoring-records/import', [
                'file' => new UploadedFile($path, 'report.xlsx', null, null, true),
            ]);

        $response->assertOk()
            ->assertJsonPath('data.sheets', 1)
            ->assertJsonPath('data.rows_read', 2)
            ->assertJsonPath('data.beneficiaries_created', 2)
            ->assertJsonPath('data.records_created', 2);

        $record = MonitoringRecord::where('bcs', 3)->first();
        $this->assertNotNull($record);
        $this->assertSame('healthy', $record->remarks);
        $this->assertSame('2025-11-18', $record->date_monitored->toDateString());
        $this->assertSame('2025-11-18', $record->date_vits_supp?->toDateString());

        $beneficiary = Beneficiary::where('name_of_farmer', 'Juan Dela Cruz')->first();
        $this->assertNotNull($beneficiary);
        $this->assertSame('Ali-is', $beneficiary->address);
        $this->assertSame('M', $beneficiary->sex);
    }

    public function test_import_is_idempotent_on_reupload(): void
    {
        $path = $this->workbook([
            ['Juan Dela Cruz', 'Ali-is', 'Cattle', 'M', 45979, null, null, null, null, null, 3, null, null],
        ]);

        $makeFile = fn () => new UploadedFile($path, 'report.xlsx', null, null, true);

        $this->actingAs($this->admin)
            ->postJson('/api/v1/admin/monitoring-records/import', ['file' => $makeFile()])
            ->assertOk()
            ->assertJsonPath('data.records_created', 1);

        // Same workbook again: the row must be skipped, not duplicated.
        $this->actingAs($this->admin)
            ->postJson('/api/v1/admin/monitoring-records/import', ['file' => $makeFile()])
            ->assertOk()
            ->assertJsonPath('data.records_created', 0)
            ->assertJsonPath('data.records_skipped', 1)
            ->assertJsonPath('data.beneficiaries_matched', 1);

        $this->assertSame(1, MonitoringRecord::count());
    }

    public function test_import_matches_existing_beneficiary_by_name_and_address(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        Beneficiary::factory()
            ->forFarmer(User::factory()->create(['role' => 'farmer']))
            ->create([
                'name_of_farmer' => 'Juan Dela Cruz',
                'address' => 'Ali-is',
                'technician_id' => $technician->id,
            ]);

        $path = $this->workbook([
            ['juan dela cruz', 'Ali-is', 'Cattle', 'M', 45979, null, null, null, null, null, 2, null, null],
        ]);

        $response = $this->actingAs($this->admin)
            ->postJson('/api/v1/admin/monitoring-records/import', [
                'file' => new UploadedFile($path, 'report.xlsx', null, null, true),
            ]);

        $response->assertOk()
            ->assertJsonPath('data.beneficiaries_matched', 1)
            ->assertJsonPath('data.beneficiaries_created', 0);

        $this->assertSame(1, Beneficiary::count());
        $this->assertDatabaseHas('monitoring_records', [
            'bcs' => 2,
            'technician_id' => $technician->id,
        ]);
    }

    public function test_admin_can_export_the_report_workbook(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create([
            'name_of_farmer' => 'Juan Dela Cruz',
            'address' => 'Ali-is',
        ]);

        MonitoringRecord::factory()->by($technician)->for($beneficiary, 'beneficiary')->create([
            'date_monitored' => '2025-12-05',
            'bcs' => 4,
            'remarks' => 'healthy',
        ]);

        $response = $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/monitoring-records/export');

        $response->assertOk();
        $this->assertSame(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            $response->headers->get('Content-Type'),
        );

        // The streamed body must be a readable workbook with the row intact.
        $temporary = tempnam(sys_get_temp_dir(), 'export');
        file_put_contents($temporary, $response->streamedContent());

        $spreadsheet = IOFactory::load($temporary);
        $sheet = $spreadsheet->getSheet(0);

        $this->assertSame('Dec 2025', $sheet->getTitle());
        $this->assertSame('Name of Farmer', $sheet->getCell('A2')->getValue());
        $this->assertSame('Juan Dela Cruz', $sheet->getCell('A3')->getValue());
        $this->assertSame('2025-12-05', $sheet->getCell('E3')->getValue());
        $this->assertSame(4, $sheet->getCell('K3')->getValue());
        $this->assertSame('healthy', $sheet->getCell('M3')->getValue());

        $spreadsheet->disconnectWorksheets();
        @unlink($temporary);
    }

    public function test_export_includes_technician_and_photo_timestamp_columns(): void
    {
        Storage::fake('public');

        $technician = User::factory()->create(['role' => 'technician', 'name' => 'Jun Tech']);
        $assigned = Beneficiary::factory()->assignedTo($technician)->create([
            'name_of_farmer' => 'Maria Santos',
            'address' => 'Ali-is',
        ]);
        $unassigned = Beneficiary::factory()->create([
            'name_of_farmer' => 'Unassigned Farmer',
            'address' => 'Ali-is',
        ]);

        MonitoringRecord::factory()->by($technician)->for($assigned, 'beneficiary')->create([
            'date_monitored' => '2025-12-05',
        ]);
        MonitoringRecord::factory()->by($technician)->for($unassigned, 'beneficiary')->create([
            'date_monitored' => '2025-12-06',
        ]);

        $visit = \App\Models\FieldVisit::factory()->forBeneficiary($assigned)->by($technician)->create();
        $this->actingAs($technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", [
                'image' => UploadedFile::fake()->image('shot.jpg'),
                'capture_date' => '2025-12-04',
                'capture_time' => '11:45:32',
                'timezone_offset' => 'UTC+08:00',
                'capture_year' => 2025,
                'capture_month' => 12,
                'capture_day' => 4,
                'capture_hour' => 11,
                'capture_minute' => 45,
                'capture_second' => 32,
                'location_source' => 'none',
            ])->assertCreated();

        $response = $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/monitoring-records/export');

        $response->assertOk();

        $temporary = tempnam(sys_get_temp_dir(), 'export');
        file_put_contents($temporary, $response->streamedContent());

        $spreadsheet = IOFactory::load($temporary);
        $sheet = $spreadsheet->getSheet(0);

        // The two oversight columns exist in the header…
        $this->assertSame('Technician', $sheet->getCell('N2')->getValue());
        $this->assertSame('Photo Timestamp', $sheet->getCell('O2')->getValue());

        // …and carry the assigned technician + latest capture per row.
        $rows = [];
        foreach (range(3, $sheet->getHighestRow()) as $row) {
            $rows[$sheet->getCell("A{$row}")->getValue()] = [
                'technician' => $sheet->getCell("N{$row}")->getValue(),
                'timestamp' => $sheet->getCell("O{$row}")->getValue(),
            ];
        }

        $this->assertSame('Jun Tech', $rows['Maria Santos']['technician']);
        $this->assertSame('2025-12-04 11:45', $rows['Maria Santos']['timestamp']);
        $this->assertSame('Unassigned', $rows['Unassigned Farmer']['technician']);
        $this->assertNull($rows['Unassigned Farmer']['timestamp']);

        $spreadsheet->disconnectWorksheets();
        @unlink($temporary);
    }

    public function test_non_admin_cannot_import_or_export(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);

        $path = $this->workbook([
            ['Someone', 'Ali-is', 'Cattle', 'M', 45979, null, null, null, null, null, 3, null, null],
        ]);

        $this->actingAs($technician)
            ->postJson('/api/v1/admin/monitoring-records/import', [
                'file' => new UploadedFile($path, 'report.xlsx', null, null, true),
            ])
            ->assertForbidden();

        $this->actingAs($technician)
            ->getJson('/api/v1/admin/monitoring-records/export')
            ->assertForbidden();

        $this->assertSame(0, MonitoringRecord::count());
    }

    public function test_import_pins_created_beneficiaries_at_their_barangay_center(): void
    {
        $path = $this->workbook([
            ['Juan Dela Cruz', 'Ali-is', 'Cattle', 'M', 45979, null, null, null, null, null, 3, null, null],
            ['Maria Santos', 'Poblacion', 'Carabao', 'F', 45980, null, null, null, null, null, 4, null, null],
        ]);

        $this->actingAs($this->admin)
            ->postJson('/api/v1/admin/monitoring-records/import', [
                'file' => new UploadedFile($path, 'report.xlsx', null, null, true),
            ])
            ->assertOk();

        $aliis = \App\Support\Barangays::centerFor('Ali-is');
        $poblacion = \App\Support\Barangays::centerFor('Poblacion');

        $juan = Beneficiary::where('name_of_farmer', 'Juan Dela Cruz')->first();
        $this->assertNotNull($juan);
        $this->assertSame($aliis[0], (float) $juan->latitude);
        $this->assertSame($aliis[1], (float) $juan->longitude);
        $this->assertSame('manual', $juan->location_source);

        $maria = Beneficiary::where('name_of_farmer', 'Maria Santos')->first();
        $this->assertNotNull($maria);
        $this->assertSame($poblacion[0], (float) $maria->latitude);
        $this->assertSame($poblacion[1], (float) $maria->longitude);
    }

    public function test_import_leaves_uncovered_addresses_unpinned_rather_than_misplaced(): void
    {
        $path = $this->workbook([
            ['Juan Dela Cruz', 'Not A Barangay', 'Cattle', 'M', 45979, null, null, null, null, null, 3, null, null],
        ]);

        $this->actingAs($this->admin)
            ->postJson('/api/v1/admin/monitoring-records/import', [
                'file' => new UploadedFile($path, 'report.xlsx', null, null, true),
            ])
            ->assertOk();

        $juan = Beneficiary::where('name_of_farmer', 'Juan Dela Cruz')->first();
        $this->assertNotNull($juan);
        $this->assertNull($juan->latitude);
        $this->assertNull($juan->longitude);
    }

    public function test_import_resolves_loose_barangay_spellings(): void
    {
        $path = $this->workbook([
            ['Juan Dela Cruz', 'banay banay', 'Cattle', 'M', 45979, null, null, null, null, null, 3, null, null],
        ]);

        $this->actingAs($this->admin)
            ->postJson('/api/v1/admin/monitoring-records/import', [
                'file' => new UploadedFile($path, 'report.xlsx', null, null, true),
            ])
            ->assertOk();

        $juan = Beneficiary::where('name_of_farmer', 'Juan Dela Cruz')->first();
        $this->assertNotNull($juan);

        // "banay banay" normalizes onto the covered "Banaybanay" entry, so
        // the pin still lands in the right barangay.
        $center = \App\Support\Barangays::centerFor('Banaybanay');
        $this->assertSame($center[0], (float) $juan->latitude);
        $this->assertSame($center[1], (float) $juan->longitude);
    }
}
