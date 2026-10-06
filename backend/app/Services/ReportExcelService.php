<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx as XlsxWriter;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The city-wide report as a spreadsheet.
 *
 * "Reports must not be a picture with no way to get the numbers out": the
 * Charts on that screen are derived from the same payload this writes, so
 * hovering a bar is not the only way to reach a figure. The file is scoped
 * exactly like the screen — the active barangay and from-date are part of the
 * query and part of the filename.
 *
 * Three sheets, mirroring the page top to bottom:
 *   Summary          the program / activity / clinical bands, as metric rows
 *   Per barangay     the table — which is also the dispersal-per-barangay chart
 *   Dispersal trend  the trailing months — the data behind the trend chart
 *
 * Deliberately NOT a reuse of MonitoringExcelService: that workbook is the CVO
 * paper template keyed to one month and animal type, and it carries no
 * dispersal counts or aggregates. Pointing this screen at it would hand the
 * admin a file that does not contain the numbers on screen. Both share the
 * same toolchain (PhpSpreadsheet) and the same streamed-download shape.
 */
class ReportExcelService
{
    public function __construct(private readonly ReportService $reports) {}

    /**
     * Build and stream the workbook for the current scope.
     */
    public function downloadResponse(User $viewer, ?string $barangay = null, ?Carbon $from = null): StreamedResponse
    {
        $report = $this->reports->cityWide($viewer, $barangay, $from);
        $writer = new XlsxWriter($this->workbook($report, $barangay, $from));

        // Name the file after the filters that were active, so a folder of
        // exports says what each one holds without opening it — same convention
        // as the monitoring workbook export.
        $parts = ['cvo-program-report'];

        if ($barangay !== null && $barangay !== '') {
            $parts[] = Str::slug($barangay);
        }

        if ($from !== null) {
            $parts[] = 'from-'.$from->format('Y-m-d');
        }

        return response()->streamDownload(function () use ($writer): void {
            $writer->save('php://output');
        }, implode('-', $parts).'.xlsx', [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ]);
    }

    /**
     * @param  array<string, mixed>  $report
     */
    private function workbook(array $report, ?string $barangay, ?Carbon $from): Spreadsheet
    {
        $spreadsheet = new Spreadsheet;

        $this->summarySheet($spreadsheet->getActiveSheet(), $report, $barangay, $from);
        $this->perBarangaySheet($spreadsheet->createSheet(), $report['per_barangay']);
        $this->trendSheet($spreadsheet->createSheet(), $report['trend']);

        return $spreadsheet;
    }

    /**
     * The bands the page shows as cards, flattened to metric rows — plus the
     * scope, so a file found later says which slice of the program it is.
     *
     * @param  array<string, mixed>  $report
     */
    private function summarySheet(Worksheet $sheet, array $report, ?string $barangay, ?Carbon $from): void
    {
        $sheet->setTitle('Summary');

        $sheet->fromArray(['CVO PROGRAM REPORT'], null, 'A1');
        $sheet->getStyle('A1')->getFont()->setBold(true)->setSize(14);

        $sheet->fromArray([
            ['Scope', $barangay !== null && $barangay !== '' ? $barangay : 'All barangays'],
            ['Dispersals since', $from?->toDateString() ?? 'Not filtered'],
            ['Generated at', now()->toDateTimeString()],
        ], null, 'A3');

        $rows = [['Section', 'Metric', 'Value']];
        $section = '';

        foreach ($this->metricRows($report) as [$label, $value]) {
            // The section name is written once, on the first row of its block.
            [$name, $metric] = explode('|', $label, 2);
            $rows[] = [$name === $section ? '' : $name, $metric, $value];
            $section = $name;
        }

        $start = 7;
        $sheet->fromArray($rows, null, "A{$start}");
        $this->styleHeaderRow($sheet, $start);

        // Value column reads as numbers, so a reader can sum or chart them.
        $sheet->getStyle('C'.($start + 1).':C'.($start + count($rows) - 1))
            ->getAlignment()->setHorizontal(Alignment::HORIZONTAL_RIGHT);

        $sheet->getColumnDimension('A')->setWidth(22);
        $sheet->getColumnDimension('B')->setWidth(42);
        $sheet->getColumnDimension('C')->setWidth(16);
    }

