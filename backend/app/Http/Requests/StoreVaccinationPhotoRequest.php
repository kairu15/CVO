<?php

namespace App\Http\Requests;

use App\Models\Vaccination;
use Illuminate\Foundation\Http\FormRequest;

class StoreVaccinationPhotoRequest extends FormRequest
{
    public function authorize(): bool
    {
        $vaccination = Vaccination::find($this->route('id'));

        return $vaccination !== null
            && ($this->user()->role === 'admin'
                || ($this->user()->role === 'technician'
                    && $vaccination->technician_id === $this->user()->id));
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
