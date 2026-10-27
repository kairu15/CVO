<?php

namespace App\Console\Commands;

use App\Services\AnimalDispersalService;
use Illuminate\Console\Command;

/**
 * Backfill the animal ownership chain from the older beneficiary pass-on model.
 *
 * Idempotent and safe to re-run: `--dry-run` reports exactly what a real run
 * would do without writing anything, and a household already migrated is
 * skipped. Rows that cannot be migrated, and any chain breaks found afterwards,
 * are LISTED — never repaired silently.
 */
class OwnershipBackfill extends Command
{
    protected $signature = 'ownership:backfill
                            {--dry-run : Report what would be migrated without writing anything}';

    protected $description = 'Create animals and their first ownership events from the legacy beneficiary pass-on records';

    public function handle(AnimalDispersalService $dispersals): int
    {
        $dryRun = (bool) $this->option('dry-run');

        $report = $dispersals->backfillOwnership($dryRun);

        $this->info($dryRun ? 'DRY RUN — nothing was written.' : 'Backfill complete.');

        $this->table(
            ['', 'Animals', 'Ownership events'],
            [
                ['Before', $report['before']['animals'], $report['before']['events']],
                ['After', $report['after']['animals'], $report['after']['events']],
            ],
        );

        $this->line(sprintf('Migrated: %d  |  Already migrated (skipped): %d  |  Households with no dispersal record: %d',
            $report['migrated'],
            $report['skipped'],
            $report['without_delivery_event'],
        ));

        if ($report['unusable'] !== []) {
            $this->newLine();
            $this->warn(sprintf('%d row(s) could NOT be migrated:', count($report['unusable'])));

            foreach ($report['unusable'] as $row) {
                $this->line("  beneficiary #{$row['beneficiary_id']} — {$row['reason']}");
            }
        }

        $breaks = $report['verify']['breaks'];

        if ($breaks !== []) {
            $this->newLine();
            $this->error(sprintf('Chain verification found %d problem(s) — inspect before relying on the flight paths:', count($breaks)));

            foreach ($breaks as $break) {
                $this->line(sprintf('  [%s] animal #%d', $break['type'], $break['animal_id']));
            }

            return self::FAILURE;
        }

        $this->newLine();
        $this->info('Chain verification: no problems found.');

        return self::SUCCESS;
    }
}