    /**
     * The metric rows, tagged with their section so the sheet can group them
     * without a second pass over the payload.
     *
     * @param  array<string, mixed>  $report
     * @return list<array{0: string, 1: int}>
     */
    private function metricRows(array $report): array
    {
        $rows = [];

        foreach (['households' => 'Households', 'animals' => 'Animals tagged', 'with_technician' => 'With technician', 'unassigned' => 'Unassigned'] as $key => $label) {
            $rows[] = ["Program|{$label}", $report['program'][$key] ?? 0];
        }

        $activity = [
            'monitoring_visits' => 'Monitoring visits',
            'field_visits' => 'Field visits',
            'field_visits_with_location' => 'Field visits with GPS fix',
            'dispersals' => 'Dispersals',
            're_dispersals' => 'Re-dispersals',
            'dispersals_since' => 'Dispersals since filter date',
        ];

        foreach ($activity as $key => $label) {
            if (array_key_exists($key, $report['activity'])) {
                $rows[] = ["Field activity|{$label}", $report['activity'][$key]];
            }
        }

        foreach (['health_records' => 'Health records', 'open_cases' => 'Open cases', 'case_notes' => 'Case notes', 'vaccinations' => 'Vaccinations logged'] as $key => $label) {
            $rows[] = ["Clinical|{$label}", $report['clinical'][$key] ?? 0];
        }

        // The outcome breakdown appears for every configured outcome, including
        // zeros — an absent outcome is indistinguishable from a filtering bug.
        foreach ($report['clinical']['by_outcome'] ?? [] as $outcome => $count) {
            $rows[] = ['Outcomes|'.ucfirst((string) $outcome), $count];
        }

        return $rows;
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     */
    private function perBarangaySheet(Worksheet $sheet, array $rows): void
    {
        $sheet->setTitle('Per barangay');

        $header = ['Barangay', 'Households', 'Monitoring visits', 'Field visits', 'Health records', 'Dispersals'];
        $sheet->fromArray($header, null, 'A1');
        $this->styleHeaderRow($sheet, 1);

        if ($rows !== []) {
            $sheet->fromArray(array_map(
                fn (array $row): array => [
                    $row['barangay'],
                    $row['households'],
                    $row['monitoring_visits'],
                    $row['field_visits'],
                    $row['health_records'],
                    $row['dispersals'],
                ],
                $rows,
            ), null, 'A2');
        }

        foreach (range('A', 'F') as $column) {
            $sheet->getColumnDimension($column)->setAutoSize(true);
        }
    }

    /**
     * @param  list<array<string, mixed>>  $trend
     */
    private function trendSheet(Worksheet $sheet, array $trend): void
    {
        $sheet->setTitle('Dispersal trend');

        $sheet->fromArray(['Month', 'Label', 'Dispersals', 'Re-dispersals'], null, 'A1');
        $this->styleHeaderRow($sheet, 1);

        if ($trend !== []) {
            $sheet->fromArray(array_map(
                fn (array $month): array => [
                    $month['month'],
                    $month['label'],
                    $month['dispersals'],
                    $month['re_dispersals'],
                ],
                $trend,
            ), null, 'A2');
        }

        foreach (range('A', 'D') as $column) {
            $sheet->getColumnDimension($column)->setAutoSize(true);
        }
    }

    /**
     * The one shared table style: bold white-on-green header with thin borders,
     * matching the monitoring workbook so exports from this system look like
     * they came from the same place.
     */
    private function styleHeaderRow(Worksheet $sheet, int $row): void
    {
        $lastColumn = $sheet->getHighestColumn();
        $style = $sheet->getStyle("A{$row}:{$lastColumn}{$row}");

        $style->getFont()->setBold(true)->getColor()->setARGB('FFFFFFFF');
        $style->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB('FF558B2F');
        $style->getBorders()->getAllBorders()->setBorderStyle(Border::BORDER_THIN);
    }
}
