<?php

namespace App\Providers;

use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Password::defaults(fn () => Password::min(8)->mixedCase()->numbers()->symbols());

        // API-only app: never redirect unauthenticated requests to a web
        // "login" route (which doesn't exist and would 500); always 401.
        Authenticate::redirectUsing(fn () => null);

        // Password reset links point at the SPA's reset page (item 3), not a
        // server-rendered route — this app has no web login form. The emailed
        // URL carries the raw token once; the broker stores only its hash.
        ResetPassword::createUrlUsing(function ($notifiable, string $token): string {
            $frontend = rtrim((string) env('FRONTEND_URL', 'http://localhost:5173'), '/');

            return $frontend.'/reset-password?token='.$token.'&email='.urlencode($notifiable->email);
        });
    }
}
