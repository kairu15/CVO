<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\ValidatesOwnershipChain;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Hand an animal back to CVO. Like a re-dispersal, `base_event_id` is the
 * optimistic-concurrency token.
 */
class StoreReturnRequest extends FormRequest
{
    use ValidatesOwnershipChain;

    public function authorize(): bool
    {
        return $this->user()->hasPermission('manage_redispersal');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'base_event_id' => ['required', 'integer'],

            ...$this->locationAndDateRules(),
        ];
    }
}
