<?php

namespace App\Http\Requests;

use App\Models\CaseNote;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class CaseNoteIndexRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('viewAny', CaseNote::class);
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'search' => ['nullable', 'string', 'max:120'],
            'status' => ['nullable', Rule::in(CaseNote::STATUSES)],
            'category' => ['nullable', Rule::in(CaseNote::CATEGORIES)],
            'barangay' => ['nullable', 'string', 'max:120'],
            'follow_up' => ['nullable', Rule::in(['upcoming', 'overdue', 'completed'])],
            'sort' => ['nullable', Rule::in(['date', 'farmer', 'status', 'reference'])],
            'direction' => ['nullable', Rule::in(['asc', 'desc'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:50'],
        ];
    }
}
