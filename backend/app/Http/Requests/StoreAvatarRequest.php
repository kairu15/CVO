<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/profile/avatar — profile photo upload (items 5 + 8).
 *
 * `image` sniffs the real content type via finfo; `mimes:` is the extension
 * allow-list; `max:` caps the size. The service layer additionally strips
 * EXIF and stores under a server-generated name on the private disk.
 */
class StoreAvatarRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'avatar' => [
                'required',
                'image',
                'mimes:'.implode(',', (array) config('security.uploads.image_mimes', ['jpg', 'jpeg', 'png', 'webp'])),
                'max:'.(int) config('security.uploads.image_max_kb', 2048),
            ],
        ];
    }
}
