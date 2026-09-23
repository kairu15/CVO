<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * A saved system setting. The keys written through SettingsService are a
 * fixed vocabulary — the model is deliberately dumb so the service stays the
 * one place that knows which settings exist.
 */
class Setting extends Model
{
    /** @use HasFactory<\Database\Factories\SettingFactory> */
    use HasFactory;

    protected $fillable = ['key', 'value'];
}
