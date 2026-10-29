<?php

namespace App\Console\Commands;

use App\Models\AnimalOwnershipEvent;
use App\Models\Beneficiary;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Backfill the barangay snapshots (`from_barangay_id` / `to_barangay_id`) on
 * existing ownership events from the households' barangay as recorded now.
 *
 * These snapshots are what per-barangay dispersal analytics reads, so an
 * owner whose barangay is edited later never silently rewrites history.
 * Events written after the snapshot columns existed already carry them; this
 * command is for the rows written before.
 *
 * IDEMPOTENT: only rows whose relevant snapshot column is still NULL are
 * touched, so a re-run (or a `--dry-run` followed by a real run) writes
 * nothing twice. CVO-side ends (a dispersal's `from`, a return's `to`) are
 * legitimately NULL and stay NULL.
 *
 * NOTHING IS REPAIRED SILENTLY: events whose household has no barangay on
 * record (or whose household row is gone) are listed in the report — the
 * analytics treats them as "origin/destination unknown" until someone fixes
 * the household's barangay and re-runs this command.
 */
class BackfillOwnershipBarangays extends Command
{
    protected $signature = 'ownership:backfill-barangays
                            {--dry-run : Report what would be backfilled without writing anything}';

    protected $description = 'Fill the from/to barangay snapshots on ownership events from each household\'s barangay';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');

        $barangayByBeneficiaryId = Beneficiary::withTrashed()
            ->pluck('barangay_id', 'id')
            ->map(fn ($id) => $id === null ? null : (int) $id)
            ->all();

        // Rows still missing the snapshot on at least one side. An event is
        // counted once per side it is missing, so a chain hop with two
        // un-snapshotted ends appears in both numbers.
        $events = AnimalOwnershipEvent::query()
            ->where(fn ($q) => $q->whereNull('from_barangay_id')->orWhereNull('to_barangay_id'))
            ->get(['id', 'event_type', 'from_beneficiary_id', 'to_beneficiary_id']);

        $filledFrom = 0;
        $filledTo = 0;
        $unresolved = [];

        foreach ($events as $event) {
            foreach (['from' => 'from_beneficiary_id', 'to' => 'to_beneficiary_id'] as $side => $column) {
                if ($event->{$column} === null) {
                    continue; // CVO side: no barangay by definition
                }

                $barangayId = $barangayByBeneficiaryId[(int) $event->{$column}] ?? null;

                if ($barangayId === null) {
                    $unresolved[] = [
                        'event_id' => $event->id,
                        'event_type' => $event->event_type,
                        'side' => $side,
                        'beneficiary_id' => (int) $event->{$column},
                        'reason' => 'beneficiary_has_no_barangay',
                    ];

                    continue;
                }

                if ($side === 'from') {
                    $filledFrom++;
                } else {
                    $filledTo++;
                }

                if (! $dryRun) {
                    DB::table('animal_ownership_events')
                        ->where('id', $event->id)
                        ->update(["{$side}_barangay_id" => $barangayId]);
                }
            }
        }

        $this->info($dryRun ? 'DRY RUN — nothing was written.' : 'Backfill complete.');

        $this->line(sprintf(
            'Events examined: %d  |  From-side filled: %d  |  To-side filled: %d',
            $events->count(),
            $filledFrom,
            $filledTo,
        ));

        if ($unresolved !== []) {
            $this->newLine();
            $this->warn(sprintf(
                '%d event side(s) could NOT be snapshotted (analytics will count them as origin/destination unknown):',
                count($unresolved),
            ));

            foreach ($unresolved as $row) {
                $this->line(sprintf(
                    '  event #%d (%s) — %s beneficiary #%d: %s',
                    $row['event_id'],
                    $row['event_type'],
                    $row['side'] === 'from' ? 'source' : 'recipient',
                    $row['beneficiary_id'],
                    $row['reason'],
                ));
            }
        } else {
            $this->newLine();
            $this->info('Every non-CVO event side has a barangay on record.');
        }

        // Unresolved sides are listed for a human; the run itself succeeded.
        return self::SUCCESS;
    }
}
