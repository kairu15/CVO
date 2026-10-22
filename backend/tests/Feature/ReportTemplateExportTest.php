<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\User;
use App\Services\ReportTemplateService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use Tests\TestCase;
use ZipArchive;

/**
 * The printable report built on the office's own Excel template.
 *
 * The template is a COVER PAGE: letterhead images + address text box, the
 * title, a "For the month of ____" line, and the Prepared/Noted/Approved
 * signature block. The generated file must keep all of that intact while the
 * dispersal roster is inserted between the month line and the signatures —
 * so these tests check the placeholders, the roster filtering, the structural
 * survival of the signature block, and the letterhead shape a plain
 * PhpSpreadsheet save would drop.
 */
class ReportTemplateExportTest extends TestCase
{
    use RefreshDatabase;

    private function admin(array $attributes = []): User
    {
        return User::factory()->create(['role' => 'admin', ...$attributes]);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function export(User $user, array $payload = [])
    {
        return $this->actingAs($user)->postJson('/api/v1/admin/report/template-export', [
            'template' => ReportTemplateService::TEMPLATE_DISPERSAL,
            'name' => 'Livestock Dispersal and Re-dispersal Report — Dawis — September 2026',
            ...$payload,
        ]);
    }

    /** The workbook behind a successful export response. */
    private function workbook($response): Worksheet
    {
        $path = $response->baseResponse->getFile()->getPathname();

        return IOFactory::load($path)->getActiveSheet();
    }

    /**
     * Every non-empty cell of the sheet, row by row.
     *
     * @return array<int, array<int, mixed>>
     */
    private function grid(Worksheet $sheet): array
    {
        $rows = [];

        foreach ($sheet->toArray(null, true, true, false) as $index => $row) {
            $values = array_values(array_filter($row, fn ($value): bool => $value !== null && $value !== ''));

            if ($values !== []) {
                $rows[$index + 1] = $values;
            }
        }

        return $rows;
    }

    /** The row holding the roster header. */
    private function tableHeaderRow(Worksheet $sheet): int
    {
        foreach ($this->grid($sheet) as $row => $values) {
            if (in_array('Name of Farmer', $values, true)) {
                return $row;
            }
        }

        $this->fail('The dispersal roster header is missing from the generated report.');
    }

    public function test_a_guest_cannot_export_the_report(): void
    {
        $this->postJson('/api/v1/admin/report/template-export', [
            'template' => ReportTemplateService::TEMPLATE_DISPERSAL,
            'name' => 'Report',
        ])->assertUnauthorized();
    }

    public function test_the_export_uses_the_same_report_permission_as_the_reports_screen(): void
    {
        foreach (['doctor', 'technician'] as $role) {
            $this->export(User::factory()->create(['role' => $role]))
                ->assertForbidden();
        }
    }

    public function test_the_admin_receives_an_xlsx_download_named_after_the_report_name(): void
    {
        $response = $this->export($this->admin());

        $response->assertOk()->assertDownload('livestock-dispersal-and-re-dispersal-report-dawis-september-2026.xlsx');

        $this->assertSame(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            $response->headers->get('content-type'),
        );
    }

    public function test_a_name_with_no_filename_characters_falls_back_to_a_safe_name(): void
    {
        $this->export($this->admin(), ['name' => '★★★'])->assertDownload('cvo-report.xlsx');
    }

    public function test_the_editable_name_month_and_preparer_fill_the_template_placeholders(): void
    {
        $admin = $this->admin(['name' => 'Maria S. Technician']);

        $sheet = $this->workbook($this->export($admin, [
            'name' => 'Livestock Dispersal and Re-dispersal Report — Dawis — Sep 2026',
            'month' => '2026-09',
        ]));

        $this->assertSame('Livestock Dispersal and Re-dispersal Report — Dawis — Sep 2026', $sheet->getCell('A6')->getValue());
        $this->assertSame('For the month of September 2026', $sheet->getCell('A7')->getValue());

        // The template's literal "Editable" slot now carries the preparer.
        $grid = $this->grid($sheet);
        $this->assertContains('Maria S. Technician', array_merge(...array_values($grid)));
        $this->assertNotContains('Editable', array_merge(...array_values($grid)));
    }

    public function test_without_a_month_filter_the_templates_blank_month_line_is_kept(): void
    {
        $sheet = $this->workbook($this->export($this->admin(), ['month' => null]));

        $this->assertSame('For the month of ______________________', $sheet->getCell('A7')->getValue());
    }

    public function test_the_signature_block_survives_the_inserted_roster(): void
    {
        $beneficiary = Beneficiary::factory()->create(['address' => 'Dawis']);

        DispersalEvent::factory()->initial($beneficiary)->count(3)->create([
            'date_dispersed' => '2026-09-10',
        ]);

        $sheet = $this->workbook($this->export($this->admin(), ['month' => '2026-09']));

        $cells = array_merge(...array_values($this->grid($sheet)));

        foreach (['Prepared by:', 'Noted by:', 'Approved:', 'ROLANDO T. MAGBANUA, JR.', 'SATURNINO T. DAYANAN', 'Livestock Technician-incharge', 'City Veterinarian'] as $expected) {
            $this->assertContains($expected, $cells);
        }

        // The signatures end the report, below every roster row.
        $signatureRow = null;
        foreach ($this->grid($sheet) as $row => $values) {
            if (in_array('Prepared by:', $values, true)) {
                $signatureRow = $row;
            }
        }

        $this->assertGreaterThan($this->tableHeaderRow($sheet), $signatureRow);
    }

    public function test_the_roster_lists_the_dispersals_for_the_selected_month(): void
    {
        $inScope = Beneficiary::factory()->create([
            'address' => 'Dawis',
            'name_of_farmer' => 'Juan Dela Cruz',
            'animal_type' => 'Carabao',
            'sex' => 'M',
            'ear_tag_number' => 'ET-0042',
        ]);
        $otherMonth = Beneficiary::factory()->create([
            'address' => 'Dawis',
            'name_of_farmer' => 'Pedro Reyes',
        ]);

        DispersalEvent::factory()->initial($inScope)->create(['date_dispersed' => '2026-09-21']);
        DispersalEvent::factory()->initial($otherMonth)->create(['date_dispersed' => '2026-08-31']);

        $sheet = $this->workbook($this->export($this->admin(), ['month' => '2026-09']));
        $cells = array_merge(...array_values($this->grid($sheet)));

        $this->assertContains('Juan Dela Cruz', $cells);
        $this->assertContains('Carabao', $cells);
        $this->assertContains('ET-0042', $cells);
        $this->assertContains('Initial', $cells);
        $this->assertContains('21/09/26', $cells);

        // A dispersal outside the month is not on the report.
        $this->assertNotContains('Pedro Reyes', $cells);
    }

    public function test_a_re_dispersal_is_labelled_as_such(): void
    {
        $recipient = Beneficiary::factory()->create(['address' => 'Dawis', 'name_of_farmer' => 'Ana Recipient']);
        $parent = Beneficiary::factory()->create(['address' => 'Dawis', 'name_of_farmer' => 'Ben Parent']);

        DispersalEvent::factory()->reDispersal($recipient, $parent)->create(['date_dispersed' => '2026-09-05']);

        $cells = array_merge(...array_values($this->grid(
            $this->workbook($this->export($this->admin(), ['month' => '2026-09'])),
        )));

        $this->assertContains('Ana Recipient', $cells);
        $this->assertContains('Re-dispersal', $cells);
    }

    public function test_the_roster_respects_the_barangay_and_animal_type_filters(): void
    {
        $inScope = Beneficiary::factory()->create([
            'address' => 'Dawis',
            'name_of_farmer' => 'Scope Farmer',
            'animal_type' => 'Goat',
        ]);
        $otherBarangay = Beneficiary::factory()->create([
            'address' => 'Tayawan',
            'name_of_farmer' => 'Other Barangay Farmer',
            'animal_type' => 'Goat',
        ]);
        $otherType = Beneficiary::factory()->create([
            'address' => 'Dawis',
            'name_of_farmer' => 'Other Animal Farmer',
            'animal_type' => 'Carabao',
        ]);

        foreach ([$inScope, $otherBarangay, $otherType] as $beneficiary) {
            DispersalEvent::factory()->initial($beneficiary)->create(['date_dispersed' => '2026-09-12']);
        }

        $cells = array_merge(...array_values($this->grid(
            $this->workbook($this->export($this->admin(), [
                'barangay' => 'Dawis',
                'animal_type' => 'Goat',
                'month' => '2026-09',
            ])),
        )));

        $this->assertContains('Scope Farmer', $cells);
        $this->assertNotContains('Other Barangay Farmer', $cells);
        $this->assertNotContains('Other Animal Farmer', $cells);
    }

    public function test_an_empty_selection_says_so_instead_of_printing_an_empty_table(): void
    {
        $sheet = $this->workbook($this->export($this->admin(), ['month' => '2026-09']));

        $cells = array_merge(...array_values($this->grid($sheet)));

        $this->assertContains('No dispersal records match the selected filters.', $cells);
        // The header still prints, so the frame the signatures follow is intact.
        $this->assertContains('Name of Farmer', $cells);
    }

    public function test_the_letterhead_images_and_text_box_are_preserved(): void
    {
        $response = $this->export($this->admin());
        $path = $response->baseResponse->getFile()->getPathname();

        $zip = new ZipArchive;
        $this->assertTrue($zip->open($path) === true);

        $drawing = $zip->getFromName('xl/drawings/drawing1.xml');
        $zip->close();

        $this->assertIsString($drawing);

        // PhpSpreadsheet drops shapes, so the address box is re-injected ...
        $this->assertStringContainsString('CITY VETERINARY OFFICE', $drawing);
        $this->assertStringContainsString('<xdr:sp ', $drawing);
        // ... while the three logo/seal images ride the writer's own path.
        $this->assertSame(3, substr_count($drawing, '<xdr:pic>'));
    }

    public function test_exporting_never_modifies_the_source_template(): void
    {
        $template = (new ReportTemplateService)->templatePath(ReportTemplateService::TEMPLATE_DISPERSAL);
        $before = hash_file('sha256', $template);

        $this->export($this->admin())->assertOk();
        $this->export($this->admin(), ['barangay' => 'Dawis', 'month' => '2026-09'])->assertOk();

        $this->assertSame($before, hash_file('sha256', $template));
    }

    public function test_the_request_rejects_an_unknown_template_and_malformed_filters(): void
    {
        $this->export($this->admin(), ['template' => 'calendar'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['template']);

        $this->export($this->admin(), ['name' => ''])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['name']);

        $this->export($this->admin(), ['month' => '2026-13'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['month']);

        $this->export($this->admin(), ['from' => '2026-09-30', 'to' => '2026-09-01'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['to']);
    }

    public function test_a_date_range_narrows_the_roster(): void
    {
        $beneficiary = Beneficiary::factory()->create(['address' => 'Dawis', 'name_of_farmer' => 'Range Farmer']);

        DispersalEvent::factory()->initial($beneficiary)->create(['date_dispersed' => '2026-09-02']);
        DispersalEvent::factory()->initial($beneficiary)->create(['date_dispersed' => '2026-09-28']);

        $sheet = $this->workbook($this->export($this->admin(), [
            'from' => '2026-09-01',
            'to' => '2026-09-10',
        ]));

        $cells = array_merge(...array_values($this->grid($sheet)));

        $this->assertContains('02/09/26', $cells);
        $this->assertNotContains('28/09/26', $cells);
    }

    public function test_a_selection_with_the_same_filters_twice_stays_available(): void
    {
        // Guards the temp-file hand-off: the response deletes its file after
        // sending, which must not break a later request.
        $admin = $this->admin();
        $beneficiary = Beneficiary::factory()->create(['address' => 'Dawis']);
        DispersalEvent::factory()->initial($beneficiary)->create(['date_dispersed' => Carbon::parse('2026-09-09')]);

        $first = $this->export($admin, ['month' => '2026-09'])->assertOk();
        $second = $this->export($admin, ['month' => '2026-09'])->assertOk();

        $this->assertNotSame(
            $first->baseResponse->getFile()->getPathname(),
            $second->baseResponse->getFile()->getPathname(),
        );
    }
}
