<?php

namespace App\Console\Commands;

use App\Services\SmartAlertService;
use Illuminate\Console\Command;

/**
 * Daily Smart Alerts scan — plain, rule-based flags over records already in
 * the system. No model, no external API, no API key.
 *
 * Writes (and clears) `user_notifications` rows from the rules defined in
 * SmartAlertService: overdue vaccination, BCS outside a confirmed normal
 * range, no recent field visit, and a barangay whose share of concern remarks
 * runs above the city-wide share. Thresholds live in config/cvo.php.
 *
 * Like the midnight-expiry job, this REQUIRES Laravel's scheduler: the host's
 * cron must call `php artisan schedule:run` every minute, or `php artisan
 * schedule:work` locally. The schedule is registered in routes/console.php.
 * Without it the scan can always be run by hand:
 *
 *     php artisan alerts:compute-smart
 */
class ComputeSmartAlerts extends Command
{
    protected $signature = 'alerts:compute-smart';

    protected $description = 'Scan records for Smart Alerts and reconcile stored admin/technician flags';

    public function handle(SmartAlertService $alerts): int
    {
        $counts = $alerts->run();

        foreach ($counts as $rule => $rows) {
            $this->line(sprintf('  %-22s %d alert row(s)', $rule, $rows));
        }

        if (! $alerts->bcsRuleEnabled()) {
            $this->warn(
                'BCS out-of-range rule is DISABLED: no confirmed per-species normal ranges in '
                .'config/cvo.php (smart_alerts.bcs_normal_ranges). This is intentional until a '
                .'CVO veterinarian supplies them — see the TODO there.'
            );
        }

        $this->info('Smart Alerts scan complete.');

        return self::SUCCESS;
    }
}
