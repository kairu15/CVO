<?php

namespace App\Services;

use App\Models\DispersalEvent;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Shared\Date as ExcelDate;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx as XlsxWriter;
use RuntimeException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use ZipArchive;

/**
 * Report generation from the office's own printable template.
 *
 * The template (`resources/report-templates/livestock-dispersal-report.xlsx`)
 * is the CVO cover sheet: two logo/letterhead images, a text-box address
 * block, the report title, a "For the month of ____" line, and the
 * Prepared/Noted/Approved signature block. It carries NO data table, so this
 * service fills the three real placeholders — title, month, preparer — and
 * adds the dispersal roster between the month line and the signatures, which
 * is where an official report's table belongs.
 *
 * The template file is read, never written: generation happens on a fresh
 * workbook and lands in a temporary file.
 *
 * PHPSPREADSHEET LIMITATION, handled deliberately: the writer drops drawing
 * shapes, so the letterhead TEXT BOX (the office address) would disappear from
 * every generated file. `restoreLetterhead()` copies that one shape out of the
 * untouched template and back into the saved package. The images survive the
 * round-trip on their own.
 */
class ReportTemplateService
{
    public const TEMPLATE_DISPERSAL = 'dispersal';

    /**
     * The template catalogue: request key => label + file. One entry today;
     * the export request validates against these keys, so adding a second
     * template is a file plus a row here.
     *
     * @var array<string, array{label: string, file: string}>
     */
    public const TEMPLATES = [
        self::TEMPLATE_DISPERSAL => [
            'label' => 'Livestock Dispersal and Re-dispersal Report',
            'file' => 'livestock-dispersal-report.xlsx',
        ],
    ];

    /** The template's own cells — the only placeholders it defines. */
    private const ROW_TITLE = 6;

    private const ROW_MONTH = 7;

    private const ROW_PREPARED_BY = 14;

    /** Table header row; the template keeps rows 8-10 blank before signatures. */
    private const ROW_TABLE_HEADER = 9;

    private const FIRST_DATA_ROW = 10;

    /** Signature block starts here in the template — the table is inserted above it. */
    private const FIRST_SIGNATURE_ROW = 11;

    /** Columns holding the last table field, so borders/merges span A:I. */
    private const LAST_COLUMN = 'I';

