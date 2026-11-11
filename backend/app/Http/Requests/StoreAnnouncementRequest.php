<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Create an announcement. Admin-only: the route group carries
 * EnsureUserIsAdmin + permission:manage_settings, and this request re-checks
 * the same capability as the second gate (the repo's standard pattern).
 */
class StoreAnnouncementRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission('manage_settings');
    }

    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:200'],
            // Plain text body — the landing page renders it as paragraphs.
            'body' => ['required', 'string', 'max:5000'],
            'is_pinned' => ['sometimes', 'boolean'],
            // The form's publish flag; the controller maps it to published_at
            // (now() when publishing, null when a draft).
            'published' => ['sometimes', 'boolean'],
        ];
    }
}
