<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
 * Registration "New" flag expiry for the Monitoring Records table.
 *
 * Runs daily at midnight in the application timezone (Asia/Manila — set in
 * config/app.php). NOTE: this only fires if the host's cron calls
 * `php artisan schedule:run` every minute (standard Laravel deployment);
 * locally, `php artisan schedule:work` does the same in a loop. Without
 * that cron entry, accepted/new records keep their highlight until the
 * command is run manually: php artisan monitoring:expire-registrations.
 */
Schedule::command('monitoring:expire-registrations')->dailyAt('00:00');

/*
 * Smart Alerts (on-system, rule-based).
 *
 * Runs after the midnight-expiry job so the day's registration state is
 * settled first. Plain SQL aggregation over existing records — no external
 * API, no model, no API key. Same scheduler dependency as above: this only
 * fires when the host runs `php artisan schedule:run` every minute. Run it by
 * hand with `php artisan alerts:compute-smart`.
 */
Schedule::command('alerts:compute-smart')->dailyAt('00:30');
