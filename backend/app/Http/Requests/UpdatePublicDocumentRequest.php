<?php

namespace App\Http\Requests;

use App\Models\PublicDocument;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Edit a public document's metadata, or publish/unpublish it.
 *
 * The file itself is immutable — replacing the PDF is a new upload, so the
 * audit trail keeps one row per published artefact. Publishing stamps
 * published_at once; unpublishing clears it, and a later re-publish stamps a
 * fresh date rather than resurrecting the old one.
 */
class UpdatePublicDocumentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission('manage_settings');
    }

    public function rules(): array
    {
        return [
            'title' => ['sometimes', 'required', 'string', 'max:200'],
            'description' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'category' => [
                'sometimes',
                'required',
                'string',
                'in:' . implode(',', array_keys(PublicDocument::CATEGORIES)),
            ],
            'published' => ['sometimes', 'boolean'],
        ];
    }
}
