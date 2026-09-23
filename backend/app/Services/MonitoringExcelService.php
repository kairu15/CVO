<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Shared\Date as ExcelDate;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx as XlsxWriter;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Import / export of the CVO "Livestock Monthly Monitoring Report" workbook.
 *
 * The real-world sheets carry a merged title row, then a header row whose
 * labels mirror the field sheets ("Name of Farmer", " Date of Vits Supp.",
 * "Body Condition Score" / "BCS", ...). One sheet per month (consolidated
 * report) or per barangay (individual report) â€” both layouts are accepted,
 * since every sheet is parsed independently.
 */
class MonitoringExcelService
{
    /** Header row of the generated export, in template order. */
    private const EXPORT_HEADERS = [
        'Name of Farmer', 'Address', 'Type of Animal dispersed', 'Sex',
        'Date monitored', ' Date of Vits Supp.', 'Deworming ', 'Vaccination',
        'Date Breed', 'Date Calved', 'BCS', 'Farmers Signature', 'Remarks',
    ];

    /**
     * Normalised header label â†’ field. Matching is done on a stripped,
     * lowercased key so " Date of Vits Supp." resolves like "Date of Vits Supp.".
     */
    private const HEADER_MAP = [
        'nameoffarmer' => 'name_of_farmer',
        'address' => 'address',
        'typeofanimaldispersed' => 'animal_type',
        'sex' => 'sex',
        'datemonitored' => 'date_monitored',
        'dateofvitssupp' => 'date_vits_supp',
        'deworming' => 'deworming_date',
        'vaccination' => 'vaccination_date',
        'datebreed' => 'date_breed',
        'datecalved' => 'date_calved',
        'bodyconditionscore' => 'bcs',
        'bcs' => 'bcs',
        'farmerssignature' => 'farmers_signature',
        'remarks' => 'remarks',
        'technician' => 'technician',
    ];

    private const DATE_FIELDS = [
        'date_monitored', 'date_vits_supp', 'deworming_date',
        'vaccination_date', 'date_breed', 'date_calved',
    ];

    /**
     * Import every sheet of an uploaded workbook.
     *
     * Beneficiaries are matched on (name_of_farmer, address) â€” trimmed and
     * case-insensitive â€” and created when missing (owned by the acting admin
     * until reassigned). Records are deduped on (beneficiary, date_monitored)
     * so a workbook can be re-imported safely.
     *
     * @return array<string, mixed> an import summary for the UI
     */
    public function import(UploadedFile $file, User $actor): array
    {
        $spreadsheet = IOFactory::load($file->getRealPath());

        $summary = [
            'sheets' => 0,
            'rows_read' => 0,
            'beneficiaries_matched' => 0,
            'beneficiaries_created' => 0,
            'records_created' => 0,
            'records_skipped' => 0,
            'technicians_matched' => 0,
            'technicians_fallback' => 0,
            'errors' => [],
        ];

        $technicianCache = [];

        foreach ($spreadsheet->getAllSheets() as $sheet) {
            $map = $this->headerMapFor($sheet);

            // No recognisable header row â€” an empty/auxiliary sheet.
            if (! isset($map['name_of_farmer'])) {
                continue;
            }

            $summary['sheets']++;
            $highestRow = $sheet->getHighestRow();

            // Start below the detected header row.
            for ($row = $map['__header_row'] + 1; $row <= $highestRow; $row++) {
                $values = $this->rowValues($sheet, $map, $row);

                $name = trim((string) ($values['name_of_farmer'] ?? ''));
                if ($name === '') {
                    continue; // blank spacer row
                }

                // A repeated header row inside the sheet (real reports carry
                // these between sections) — skip, don't create a farmer.
                if ($this->normalizeHeader($name) === 'nameoffarmer') {
                    continue;
                }

                $summary['rows_read']++;

                try {
                    $beneficiary = $this->matchOrCreateBeneficiary($values, $actor, $summary);
                    $technician = $this->resolveTechnician($beneficiary, $values, $actor, $technicianCache, $summary);
                    $recordData = $this->recordDataFrom($values);

                    $exists = MonitoringRecord::query()
                        ->where('beneficiary_id', $beneficiary->id)
                        ->when(
                            $recordData['date_monitored'] ?? null,
                            fn ($q, $date) => $q->whereDate('date_monitored', $date),
                            fn ($q) => $q->whereNull('date_monitored'),
                        )
                        ->exists();

                    if ($exists) {
                        $summary['records_skipped']++;

                        continue;
                    }

                    MonitoringRecord::create([
                        ...$recordData,
                        'beneficiary_id' => $beneficiary->id,
                        'technician_id' => $technician->id,
                    ]);

                    $summary['records_created']++;
                } catch (\Throwable $e) {
                    $summary['errors'][] = sprintf(
                        '%s row %d (%s): %s',
                        $sheet->getTitle(),
                        $row,
                        $name,
                        $e->getMessage(),
                    );
                }
            }
        }

        $spreadsheet->disconnectWorksheets();

        return $summary;
    }

