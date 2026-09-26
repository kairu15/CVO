<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\CaseNote;
use App\Models\DispersalEvent;
use App\Models\HealthRecord;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Deleting an IMPORTED monitoring record must remove the auto-created
 * beneficiary behind it, so a deleted sheet stops leaving phantom
 * households in Beneficiaries, the map and the technician pickers.
 *
 * The cleanup is deliberately narrow — it must never delete a household
 * anything else still uses, and never touch registered households.
 */
class MonitoringImportCleanupTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->create(['role' => 'admin']);
    }

    /** An import-created beneficiary with no other record of its own. */
    private function importedBeneficiary(): Beneficiary
    {
        return Beneficiary::factory()->create([
            'farmer_id' => $this->admin->id,
            'source' => Beneficiary::SOURCE_IMPORT,
        ]);
    }

    public function test_deleting_an_imported_record_also_removes_its_import_beneficiary(): void
    {
        $beneficiary = $this->importedBeneficiary();
        $record = MonitoringRecord::factory()->by($this->admin)->for($beneficiary, 'beneficiary')->create();

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/monitoring-records/{$record->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('monitoring_records', ['id' => $record->id]);
        $this->assertDatabaseMissing('beneficiaries', ['id' => $beneficiary->id]);
    }

    public function test_import_beneficiary_with_multiple_records_survives_one_delete(): void
    {
        $beneficiary = $this->importedBeneficiary();
        $deleted = MonitoringRecord::factory()->by($this->admin)->for($beneficiary, 'beneficiary')->create();
        $kept = MonitoringRecord::factory()->by($this->admin)->for($beneficiary, 'beneficiary')->create();

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/monitoring-records/{$deleted->id}")
            ->assertNoContent();

        $this->assertDatabaseHas('beneficiaries', ['id' => $beneficiary->id]);
        $this->assertDatabaseHas('monitoring_records', ['id' => $kept->id]);
    }

    public function test_import_beneficiary_with_a_field_visit_survives(): void
    {
        $beneficiary = $this->importedBeneficiary();
        $record = MonitoringRecord::factory()->by($this->admin)->for($beneficiary, 'beneficiary')->create();

        \App\Models\FieldVisit::factory()->forBeneficiary($beneficiary)->by($this->admin)->create();

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/monitoring-records/{$record->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('monitoring_records', ['id' => $record->id]);
        $this->assertDatabaseHas('beneficiaries', ['id' => $beneficiary->id]);
    }

    public function test_import_beneficiary_with_a_health_record_survives(): void
    {
        $beneficiary = $this->importedBeneficiary();
        $record = MonitoringRecord::factory()->by($this->admin)->for($beneficiary, 'beneficiary')->create();

        HealthRecord::factory()->create(['beneficiary_id' => $beneficiary->id]);

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/monitoring-records/{$record->id}")
            ->assertNoContent();

        $this->assertDatabaseHas('beneficiaries', ['id' => $beneficiary->id]);
    }

    public function test_import_beneficiary_with_a_case_note_survives(): void
    {
        $beneficiary = $this->importedBeneficiary();
        $record = MonitoringRecord::factory()->by($this->admin)->for($beneficiary, 'beneficiary')->create();

        CaseNote::factory()->create(['beneficiary_id' => $beneficiary->id]);

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/monitoring-records/{$record->id}")
            ->assertNoContent();

        $this->assertDatabaseHas('beneficiaries', ['id' => $beneficiary->id]);
    }

    public function test_import_beneficiary_referenced_by_a_dispersal_chain_survives(): void
    {
        $beneficiary = $this->importedBeneficiary();
        $record = MonitoringRecord::factory()->by($this->admin)->for($beneficiary, 'beneficiary')->create();

        // As the parent of a re-dispersal — the chain leans on this row.
        DispersalEvent::factory()->create([
            'beneficiary_id' => Beneficiary::factory()->create()->id,
            'parent_beneficiary_id' => $beneficiary->id,
            'dispersal_type' => 're-dispersal',
        ]);

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/monitoring-records/{$record->id}")
            ->assertNoContent();

        $this->assertDatabaseHas('beneficiaries', ['id' => $beneficiary->id]);
    }

    public function test_a_registered_beneficiary_is_never_deleted_with_its_record(): void
    {
        // source = 'registration' (the default) — farmer signup or staff entry.
        $beneficiary = Beneficiary::factory()->create();
        $record = MonitoringRecord::factory()->by($this->admin)->for($beneficiary, 'beneficiary')->create();

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/monitoring-records/{$record->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('monitoring_records', ['id' => $record->id]);
        $this->assertDatabaseHas('beneficiaries', ['id' => $beneficiary->id]);
    }

    public function test_the_round_trip_holds_import_then_delete_then_reimport(): void
    {
        $row = ['Juan Dela Cruz', 'Ali-is', 'Cattle', 'M', 45979, null, null, null, null, null, 3, null, null];

        $this->importWorkbooks([[$row]]);

        $record = MonitoringRecord::whereHas('beneficiary', fn ($q) => $q->where('name_of_farmer', 'Juan Dela Cruz'))->first();
        $this->assertNotNull($record);

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/monitoring-records/{$record->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('beneficiaries', ['name_of_farmer' => 'Juan Dela Cruz']);

        // Re-importing the same workbook recreates everything cleanly.
        $this->importWorkbooks([[$row]]);

        $this->assertDatabaseHas('monitoring_records', ['id' => MonitoringRecord::max('id')]);
        $this->assertSame(1, Beneficiary::where('name_of_farmer', 'Juan Dela Cruz')->count());
    }

    /**
     * Feed rows through the real import endpoint (in-memory xlsx, the same
     * trick MonitoringExcelTest uses) so the source tagging under test is
     * the one the import actually writes.
     */
    private function importWorkbooks(array $sheets): void
    {
        $spreadsheet = new \PhpOffice\PhpSpreadsheet\Spreadsheet();
        $spreadsheet->removeSheetByIndex(0);

        foreach ($sheets as $index => $rows) {
            $sheet = new \PhpOffice\PhpSpreadsheet\Worksheet\Worksheet($spreadsheet, "Sheet ".($index + 1));
            $spreadsheet->addSheet($sheet);

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
        }

        $path = storage_path('framework/testing/import-cleanup-'.\Illuminate\Support\Str::uuid().'.xlsx');
        (new \PhpOffice\PhpSpreadsheet\Writer\Xlsx($spreadsheet))->save($path);
        $spreadsheet->disconnectWorksheets();

        $this->actingAs($this->admin)
            ->postJson('/api/v1/admin/monitoring-records/import', [
                'file' => new \Illuminate\Http\UploadedFile($path, 'report.xlsx', null, null, true),
            ])
            ->assertOk();

        @unlink($path);
    }
}
