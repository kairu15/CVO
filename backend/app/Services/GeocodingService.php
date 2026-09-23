<?php

namespace App\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Address-to-coordinates resolution via OpenStreetMap Nominatim.
 *
 * Free, no API key - consistent with the map stack. Nominatim's usage policy
 * requires at most 1 request/second and an identifying User-Agent, both of
 * which this client enforces. Definitive "not found" results are cached
 * forever (they don't change); transient network/SSL failures are NOT cached
 * so a temporary outage doesn't poison the lookup table.
 *
 * On Windows/XAMPP PHP usually ships without a CA bundle (cURL error 60).
 * Point GEOCODING_CA_BUNDLE at a cacert.pem, or set curl.cainfo in php.ini -
 * otherwise every HTTPS lookup fails and callers fall back to barangay
 * centroids.
 */
class GeocodingService
{
    private const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

    private const USER_AGENT = 'CVO-Livestock-Monitoring/1.0 (City Veterinary Office, Negros Oriental)';

    /**
     * Candidate spellings: as typed, then with inner spaces collapsed -
     * OSM indexes e.g. "Banaybanay" while locals write "Banay Banay".
     *
     * @return array{lat: float, lng: float, display_name: string}|null
     */
    public function geocode(string $address, ?string $context = null): ?array
    {
        $query = trim($address);

        if ($query === '') {
            return null;
        }

        $candidates = [$query];

        $collapsed = str_replace(' ', '', $query);

        if ($collapsed !== '' && str_contains($query, ' ')) {
            $candidates[] = $collapsed;
        }

        foreach ($candidates as $candidate) {
            $hit = $this->lookup($candidate, $context);

            if ($hit !== null) {
                return $hit;
            }
        }

        return null;
    }

    /**
     * One cached lookup of a single candidate spelling.
     *
     * @return array{lat: float, lng: float, display_name: string}|null
     */
    private function lookup(string $candidate, ?string $context): ?array
    {
        // Disambiguate short barangay names by scoping to the city/province.
        $search = $context ? "{$candidate}, {$context}" : $candidate;

        $key = 'geocode:'.md5(mb_strtolower($search));

        $cached = Cache::get($key);

        if ($cached !== null) {
            return $cached === 'miss' ? null : $cached;
        }

        $result = $this->request($search);

        // null = transient failure (network/SSL/rate limit): not cached, so
        // the next attempt retries the network instead of repeating the miss.
        // 'miss' = definitive negative result: cached forever.
        if ($result !== null) {
            Cache::forever($key, $result);
        }

        return $result === 'miss' ? null : $result;
    }

    /**
     * Perform the HTTP lookup.
     *
     * @return array{lat: float, lng: float, display_name: string}|'miss'|null
     *                                                                         a hit, a definitive miss, or null on a transient failure
     */
    private function request(string $search): array|string|null
    {
        try {
            $response = $this->httpClient()->get(self::ENDPOINT, [
                'q' => $search,
                'format' => 'jsonv2',
                'limit' => 1,
                'countrycodes' => 'ph', // keep results in the Philippines
                'viewbox' => '122.60,9.90,123.05,9.10', // Negros Oriental bbox
                'bounded' => '1',
            ]);

            if ($response->failed()) {
                // 429/5xx are transient; treat any HTTP failure as transient
                // so a temporary outage is retried on the next lookup.
                return null;
            }

            $hit = $response->json()[0] ?? null;

            if (! $hit || ! isset($hit['lat'], $hit['lon'])) {
                return 'miss'; // definitive: address not in OSM
            }

            return [
                'lat' => (float) $hit['lat'],
                'lng' => (float) $hit['lon'],
                'display_name' => $hit['display_name'] ?? $search,
            ];
        } catch (\Throwable $e) {
            Log::warning('Geocoding failed: {message}', ['message' => $e->getMessage()]);

            return null;
        }
    }

    /**
     * HTTP client honouring Nominatim's usage policy, with an optional CA
     * bundle for Windows/XAMPP setups (GEOCODING_CA_BUNDLE or a cacert.pem
     * dropped into storage/app).
     */
    private function httpClient(): PendingRequest
    {
        $caBundle = config('services.geocoding.ca_bundle');

        if (! $caBundle && file_exists(storage_path('app/cacert.pem'))) {
            $caBundle = storage_path('app/cacert.pem');
        }

        // Nominatim enforces max 1 req/s per client - space retries well
        // beyond that or every burst after the first request gets 429'd.
        $client = Http::withHeaders([
            'User-Agent' => self::USER_AGENT,
            'Accept' => 'application/json',
        ])
            ->timeout(8)
            ->retry(2, 1500, throw: false);

        return $caBundle ? $client->withOptions(['verify' => $caBundle]) : $client;
    }
}
