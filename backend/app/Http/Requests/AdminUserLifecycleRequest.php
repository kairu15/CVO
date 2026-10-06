<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * DELETE /api/v1/admin/users/{id} (deactivate) and
 * POST /api/v1/admin/users/{id}/reactivate.
 *
 * Both carry no body, so the only thing to validate is who is asking. The
 * route group already puts EnsureUserIsAdmin in front of these; this is the
 * same belt-and-braces authorize() the other admin writes use, so the 403
 * does not depend on a middleware registration staying correct.
 */
class AdminUserLifecycleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->role === 'admin';
    }

    protected function failedAuthorization(): never
    {
        abort(403, 'Administrator access required.');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [];
    }
}
