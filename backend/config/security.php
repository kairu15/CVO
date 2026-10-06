<?php

/*
|--------------------------------------------------------------------------
| Security configuration
|--------------------------------------------------------------------------
|
| Every hardening knob the CVO API reads, in one place, so a reviewer can
| see the whole security posture without grepping the codebase. Each value
| is overridable by env (see .env.example); the defaults here are the
| production-intended values.
|
| Sessions (cookie SPA) and tokens (mobile) share the idle/absolute model:
| idle = expire after inactivity, absolute = expire no matter what. The SPA
| also gets Sanctum's AuthenticateSession middleware, which kills the cookie
| session the moment the account's password changes or is reset.
|
*/

return [

    /*
    |----------------------------------------------------------------------
    | Session & token lifetimes (minutes)
    |----------------------------------------------------------------------
    |
    | session_idle: cookie sessions die after this much inactivity (the
    | framework's own SESSION_LIFETIME drives it; kept here so the absolute
    | ceiling below is expressed against the same unit).
    | token_idle: mobile bearer tokens expire at this many minutes of
    | inactivity (refreshed on every authenticated request).
    | token_absolute: a token's hard ceiling from issuance, refreshed
    | automatically by client re-login — not user-visible.
    |
    */
    'session_idle' => (int) env('SECURITY_SESSION_IDLE', 120),

    // Absolute ceiling for COOKIE sessions: after this many minutes from
    // login the session is invalid no matter how active it has been (the
    // idle lifetime above is renewed on every request; this one is not).
    // Enforced by App\Http\Middleware\AbsoluteSessionExpiry.
    'session_absolute' => (int) env('SECURITY_SESSION_ABSOLUTE', 720),

    // The SPA's own inactivity auto-logout (App\...\IdleSessionGuard) —
    // deliberately SHORTER than session_idle above, so the client warns the
    // user and signs out before the server's own window would 401 them
    // mid-form. Admin-editable (System Settings → Session); this is the
    // shipped default, and SettingsService never allows the saved value to
    // exceed session_idle.
    'client_idle_minutes' => (int) env('SECURITY_CLIENT_IDLE_MINUTES', 15),

    'token_idle' => (int) env('SECURITY_TOKEN_IDLE', 240),
    'token_absolute' => (int) env('SECURITY_TOKEN_ABSOLUTE', 10080),

    /*
    |----------------------------------------------------------------------
    | Account lockout (item 2)
    |----------------------------------------------------------------------
    |
    | After N consecutive failed logins for ONE account, the account is
    | locked for `lockout_minutes`. Counts decay to zero on success, when
    | the lock expires, or on password reset. The window groups attempts so
    | one failure in January never counts against a brute force run in
    | March.
    |
    */
    'lockout' => [
        'max_attempts' => (int) env('SECURITY_LOCKOUT_MAX_ATTEMPTS', 5),
        'lockout_minutes' => (int) env('SECURITY_LOCKOUT_MINUTES', 15),
        'window_minutes' => (int) env('SECURITY_LOCKOUT_WINDOW', 60),
    ],

    /*
    |----------------------------------------------------------------------
    | Secure uploads (item 8)
    |----------------------------------------------------------------------
    |
    | images: the allow-list enforced server-side by MIME + extension +
    | real image sniffing (UploadedFile::isValidImage via finfo). `max_kb`
    | applies to the profile avatar; field-visit photos have their own
    | tighter cap in StoreFieldVisitPhotoRequest.
    |
    */
    'uploads' => [
        'image_mimes' => ['jpg', 'jpeg', 'png', 'webp'],
        'image_max_kb' => (int) env('SECURITY_UPLOAD_IMAGE_MAX_KB', 2048),
    ],

    /*
    |----------------------------------------------------------------------
    | Signed upload URLs (item 8)
    |----------------------------------------------------------------------
    |
    | How long a generated photo/avatar URL stays fetchable. Short enough
    | that a leaked link expires quickly; long enough for the dashboard to
    | finish rendering its images.
    |
    */
    'signed_url_minutes' => (int) env('SECURITY_SIGNED_URL_MINUTES', 30),

    /*
    |----------------------------------------------------------------------
    | Security headers (item 9)
    |----------------------------------------------------------------------
    |
    | csp: applied on HTML responses only — the API serves JSON where a CSP
    | would be dead weight, and the SPA build is served by Vite/nginx in
    | production (give it the same header there).
    | hsts is production-only and skipped on localhost by design.
    |
    */
    'headers' => [
        'csp' => env('SECURITY_CSP', "default-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"),
        'x_frame_options' => env('SECURITY_X_FRAME_OPTIONS', 'DENY'),

        // HSTS: sent automatically in production. Set SECURITY_HSTS=true to
        // force it on (e.g. a staging host behind real TLS), or false to
        // force it off. Never sent over plain HTTP localhost.
        'hsts_enabled' => env('SECURITY_HSTS'),
        'hsts_max_age' => (int) env('SECURITY_HSTS_MAX_AGE', 31536000),
    ],

];
