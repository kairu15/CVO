<?php

namespace App\Console\Commands;

use App\Models\Beneficiary;
use App\Services\AnimalTypeCatalog;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Report (and optionally apply) the mapping from the old free-text
 * `beneficiaries.animal_type` values to the CVO master list.
 *
 * The migration only settles values with exactly one plausible type. This
 * command shows the REST — every distinct legacy value with its row count and
 * why it could not be mapped — so the office can correct them by hand instead
 * of losing or misclassifying an animal.
 *
 * `--apply` writes the values the resolver is confident about (a single type,
 * or a single type + classification) and rewrites the legacy display string to
 * the master type's name so the filters, exports and the new dropdown agree.
 * Ambiguous and unmatched values are never written; they stay visible in the
 * report until an administrator corrects the rows in the UI.
 */
class AnimalTypeMappingReport extends Command
{
    protected $signature = 'animal-types:mapping-report {--apply : Write the mappings the resolver is confident about}';

    protected $description = 'Report legacy animal-type values that are not yet mapped to the master list';

    public function handle(AnimalTypeCatalog $catalog): int
    {
        $rows = DB::table('beneficiaries')
            ->selectRaw('animal_type, count(*) as total')
            ->whereNull('deleted_at')
            ->whereNull('animal_type_id')
            ->groupBy('animal_type')
            ->orderByDesc('total')
            ->orderBy('animal_type')
            ->get();

        if ($rows->isEmpty()) {
            $this->info('Every animal record is mapped to the master list — nothing to review.');

            return self::SUCCESS;
        }

        $report = [];
        $totals = ['mapped' => 0, 'ambiguous' => 0, 'unmatched' => 0, 'empty' => 0];

        foreach ($rows as $row) {
            $resolution = $catalog->resolve($row->animal_type);
            $totals[$resolution['status']] = ($totals[$resolution['status']] ?? 0) + (int) $row->total;

            $report[] = [
                $row->animal_type === null || $row->animal_type === '' ? '(blank)' : $row->animal_type,
                (int) $row->total,
                $this->statusLabel($resolution['status']),
                $this->targetLabel($resolution),
                $resolution['status'] === 'ambiguous' ? implode(', ', $resolution['candidates']) : '',
            ];
        }

        $this->table(
            ['Legacy value', 'Rows', 'Status', 'Maps to', 'Candidates'],
            $report,
        );

        $this->newLine();
        $this->line(sprintf(
            '%d mapped cleanly · %d ambiguous · %d unknown/blank',
            $totals['mapped'],
            $totals['ambiguous'],
            $totals['unmatched'] + $totals['empty'],
        ));

        if (! $this->option('apply')) {
            $this->line('Nothing was written. Re-run with --apply to save the confident mappings.');

            return self::SUCCESS;
        }

        $applied = 0;

        foreach ($rows as $row) {
            $resolution = $catalog->resolve($row->animal_type);

            if ($resolution['status'] !== 'mapped' || $resolution['type'] === null) {
                continue;
            }

            $query = Beneficiary::query()
                ->whereNull('animal_type_id')
                ->whereRaw('LOWER(TRIM(animal_type)) = ?', [mb_strtolower(trim((string) $row->animal_type))]);

            $applied += $query->update([
                'animal_type_id' => $resolution['type']->id,
                'classification_id' => $resolution['classification']?->id,
                'animal_type' => $resolution['type']->name,
            ]);
        }

        $this->info("Applied {$applied} mapped record(s). The remaining rows are listed above for manual correction.");

        return self::SUCCESS;
    }

    private function statusLabel(string $status): string
    {
        return match ($status) {
            'mapped' => 'Maps cleanly',
            'ambiguous' => 'Ambiguous',
            'empty' => 'Blank / Unspecified',
            default => 'No match',
        };
    }

    /** @param array<string, mixed> $resolution */
    private function targetLabel(array $resolution): string
    {
        if ($resolution['type'] === null) {
            return '—';
        }

        return $resolution['classification'] !== null
            ? $resolution['type']->name.' → '.$resolution['classification']->name
            : $resolution['type']->name;
    }
}
