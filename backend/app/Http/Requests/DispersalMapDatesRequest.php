<?php

namespace App\Http\Requests;

use Illuminate\Support\Carbon;

/**
 * GET /api/v1/map/dates — the date selector's list request.
 *
 * Same capability as the snapshot; the optional from/to window limits a long
 * history, and page/per_page keep the response bounded. Malformed window
 * bounds are ignored (they only ever narrow the list) rather than 422-ing a
 * selector that may have half-typed them.
 */
class DispersalMapDatesRequest extends DispersalMapRequest
{
    /**
     * @return array{from: ?string, to: ?string}
     */
    public function window(): array
    {
        $from = $this->query('from');
        $to = $this->query('to');

        $parse = fn (?string $value): ?string => $value !== null && $value !== ''
            ? (Carbon::hasFormat($value, 'Y-m-d') ? $value : null)
            : null;

        return ['from' => $parse(is_string($from) ? $from : null), 'to' => $parse(is_string($to) ? $to : null)];
    }
}
