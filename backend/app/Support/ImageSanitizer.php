<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/**
 * Server-side hardening for image uploads (item 8).
 *
 * Defense in depth, in the order it applies:
 *
 * 1. VALIDATION — Laravel's `image` + `mimes:` rules already sniff the real
 *    content type with finfo (not the client-declared one) and cap the size.
 *    This class adds a strict re-check so even the allowed set is verified
 *    against config/security.php, not hardcoded at call sites.
 *
 * 2. NAMING — the client's filename is NEVER trusted: files are stored under
 *    a server-generated random name inside a fixed directory, which removes
 *    path traversal (`../../`), overwrite-of-an-existing-file and
 *    content-disguise (`photo.jpg` that is really PHP) in one move.
 *
 * 3. STORAGE — everything lands on the private `secure` disk, outside the
 *    public webroot. Access goes through Laravel's signed storage route
 *    (temporaryUrl), so an unguessable-random URL alone never grants access.
 *
 * 4. METADATA — EXIF blocks are stripped with GD on re-encode. The
 *    geotag fields the CVO system is designed to capture (lat/lng, capture
 *    time, accuracy…) are stored as structured, queryable COLUMNS on
 *    field_visit_photos — not read back out of EXIF — so stripping the
 *    header loses nothing the app depends on while removing device serials,
 *    thumbnails and any accidental location data from the bytes themselves.
 */
class ImageSanitizer
{
    /**
     * Re-encode an uploaded image, dropping every metadata block.
     *
     * The pixel data survives intact; GPS EXIF, camera make/model, serials
     * and embedded thumbnails do not. Returns the sanitized file ready for
     * storage on the private disk.
     *
     * @throws \RuntimeException when the file cannot be parsed as an image
     *                           (the caller validates first — this is the
     *                           belt to validation's braces).
     */
    public static function stripMetadata(UploadedFile $file): string
    {
        $path = $file->getRealPath();
        $mime = (string) ($file->getMimeType() ?? '');

        $image = match ($mime) {
            'image/jpeg' => @imagecreatefromjpeg($path),
            'image/png' => @imagecreatefrompng($path),
            'image/webp' => @imagecreatefromwebp($path),
            default => false,
        };

        if ($image === false) {
            // A validation failure, not a 500: the client sent something the
            // validator let through but GD cannot decode (corrupt file, or a
            // payload crafted to sneak past finfo). Answer 422.
            throw \Illuminate\Validation\ValidationException::withMessages([
                'file' => 'The uploaded file is not a valid image.',
            ]);
        }

        // Re-encode to JPEG: the same container the CVO photos already use,
        // maximum compatibility for the client-side compositor.
        $target = tempnam(sys_get_temp_dir(), 'cvoimg');

        try {
            if (in_array($mime, ['image/png', 'image/webp'], true)) {
                // Non-JPEG sources may carry alpha; flatten onto white rather
                // than letting it turn black on JPEG encode.
                $flat = imagecreatetruecolor(imagesx($image), imagesy($image));
                $white = imagecolorallocate($flat, 255, 255, 255);
                imagefill($flat, 0, 0, $white);
                imagecopy($flat, $image, 0, 0, 0, 0, imagesx($image), imagesy($image));
                imagedestroy($image);
                $image = $flat;
            }

            imagejpeg($image, $target, 90);
        } finally {
            imagedestroy($image);
        }

        return $target;
    }

    /**
     * Normalize an uploaded image into a clean JPEG upload, ready for
     * storeImage(): re-encoded by GD (metadata gone), correct sniffed MIME,
     * neutral client filename.
     */
    public static function sanitizeToUpload(UploadedFile $file): UploadedFile
    {
        return new UploadedFile(
            self::stripMetadata($file),
            'image.jpg',
            'image/jpeg',
            null,
            true,
        );
    }

    /**
     * Server-generated storage name on the private disk: a fixed directory
     * per purpose, a random filename, the validated extension. The client's
     * original filename is used nowhere.
     *
     * Directory + extension are allow-listed values, not user input.
     */
    public static function storeImage(UploadedFile $file, string $directory): string
    {
        $allowed = (array) config('security.uploads.image_mimes', ['jpg', 'jpeg', 'png', 'webp']);

        $extension = strtolower((string) $file->getClientOriginalExtension());

        if (! in_array($extension, $allowed, true)) {
            // Sniffed MIME (already validated) decides the extension as a
            // fallback so a mismatched-but-real image still lands safely.
            $extension = match ($file->getMimeType()) {
                'image/png' => 'png',
                'image/webp' => 'webp',
                default => 'jpg',
            };
        }

        return Storage::disk('secure')->putFileAs(
            $directory,
            $file,
            strtolower(\Illuminate\Support\Str::random(40)).'.'.$extension,
        );
    }
}
