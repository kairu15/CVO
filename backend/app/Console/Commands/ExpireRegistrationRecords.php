<?php

namespace App\Console\Commands;

use App\Services\MonitoringRecordService;
use Illuminate\Console\Command;

/**
 * Flip registration-created monitoring records past their midnight expiry
 * to `old`, so the green "New" highlight never lingers unattended.
 *
 * REQUIRES the Laravel scheduler: this command does nothing on its own —
 * the host's cron must call `php artisan schedule:run` every minute, per
 * standard Laravel deployment. On a typical *nix host:
 *
 *     * * * * * cd /path-to/CVO/backend && php artisan schedule:run >> /dev/null 2>&1
 *
 * Locally (Windows dev), `php artisan schedule:work` runs the same schedule
 * in a blocking loop. The schedule is registered in routes/console.php at
 * 00:00 in the application timezone (Asia/Manila).
 */
class ExpireRegistrationRecords extends Command
{
    protected $signature = 'monitoring:expire-registrations';

    protected $description = 'Flip registration monitoring records past midnight expiry from new/accepted to old';

    public function handle(MonitoringRecordService $records): int
    {
        $flipped = $records->expireDueRegistrations();

        $this->info("{$flipped} monitoring record(s) flipped to old.");

        return self::SUCCESS;
    }
}
