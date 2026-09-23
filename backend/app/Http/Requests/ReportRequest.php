<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;

class ReportRequest extends FormRequest
{
    /**
     * City-wide reporting is the administrator's overview by definition (the
     * admin blurb in roles.js promises it), and the endpoint is additionally
     * gated by EnsureUserIsAdmin at the route level — defense in depth, since
     * a FormRequest alone is easy to drop from a route during a refactor.
     */
    public function authorize(): bool
    {
        return $this->user()->role === 'admin';
    }

    public function rules(): array
    {
        return [
            // A specific barangay, or the whole city.
            'barangay' => ['sometimes', 'string', 'max:255'],

            // Narrow the date-banded aggregates to dispersals recorded on or
            // after this day. Null/absent means "the whole program so far".
            'from' => ['sometimes', 'date'],
        ];
    }
}
