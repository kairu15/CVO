<?php

use App\Services\GeocodingService;
use Illuminate\Contracts\Console\Kernel;

// One-off geocoding smoke test: php scripts/geo-smoke.php "Banay Banay"
require __DIR__.'/../vendor/autoload.php';

$app = require __DIR__.'/../bootstrap/app.php';
$kernel = $app->make(Kernel::class);
$kernel->bootstrap();

$svc = app(GeocodingService::class);

$addresses = isset($argv[1]) && $argv[1] !== ''
    ? [$argv[1]]
    : ['Banay Banay', 'Dawis', 'Tayawan', 'Kalumboyan', 'Cansumalig'];

foreach ($addresses as $address) {
    $hit = $svc->geocode($address, 'Bayawan, Philippines');
    echo $address.' -> '.($hit
        ? $hit['lat'].', '.$hit['lng'].' | '.substr($hit['display_name'], 0, 60)
        : 'FAILED').PHP_EOL;
}
