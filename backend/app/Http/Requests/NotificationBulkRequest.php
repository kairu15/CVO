<?php

namespace App\Http\Requests;

use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class NotificationBulkRequest extends FormRequest
{
    public function authorize(): bool
    {
        return in_array($this->user()->role, User::ROLES, true);
    }

    public function rules(): array
    {
        return [
            'ids' => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['integer', 'min:1'],
            'action' => ['required', 'string', Rule::in(NotificationService::ACTIONS)],
        ];
    }
}
