<?php

namespace App\Support;

/**
 * One page-size policy for every list endpoint.
 *
 * "50 maximum each": the API never returns more than MAX_PER_PAGE rows in one
 * response, and defaults to the same 50 when the caller does not ask for a
 * size. The cap lives here rather than in each FormRequest so the rule cannot
 * drift between endpoints, and it is applied by CLAMPING an over-limit value
 * rather than rejecting it: existing clients that used to request 100–500 rows
 * keep working, they simply page through 50 at a time instead of erroring.
 *
 * Validation still rejects a non-integer or sub-1 `per_page` (a 0 or "abc" is
 * a client bug worth surfacing), but the upper bound is enforced here so every
 * list endpoint answers with a bounded page no matter what it is handed.
 */
class Pagination
{
    /** Hard ceiling on rows per response, across the API. */
    public const MAX_PER_PAGE = 50;

    /** Page size used when the caller does not ask for one. */
    public const DEFAULT_PER_PAGE = 50;

    /**
     * Clamp a caller-supplied page size into 1..MAX, defaulting to
     * DEFAULT_PER_PAGE when it is absent or not a number.
     */
    public static function perPage(mixed $requested): int
    {
        if (! is_numeric($requested)) {
            return self::DEFAULT_PER_PAGE;
        }

        return max(1, min(self::MAX_PER_PAGE, (int) $requested));
    }
}
