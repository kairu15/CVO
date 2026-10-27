<?php

namespace App\Console\Commands;

use App\Services\AnimalDispersalService;
use Illuminate\Console\Command;

/**
 * Check the ownership chain's two invariants for every animal:
 *
 *   (a) each active event's `from` equals the previous active event's `to`;
 *   (b) `animals.current_owner_id` equals the last active event's `to`.
 *
 * READ-ONLY. A break is reported, never repaired — a mismatch means either a
 * bug or a hand-edited row, and both deserve a human decision. Exit status is
 * non-zero when anything is wrong, so this can gate a deploy or run in CI.
 */
class VerifyOwnershipChain extends Command
{
    protected $signature = 'ownership:verify';

    protected $description = "Check every animal's ownership chain and current owner for drift";

    public function handle(AnimalDispersalService $dispersals): int
    {
        $report = $dispersals->verifyChain();

        $this->info(sprintf(
            'Checked %d animal(s) and %d active event(s).',
            $report['animals_checked'],
            $report['events_checked'],
        ));

        if ($report['breaks'] === []) {
            $this->info('No problems found: every chain is continuous and every current owner matches its last event.');

            return self::SUCCESS;
        }

        $this->newLine();
        $this->error(sprintf('Found %d problem(s):', count($report['breaks'])));

        foreach ($report['breaks'] as $break) {
            $this->line(sprintf(
                '  [%s] animal #%d%s → expected %s, found %s',
                $break['type'],
                $break['animal_id'],
                isset($break['event_id']) && $break['event_id'] !== null ? " event #{$break['event_id']}" : '',
                $break['type'] === 'from_mismatch'
                    ? 'from_beneficiary_id '.($break['expected_from_beneficiary_id'] ?? 'null')
                    : 'current_owner_id '.($break['expected_current_owner_id'] ?? 'null'),
                $break['type'] === 'from_mismatch'
                    ? ($break['actual_from_beneficiary_id'] ?? 'null')
                    : ($break['actual_current_owner_id'] ?? 'null'),
            ));
        }

        return self::FAILURE;
    }
}