    /**
     * Build the monthly report workbook: one sheet per month that has records,
     * rows ordered by barangay then farmer, mirroring the CVO template.
     */
    public function exportWorkbook(?string $month = null): Spreadsheet
    {
        $records = MonitoringRecord::query()
            ->with('beneficiary')
            ->when($month, function ($q, $month): void {
                $q->whereYear('date_monitored', '=', substr($month, 0, 4))
                    ->whereMonth('date_monitored', '=', substr($month, 5, 2));
            })
            ->orderBy('date_monitored')
            ->get();

        $byMonth = $records->groupBy(
            fn (MonitoringRecord $r) => ($r->date_monitored ?? $r->created_at)?->format('Y-m') ?? 'unknown',
        );

        $spreadsheet = new Spreadsheet;
        $spreadsheet->removeSheetByIndex(0);

        foreach ($byMonth as $key => $monthRecords) {
            // "Sep 2025" style labels stay unique across years.
            $label = $key === 'unknown'
                ? 'Unlisted'
                : Carbon::parse($key.'-01')->format('M Y');

            $sheet = new Worksheet($spreadsheet, $label);
            $spreadsheet->addSheet($sheet);

            // Title row, merged across the template width.
            $sheet->setCellValue('A1', 'LIVESTOCK MONTHLY MONITORING REPORT');
            $sheet->mergeCells('A1:M1');
            $sheet->getStyle('A1')->getFont()->setBold(true)->setSize(13);
            $sheet->getStyle('A1')->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);

            // Header row.
            $sheet->fromArray(self::EXPORT_HEADERS, null, 'A2');
            $headerStyle = $sheet->getStyle('A2:M2');
            $headerStyle->getFont()->setBold(true);
            $headerStyle->getFill()->setFillType(Fill::FILL_SOLID)
                ->getStartColor()->setRGB('DCE8D9');
            $headerStyle->getBorders()->getAllBorders()->setBorderStyle(Border::BORDER_THIN);

            // Data rows, grouped by barangay like the field sheets.
            $grouped = $monthRecords->sortBy(
                fn (MonitoringRecord $r) => [$r->beneficiary->address, $r->beneficiary->name_of_farmer],
            );

            $rowIndex = 3;
            foreach ($grouped as $record) {
                $b = $record->beneficiary;
                $sheet->fromArray([
                    $b->name_of_farmer,
                    $b->address,
                    $b->animal_type,
                    $b->sex,
                    $this->d($record->date_monitored),
                    $this->d($record->date_vits_supp),
                    $this->d($record->deworming_date),
                    $this->d($record->vaccination_date),
                    $this->d($record->date_breed),
                    $this->d($record->date_calved),
                    $record->bcs,
                    $record->farmers_signature,
                    $record->remarks,
                ], null, 'A'.$rowIndex);

                $sheet->getStyle('A'.$rowIndex.':M'.$rowIndex)
                    ->getBorders()->getAllBorders()->setBorderStyle(Border::BORDER_THIN);

                $rowIndex++;
            }

            foreach (range('A', 'M') as $col) {
                $sheet->getColumnDimension($col)->setWidth($col === 'A' ? 24 : ($col === 'M' ? 30 : 14));
            }
        }

