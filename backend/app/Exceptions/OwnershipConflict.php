<?php

namespace App\Exceptions;

use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * A 409 for a conflicting or stale ownership-chain state — the caller's view
 * of the animal no longer matches the server's.
 *
 * The two cases the API distinguishes:
 *
 *   stale_event       the `base_event_id` the client sent is not the animal's
 *                     latest active event (someone else changed it). The
 *                     client must refresh and re-submit. This is also what an
 *                     offline replay gets when its queued item is stale, so
 *                     the offline queue can surface it as a CONFLICT instead
 *                     of applying it.
 *   animal_not_active the animal is deceased or already returned — no new
 *                     handover is possible.
 *
 * The machine-readable `error_code` rides in the JSON body (not only a
 * header) so it survives CORS without an exposed-headers entry.
 */
class OwnershipConflict extends HttpException
{
    public const CODE_STALE_EVENT = 'stale_event';

    public const CODE_ANIMAL_NOT_ACTIVE = 'animal_not_active';

    public function __construct(
        public readonly string $errorCode,
        string $message,
    ) {
        parent::__construct(Response::HTTP_CONFLICT, $message);
    }

    public static function staleEvent(int|string|null $actualLatest): self
    {
        $actual = $actualLatest === null ? 'none' : (string) $actualLatest;

        return new self(
            self::CODE_STALE_EVENT,
            "This animal's ownership chain changed since you loaded it (latest event is now {$actual}). Refresh and try again.",
        );
    }

    public static function animalNotActive(string $status): self
    {
        return new self(
            self::CODE_ANIMAL_NOT_ACTIVE,
            "This animal is {$status} and cannot be handed over again.",
        );
    }

    /**
     * Render the code alongside the message for both the SPA and the mobile
     * client — the frontend keys its conflict UI off `error_code`.
     */
    public function render(): Response
    {
        return response()->json([
            'message' => $this->getMessage(),
            'error_code' => $this->errorCode,
        ], Response::HTTP_CONFLICT);
    }
}
