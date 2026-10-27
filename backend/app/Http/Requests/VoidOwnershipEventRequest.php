<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Void an ownership event. A reason is mandatory — voiding is the ONLY
 * correction path (events are never edited or deleted), so the trail has to
 * say why the chain changed.
 */
class VoidOwnershipEventRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission('void_dispersal_event');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'void_reason' => ['required', 'string', 'min:3', 'max:1000'],
        ];
    }
}
