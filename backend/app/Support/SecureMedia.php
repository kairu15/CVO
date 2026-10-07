<?php

namespace App\Support;

use Illuminate\Support\Facades\Storage;

/**
 * Root-relative signed URLs for the private `secure` disk.
 *
 * Storage::temporaryUrl() returns an ABSOLUTE URL rooted at whatever the
 * current request (or APP_URL, outside a request) says. That is fine on one
 * origin and broken the moment the SPA is reached through another one — an
 * ngrok tunnel, a staging domain: the page would ask for media from a host
 * it cannot reach, or request an http:// URL from an https:// page and be
 * blocked as mixed content.
 *
 * The host was never load-bearing: the framework's serve route validates the
 * signature RELATIVELY (ServeFile::hasValidRelativeSignature — path + query
 * only), so the same signed URL is valid on every host. Handing back just the
 * path + query lets the browser resolve it against whichever origin it is
 * actually on — localhost, the tunnel, or the production domain — provided
 * the origin serves /secure-files to the API (the dev servers proxy it).
 */
class SecureMedia
{
    /**
     * A root-relative, short-lived signed URL for a file on the secure disk.
     */
    public static function temporaryUrl(string $path, \DateTimeInterface $expiration, array $options = []): string
    {
        $absolute = Storage::disk('secure')->temporaryUrl($path, $expiration, $options);

        $parts = parse_url($absolute);

        if (($parts['path'] ?? null) === null || ($parts['query'] ?? null) === null) {
            // Not the shape the serve route produces — return it untouched
            // rather than guess at a different URL scheme (e.g. an S3-style
            // driver swap) that this helper was not built for.
            return $absolute;
        }

        return $parts['path'].'?'.$parts['query'];
    }
}
