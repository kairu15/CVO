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
