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
            // `limit` is the historical page-size parameter; `per_page` is the
            // system-wide name for the same thing. Either is accepted and
            // clamped to 50 (App\Support\Pagination::MAX_PER_PAGE) by the
            // controller, so a request can never pull more than one full page
            // at a time. `page` walks the feed.
            'limit' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1'],
            'page' => ['sometimes', 'integer', 'min:1'],
            // `smart` narrows the feed to the daily rule-based flags, which
            // the UI renders as its own "Flagged" tab.
            'filter' => [
                'sometimes',
                'string',
                'in:'.implode(',', NotificationService::FILTERS),
            ],
        ];
    }
}
