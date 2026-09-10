# CVO Frontend (React + Vite)

React 19 SPA (plain JavaScript) with Tailwind CSS 4, React Router 7, and cookie-based Sanctum auth against the Laravel API.

## Setup

```bash
npm install
```

### Environment

`.env` (local):

```env
VITE_API_URL=http://localhost:8000
```

`.env.production` is used by `npm run build` — point it at your deployed API.

> Vite only exposes variables prefixed with `VITE_`.

## Run

```bash
npm run dev      # http://localhost:5173
npm run build    # production build to dist/
```

Make sure the backend is running (`php artisan serve`) and that `backend/.env` contains:

```env
SANCTUM_STATEFUL_DOMAINS=localhost:5173,127.0.0.1:5173
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

## Auth flow (Sanctum SPA)

1. On app load, `AuthProvider` calls `GET /api/v1/user` to restore an existing session.
2. Before `login`/`register`, the app calls `GET /sanctum/csrf-cookie`; axios then
   automatically attaches the `X-XSRF-TOKEN` header from the cookie.
3. Subsequent requests carry the session cookie (`withCredentials: true`).
4. A global 401 interceptor clears auth state; `ProtectedRoute` redirects to `/login`.

## Structure

```
src/
├── api/          # axios instance + endpoint functions
├── components/   # Layout, ProtectedRoute, LoadingSpinner
├── pages/        # LoginPage, RegisterPage, DashboardPage (CRUD demo)
├── context/      # AuthProvider (user, login, register, logout)
├── routes/       # route definitions
└── utils/        # (helpers)
```

## Demo login (after `php artisan migrate --seed`)

- member@example.com / password
- admin@example.com / password
