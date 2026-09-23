<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
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
}
