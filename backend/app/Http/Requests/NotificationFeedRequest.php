<?php

namespace App\Http\Requests;

use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Foundation\Http\FormRequest;

class NotificationFeedRequest extends FormRequest
{
    /**
     * Every authenticated role may read its own feed — and only its own: the
     * controller builds the feed from `$request->user()`, never from a request
     * parameter, so there is no id to tamper with. That is also why there is no
     * Policy: there is no model to authorize against, the same shape as
     * VaccinationScheduleRequest and AnimalHealthRequest.
     */
    public function authorize(): bool
    {
        return in_array($this->user()->role, User::ROLES, true);
    }

    public function rules(): array
    {
        return [
            'limit' => [
                'sometimes',
                'integer',
                'between:1,'.NotificationService::SCAN_CAP,
            ],
        ];
    }
}
