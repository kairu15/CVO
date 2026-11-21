<?php

namespace App\Http\Requests;

use App\Models\CaseNote;
use Illuminate\Foundation\Http\FormRequest;

class StoreCaseNotePhotoRequest extends FormRequest
{
    public function authorize(): bool
    {
        $note = CaseNote::find($this->route('id'));

        return $note !== null && $this->user()->can('update', $note);
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'image' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:8192'],
        ];
    }
}
