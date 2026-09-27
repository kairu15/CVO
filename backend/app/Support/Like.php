<?php

namespace App\Support;

/**
 * LIKE-pattern helper (item 6).
 *
 * The audit found no injectable SQL: every raw/`LIKE` query binds the user
 * term as a parameter, so a payload like `'; DROP TABLE beneficiaries; --`
 * is treated as literal text to match. What bindings do NOT neutralize is
 * the LIKE wildcard vocabulary itself — an unescaped `%` in a search box
 * matches every row (a cheap way to drag the DB through full scans) and `_`
 * silently widens a match. Escape both before embedding a user term in a
 * pattern, and tell the query the escape character.
 */
class Like
{
    /**
     * Escape SQL LIKE wildcards in user input.
     */
    public static function escape(string $term): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term);
    }

    /**
     * A contains-pattern for a user term, wildcards neutralized.
     */
    public static function contains(string $term): string
    {
        return '%'.self::escape(mb_strtolower(trim($term))).'%';
    }
}
