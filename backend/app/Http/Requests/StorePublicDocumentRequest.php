<?php

namespace App\Http\Requests;

use App\Models\PublicDocument;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\File;

/**
 * Upload a public document. Admin-only at the route (EnsureUserIsAdmin +
 * permission:manage_settings); this request is the second gate.
 *
 * PDF only, 10 MB cap: these are published reports and disclosures, and the
 * download streams through the API, so an oversized file would punish every
 * future reader on a field connection.
 */
class StorePublicDocumentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission('manage_settings');
    }

    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:200'],
            'description' => ['nullable', 'string', 'max:1000'],
            'category' => ['required', 'string', 'in:' . implode(',', array_keys(PublicDocument::CATEGORIES))],
            'file' => ['required', File::types('application/pdf')->max('10MB')],
            'published' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'file.mimetypes' => 'Only PDF files can be published here.',
            'file.max' => 'The PDF must be 10 MB or smaller.',
        ];
    }
}
