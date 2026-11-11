<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreContactMessageRequest;
use App\Mail\ContactMessageReceived;
use App\Models\ContactMessage;
use App\Services\SettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Symfony\Component\HttpFoundation\Response;

/**
 * The public contact form (`POST /public/contact`).
 *
 * Every valid submission is STORED (the record survives a mailer outage and
 * gives the office an audit copy) and then forwarded to the office email from
 * System Settings when a mailer is configured — the inbox is what the office
 * actually reads. Mail failure never fails the request: the visitor's
 * submission must not be lost because SMTP hiccupped, and the stored row is
 * the source of truth.
 *
 * Abuse is bounded by the route's throttle (5/min per IP), by validation, and
 * by the fact that this table is never exposed publicly.
 */
class PublicContactController extends Controller
{
    public function __construct(private readonly SettingsService $settings) {}

    public function store(StoreContactMessageRequest $request): JsonResponse
    {
        $message = ContactMessage::create($request->validated());

        $this->forwardToOffice($message);

        return response()->json([
            'data' => [
                'message' => 'Thank you — your message has been received. The office will get back to you through the contact details you provided.',
            ],
        ], Response::HTTP_CREATED);
    }

    /**
     * Best-effort email forward to the office inbox. Logged, never thrown —
     * see the class docblock.
     */
    private function forwardToOffice(ContactMessage $message): void
    {
        $officeEmail = trim((string) ($this->settings->officeProfile()['office_email'] ?? ''));

        if ($officeEmail === '' || str_contains($officeEmail, 'example.gov.ph')) {
            // No real inbox configured (shipped placeholder) — storing is the
            // whole delivery. Avoids mailing a placeholder address.
            return;
        }

        try {
            Mail::to($officeEmail)->send(new ContactMessageReceived($message));
        } catch (\Throwable $error) {
            Log::warning('Contact message could not be forwarded to the office inbox.', [
                'contact_message_id' => $message->id,
                'error' => $error->getMessage(),
            ]);
        }
    }
}