        return $spreadsheet;
    }

    /** Stream the workbook as a download. */
    public function downloadResponse(?string $month = null): StreamedResponse
    {
        $writer = new XlsxWriter($this->exportWorkbook($month));
        $filename = 'livestock-monitoring-report'.($month ? "-{$month}" : '').'.xlsx';

        return response()->streamDownload(function () use ($writer): void {
            $writer->save('php://output');
        }, $filename, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ]);
    }

    // ------------------------------------------------------------------
    // Parsing helpers
    // ------------------------------------------------------------------

    /** Column-letter â†’ field map located by scanning for the header row. */
    private function headerMapFor(Worksheet $sheet): array
    {
        $highestCol = $sheet->getHighestColumn();

        foreach ($sheet->getRowIterator() as $row) {
            if ($row->getRowIndex() > 15) {
                break; // the header is always in the first few rows
            }

            $map = [];
            foreach ($sheet->getColumnIterator('A', $highestCol) as $col) {
                $value = (string) $sheet
                    ->getCell($col->getColumnIndex().$row->getRowIndex())
                    ->getValue();
                $field = self::HEADER_MAP[$this->normalizeHeader($value)] ?? null;

                if ($field !== null && ! isset($map[$field])) {
                    $map[$field] = $col->getColumnIndex();
                }
            }

            if (isset($map['name_of_farmer']) && $map['name_of_farmer'] === 'A') {
                $map['__header_row'] = $row->getRowIndex();

                return $map;
            }
        }

        return [];
    }

    private function normalizeHeader(string $value): string
    {
        return strtolower((string) preg_replace('/[^a-z0-9]/i', '', $value));
    }

    /** Pull a data row into field => value form using the header map. */
    private function rowValues(Worksheet $sheet, array $map, int $row): array
    {
        $values = [];

        foreach ($map as $field => $column) {
            if ($field === '__header_row') {
                continue;
            }

            $cell = $sheet->getCell($column.$row, false);
            $values[$field] = $cell?->getValue();
        }

        return $values;
    }

    /** Excel serials, DateTime objects or plain strings â†’ Y-m-d or null. */
    private function toDateString(mixed $value): ?string
    {
        if ($value === null || $value === '' || (is_string($value) && trim($value) === '')) {
            return null;
        }

        try {
            $date = is_numeric($value)
                ? Carbon::instance(ExcelDate::excelToDateTimeObject((float) $value))
                : ($value instanceof \DateTimeInterface
                    ? Carbon::instance($value)
                    : Carbon::parse(trim((string) $value)));
        } catch (\Throwable) {
            return null;
        }

        // The sheets contain typos like "415098" (year 3036). Reject anything
        // outside a plausible monitoring window rather than importing it.
        if ($date->lessThan(Carbon::create(2000, 1, 1)) || $date->greaterThan(now()->addYear())) {
            return null;
        }

        return $date->toDateString();
    }

    /**
     * Format a record's date attribute (Carbon or string) as Y-m-d for the
     * export sheet; null renders as a blank Excel cell.
     */
    private function d(mixed $date): ?string
    {
        if ($date === null) {
            return null;
        }

        if ($date instanceof \DateTimeInterface) {
            return Carbon::instance($date)->toDateString();
        }

        return (string) $date;
    }

    /** Match an existing beneficiary or create a new one from identity fields. */
    private function matchOrCreateBeneficiary(array $values, User $actor, array &$summary): Beneficiary
    {
        $name = trim((string) $values['name_of_farmer']);
        $address = trim((string) ($values['address'] ?? ''));

        $beneficiary = Beneficiary::query()
            ->whereRaw('LOWER(TRIM(name_of_farmer)) = ?', [mb_strtolower($name)])
            ->when($address !== '', fn ($q) => $q->whereRaw('LOWER(TRIM(address)) = ?', [mb_strtolower($address)]))
            ->first();

        if ($beneficiary) {
            $summary['beneficiaries_matched']++;

            return $beneficiary;
        }

        $sex = strtoupper(trim((string) ($values['sex'] ?? '')));

        $beneficiary = Beneficiary::create([
            'farmer_id' => $actor->id, // owned by the importer until reassigned
            'name_of_farmer' => $name,
            'address' => $address !== '' ? $address : 'Unlisted',
            'animal_type' => trim((string) ($values['animal_type'] ?? '')) ?: 'Unspecified',
            'sex' => in_array($sex, ['M', 'F'], true) ? $sex : null,
            'technician_id' => null,
        ]);

        $summary['beneficiaries_created']++;

        return $beneficiary;
    }

    /**
     * Resolve the technician for a row: the beneficiary's existing assigned
     * technician wins; otherwise a "Technician" column value is matched
     * against user names (fuzzy, e.g. "Marilyn A."); else the acting admin.
     */
    private function resolveTechnician(Beneficiary $beneficiary, array $values, User $actor, array &$cache, array &$summary): User
    {
        if ($beneficiary->technician_id) {
            $technician = User::find($beneficiary->technician_id);
            if ($technician) {
                return $technician;
            }
        }

        $label = trim((string) ($values['technician'] ?? ''));

        if ($label === '') {
            $summary['technicians_fallback']++;

            return $actor;
        }

        $key = mb_strtolower($label);
        if (isset($cache[$key])) {
            return $cache[$key];
        }

        // Compare against known names; "Donald M." matches "Donald Manus".
        $first = strtok($label, ' ');
        $user = User::query()
            ->where('name', 'like', "{$first}%")
            ->orderByRaw('ABS(LENGTH(name) - ?)', [mb_strlen($label)])
            ->first();

        $user ??= $actor;
        $cache[$key] = $user;

        if ($user->id === $actor->id) {
            $summary['technicians_fallback']++;
        } else {
            $summary['technicians_matched']++;
        }

        return $user;
    }

    /** Visit fields for one sheet row, with dates parsed and BCS validated. */
    private function recordDataFrom(array $values): array
    {
        $data = [];

        foreach (self::DATE_FIELDS as $field) {
            $data[$field] = $this->toDateString($values[$field] ?? null);
        }

        $bcs = $values['bcs'] ?? null;
        if (is_numeric($bcs) && $bcs >= 1 && $bcs <= 9) {
            $data['bcs'] = (int) $bcs;
        }

        foreach (['farmers_signature', 'remarks'] as $field) {
            $value = trim((string) ($values[$field] ?? ''));
            $data[$field] = $value !== '' ? $value : null;
        }

        return $data;
    }
}
