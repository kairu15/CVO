<?php

namespace App\Http\Requests;

use App\Models\HealthRecord;
use Illuminate\Foundation\Http\FormRequest;

class StoreHealthRecordPhotoRequest extends FormRequest
{
    public function authorize(): bool
    {
        $record = HealthRecord::find($this->route('id'));

        return $record !== null && $this->user()->can('update', $record);
    }

    protected function failedAuthorization(): never
    {
        abort(403, 'This health record is not yours to photograph.');
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