    /**
     * Build the report and stream it as a download.
     *
     * @param  string  $template  key from self::TEMPLATES
     * @param  string  $name  the admin's editable report name (title + filename)
     */
    public function downloadResponse(
        User $viewer,
        string $template,
        string $name,
        ?string $barangay = null,
        ?string $month = null,
        ?Carbon $from = null,
        ?Carbon $to = null,
        ?string $animalType = null,
    ): BinaryFileResponse {
        $spreadsheet = $this->build($viewer, $template, $name, $barangay, $month, $from, $to, $animalType);

        $path = tempnam(sys_get_temp_dir(), 'cvo-report-');

        if ($path === false) {
            throw new RuntimeException('Could not create a temporary file for the report.');
        }

        try {
            (new XlsxWriter($spreadsheet))->save($path);
            // The shape the writer cannot carry, put back before anyone opens it.
            $this->restoreLetterhead($path, $this->templatePath($template));
        } catch (\Throwable $e) {
            @unlink($path);

            throw $e;
        } finally {
            $spreadsheet->disconnectWorksheets();
        }

        return response()
            ->download($path, $this->fileName($name), [
                'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ])
            ->deleteFileAfterSend(true);
    }

    /**
     * The filled workbook, before it is written anywhere.
     *
     * @param  string  $template  key from self::TEMPLATES
     */
    public function build(
        User $viewer,
        string $template,
        string $name,
        ?string $barangay = null,
        ?string $month = null,
        ?Carbon $from = null,
        ?Carbon $to = null,
        ?string $animalType = null,
    ): Spreadsheet {
        $spreadsheet = IOFactory::load($this->templatePath($template));
        $sheet = $spreadsheet->getActiveSheet();

        $this->fillCover($sheet, $viewer, $name, $month);

        $records = $this->records($barangay, $month, $from, $to, $animalType);

        $this->appendTable($sheet, $records);

        return $spreadsheet;
    }

    /**
     * The template's filename, resolved from the catalogue — never a path
     * supplied by a caller.
     */
    public function templatePath(string $template): string
    {
        $entry = self::TEMPLATES[$template] ?? null;

        if ($entry === null) {
            throw new RuntimeException("Unknown report template [{$template}].");
        }

        $path = resource_path('report-templates/'.$entry['file']);

        if (! is_file($path)) {
            throw new RuntimeException("Report template file is missing: {$entry['file']}.");
        }

        return $path;
    }

    /**
     * A download name that is safe on every filesystem: the admin's title,
     * slugged, with a neutral fallback when the title holds no filename-shaped
     * characters (e.g. only emoji or punctuation).
     */
    public function fileName(string $name): string
    {
        $slug = Str::slug($name);

        return ($slug !== '' ? $slug : 'cvo-report').'.xlsx';
    }

    /**
     * Cover-sheet placeholders: the editable title, the month line, and the
     * preparer slot (the template literally reads "Editable" there).
     *
     * The title is merged across the sheet's used width and wrapped, so a
     * custom name longer than the template's own still prints instead of
     * running past the page edge.
     */
    private function fillCover(Worksheet $sheet, User $viewer, string $name, ?string $month): void
    {
        $sheet->setCellValue('A'.self::ROW_TITLE, $name);
        $sheet->mergeCells('A'.self::ROW_TITLE.':'.self::LAST_COLUMN.self::ROW_TITLE);
        $sheet->getStyle('A'.self::ROW_TITLE)->getAlignment()
            ->setWrapText(true)
            ->setVertical(Alignment::VERTICAL_CENTER);
        // Two lines of the default font fit; keeps a long title from clipping.
        $sheet->getRowDimension(self::ROW_TITLE)->setRowHeight(30);

        // No month filter means the template's own blank line stays: the
        // report is meant to be filled by hand, not to invent a month.
        if ($month !== null && $month !== '') {
            $sheet->setCellValue(
                'A'.self::ROW_MONTH,
                'For the month of '.Carbon::createFromFormat('Y-m', $month)->format('F Y'),
            );
        }

        $sheet->setCellValue('A'.self::ROW_PREPARED_BY, $viewer->name);
    }

    /**
     * The dispersal roster the template is titled after, scoped exactly like
     * the Reports screen: barangay, animal type, month and an optional range.
     *
     * @return Collection<int, DispersalEvent>
     */
    private function records(
        ?string $barangay,
        ?string $month,
        ?Carbon $from,
        ?Carbon $to,
        ?string $animalType,
    ): Collection {
        return DispersalEvent::query()
            ->with('beneficiary')
            ->whereHas('beneficiary', function ($query) use ($barangay, $animalType): void {
                $query
                    ->when($barangay, fn ($q) => $q->where('address', $barangay))
                    ->when($animalType, fn ($q) => $q->where('animal_type', $animalType));
            })
            ->when($month, function ($query) use ($month): void {
                $query->whereYear('date_dispersed', substr($month, 0, 4))
                    ->whereMonth('date_dispersed', substr($month, 5, 2));
            })
            ->when($from, fn ($query) => $query->whereDate('date_dispersed', '>=', $from->toDateString()))
            ->when($to, fn ($query) => $query->whereDate('date_dispersed', '<=', $to->toDateString()))
            ->orderBy('date_dispersed')
            ->orderBy('id')
            ->get();
    }

    /**
     * Insert the roster above the signature block and write it.
     *
     * Rows are inserted rather than overwritten: the template's signatures sit
     * at rows 11-15 and an official report signs at the bottom, after the
     * table. Every field is written to the row's first cell and the wide
     * columns are merged, so the whole table fits the template's A:I width
     * WITHOUT touching column widths — the letterhead images are anchored to
     * those columns and the writer would stretch them to match.
     *
     * @param  Collection<int, DispersalEvent>  $records
     */
    private function appendTable(Worksheet $sheet, Collection $records): void
    {
        $dataRowCount = max($records->count(), 1);

        // Data rows + one blank spacer before the signatures.
        $sheet->insertNewRowBefore(self::FIRST_DATA_ROW, $dataRowCount + 1);

        $header = self::ROW_TABLE_HEADER;
        $merges = ['B', 'D'];

        $labels = [
            'A' => 'Date Dispersed',
            'B' => 'Name of Farmer',
            'D' => 'Barangay',
            'F' => 'Animal Type',
            'G' => 'Sex',
            'H' => 'Dispersal Type',
            'I' => 'Ear Tag #',
        ];

        foreach ($labels as $column => $label) {
            $sheet->setCellValue($column.$header, $label);
        }

        foreach ($merges as $column) {
            $sheet->mergeCells($column.$header.':'.$this->nextColumn($column).$header);
        }

        $headerRange = 'A'.$header.':'.self::LAST_COLUMN.$header;
        $sheet->getStyle($headerRange)->getFont()->setBold(true);
        $sheet->getStyle($headerRange)->getFill()
            ->setFillType(Fill::FILL_SOLID)
            ->getStartColor()->setRGB('DCE8D9');
        $sheet->getStyle($headerRange)->getBorders()->getAllBorders()
            ->setBorderStyle(Border::BORDER_THIN);
        $sheet->getStyle($headerRange)->getAlignment()
            ->setWrapText(true)
            ->setVertical(Alignment::VERTICAL_CENTER);
        $sheet->getRowDimension($header)->setRowHeight(30);

        if ($records->isEmpty()) {
            $sheet->setCellValue('A'.self::FIRST_DATA_ROW, 'No dispersal records match the selected filters.');
            $sheet->mergeCells('A'.self::FIRST_DATA_ROW.':'.self::LAST_COLUMN.self::FIRST_DATA_ROW);
            $sheet->getStyle('A'.self::FIRST_DATA_ROW)->getFont()->setItalic(true);
            $sheet->getStyle('A'.self::FIRST_DATA_ROW.':'.self::LAST_COLUMN.self::FIRST_DATA_ROW)
                ->getBorders()->getAllBorders()->setBorderStyle(Border::BORDER_THIN);

            return;
        }

        $row = self::FIRST_DATA_ROW;

        foreach ($records as $record) {
            $beneficiary = $record->beneficiary;

            // A real date cell (Excel serial + format), not a text date: the
            // column stays sortable and reads correctly in any locale.
            $sheet->setCellValue(
                'A'.$row,
                $record->date_dispersed !== null
                    ? ExcelDate::PHPToExcel($record->date_dispersed->toDateTime())
                    : '',
            );
            $sheet->getStyle('A'.$row)->getNumberFormat()->setFormatCode('dd/mm/yy');

            $sheet->setCellValue('B'.$row, $beneficiary?->name_of_farmer ?? '');
            $sheet->mergeCells('B'.$row.':C'.$row);

            $sheet->setCellValue('D'.$row, $beneficiary?->address ?? '');
            $sheet->mergeCells('D'.$row.':E'.$row);

            $sheet->setCellValue('F'.$row, $beneficiary?->animal_type ?? '');
            $sheet->setCellValue('G'.$row, $beneficiary?->sex ?? '');
            $sheet->setCellValue('H'.$row, ucfirst((string) $record->dispersal_type));
            $sheet->setCellValue('I'.$row, $beneficiary?->ear_tag_number ?? '');

            $range = 'A'.$row.':'.self::LAST_COLUMN.$row;
            $sheet->getStyle($range)->getBorders()->getAllBorders()
                ->setBorderStyle(Border::BORDER_THIN);
            $sheet->getStyle($range)->getAlignment()
                ->setWrapText(true)
                ->setVertical(Alignment::VERTICAL_TOP);
            // Two wrapped lines at the default font; names and the
            // "re-dispersal" label are the rows that need the second one.
            $sheet->getRowDimension($row)->setRowHeight(28);

            $row++;
        }
    }

    /**
     * Copy the template's letterhead text box into the generated package.
     *
     * The shape is a self-contained `<xdr:twoCellAnchor>` (no image relation),
     * so moving its XML across packages is safe: it references no part of the
     * template's relationship graph.
     */
    private function restoreLetterhead(string $generatedFile, string $templateFile): void
    {
        $anchor = $this->letterheadAnchor($this->drawingXml($templateFile));

        if ($anchor === null) {
            throw new RuntimeException('The report template has no letterhead text box to restore.');
        }

        $zip = new ZipArchive;

        if ($zip->open($generatedFile) !== true) {
            throw new RuntimeException('Could not open the generated report to restore its letterhead.');
        }

        try {
            $drawing = $zip->getFromName('xl/drawings/drawing1.xml');

            if ($drawing === false) {
                throw new RuntimeException('The generated report has no drawing part to restore the letterhead into.');
            }

            $patched = str_replace('</xdr:wsDr>', $anchor.'</xdr:wsDr>', $drawing, $replacements);

            if ($replacements !== 1) {
                throw new RuntimeException('Could not restore the report letterhead.');
            }

            $zip->addFromString('xl/drawings/drawing1.xml', $patched);
        } finally {
            $zip->close();
        }
    }

    /** The worksheet drawing XML, or '' when the workbook has none. */
    private function drawingXml(string $xlsx): string
    {
        $zip = new ZipArchive;

        if ($zip->open($xlsx) !== true) {
            return '';
        }

        $drawing = $zip->getFromName('xl/drawings/drawing1.xml');
        $zip->close();

        return $drawing === false ? '' : $drawing;
    }

    /**
     * The one anchor block holding a shape (the address box) rather than a
     * picture. Scanned block by block instead of with one backtracking
     * pattern, since drawing XML can hold many anchors.
     */
    private function letterheadAnchor(string $drawingXml): ?string
    {
        $closing = '</xdr:twoCellAnchor>';
        $offset = 0;

        while (($start = strpos($drawingXml, '<xdr:twoCellAnchor', $offset)) !== false) {
            $end = strpos($drawingXml, $closing, $start);

            if ($end === false) {
                return null;
            }

            $end += strlen($closing);
            $block = substr($drawingXml, $start, $end - $start);

            if (str_contains($block, '<xdr:sp ')) {
                return $block;
            }

            $offset = $end;
        }

        return null;
    }

    /** The next column letter, for the two-column field merges. */
    private function nextColumn(string $column): string
    {
        return chr(ord($column) + 1);
    }
}
