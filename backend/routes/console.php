<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
 * Smart Alerts (on-system, rule-based).
 *
 * Runs daily at midnight in the application timezone (Asia/Manila — set in
 * config/app.php). Plain SQL aggregation over existing records — no external
 * API, no model, no API key. This only fires when the host's cron calls
 * `php artisan schedule:run` every minute (standard Laravel deployment);
 * locally, `php artisan schedule:work` does the same in a loop. Run it by
 * hand with `php artisan alerts:compute-smart`.
 */
Schedule::command('alerts:compute-smart')->dailyAt('00:30');
