<?php

namespace App\Console\Commands;

use App\Models\FieldVisit;
use App\Services\FieldVisitVerificationService;
use Illuminate\Console\Command;

/**
 * Re-derive every stored on-site verdict from the coordinates on file.
 *
 * The verdict is already recomputed on every save, photo attach and sync
 * replay; this command exists for the two moments those paths do not cover:
 *
 *   - after an administrator changes the on-site threshold in System
 *     Settings (the stored verdicts were judged against the OLD number), and
 *   - after a bulk data load (the Excel import) that created households and
 *     visits without passing through the normal save path.
 *
 *     php artisan visits:recompute-verification
 */
class RecomputeVerification extends Command
{
    protected $signature = 'visits:recompute-verification';

    protected $description = 'Re-derive field visits\' on-site verification status from stored coordinates';

    public function handle(FieldVisitVerificationService $verification): int
    {
        $count = 0;

        FieldVisit::query()->chunkById(200, function ($visits) use ($verification, &$count): void {
            foreach ($visits as $visit) {
                $verification->refresh($visit);
                $count++;
            }
        });

        $this->info("Re-evaluated {$count} field visit(s) against the current on-site threshold ({$verification->thresholdM()} m).");

        return self::SUCCESS;
    }
}
